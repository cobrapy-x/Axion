// SPDX-License-Identifier: Apache-2.0
/**
 * Simulation worker: runs the Engine off the UI thread, paced to real time,
 * and posts ~60 state snapshots per second for the views to animate.
 *
 * With 2+ microcontrollers and cross-origin isolation (SharedArrayBuffer), the MCUs run on
 * several cores: this worker becomes the coordinator and starts MCU workers (see
 * mc-coordinator.ts and docs/MULTICORE.md). Otherwise, or if that fails, everything runs
 * here as before.
 */
import type { Diagram } from '../core/diagram';
import { Engine, type PartType } from '../core/engine';
import { loadPartTypes } from '../core/parts-models';
import { McuCoordinator, planLanes, type SpawnThread } from './mc-coordinator';
import type { FromWorker, ToWorker } from './protocol';

const types: Map<string, PartType> = loadPartTypes();
const engine = new Engine(types);
let generation = 0;
let running = false;
let coordinator: McuCoordinator | null = null;

const post = (msg: FromWorker) => (self as unknown as Worker).postMessage(msg);

const channel = new MessageChannel();
const pending: Array<() => void> = [];
channel.port1.onmessage = () => pending.shift()?.();
/** Yield to the event loop without the 4 ms setTimeout clamp. */
const yieldNow = () =>
  new Promise<void>((resolve) => {
    pending.push(resolve);
    channel.port2.postMessage(null);
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SLICE_MS = 12; // max CPU time per slice before yielding to messages
const FRAME_MS = 16; // snapshot interval
const MAX_LAG_NS = 100e6; // if >100 ms behind real time, stop trying to catch up

async function run(gen: number) {
  let realStart = performance.now();
  let simStart = engine.time;
  let lastFrame = 0;
  let speedReal = realStart;
  let speedSim = engine.time;
  let speed = 1;

  while (running && gen === generation) {
    const now = performance.now();
    let target = simStart + (now - realStart) * 1e6;
    if (target - engine.time > MAX_LAG_NS) {
      // Slower than real time: re-anchor instead of accumulating debt.
      realStart = now;
      simStart = engine.time;
      target = engine.time + SLICE_MS * 1e6;
    }
    const sliceEnd = now + SLICE_MS;
    while (engine.time < target && performance.now() < sliceEnd) {
      engine.stepTo(Math.min(target, engine.time + 1e6));
    }

    const t = performance.now();
    if (t - lastFrame >= FRAME_MS) {
      lastFrame = t;
      if (t - speedReal >= 500) {
        speed = (engine.time - speedSim) / ((t - speedReal) * 1e6);
        speedReal = t;
        speedSim = engine.time;
      }
      post({ type: 'snapshot', snapshot: engine.snapshot(), speed });
    }
    await (engine.time >= target ? sleep(2) : yieldNow());
  }
}

// ───────────────────────────── multi-core ─────────────────────────────

/** Microcontrollers that will actually run (an MCU part with firmware). */
function mcuCount(diagram: Diagram, firmware: Record<string, string>): number {
  return diagram.parts.filter((p) => types.get(p.type)?.manifest.mcu && firmware[p.id]).length;
}

function multicoreAvailable(): boolean {
  return (
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true &&
    typeof SharedArrayBuffer === 'function' &&
    typeof Atomics?.wait === 'function' &&
    typeof Worker === 'function'
  );
}

const spawnMcuWorker: SpawnThread = (loaded, failed) => {
  const w = new Worker(new URL('./mcu-worker.ts', import.meta.url), { type: 'module', name: 'axion-mcu' });
  w.onmessage = (e: MessageEvent<{ type?: string }>) => {
    if (e.data?.type === 'loaded') loaded();
  };
  w.onerror = (e) => {
    e.preventDefault();
    failed(e.message || 'MCU worker failed to load');
  };
  return { post: (m) => w.postMessage(m), terminate: () => w.terminate() };
};

/** A coordinator with MCU workers, or null to run single-threaded. Never throws. */
async function startCoordinator(mcus: number, maxCores = Infinity): Promise<McuCoordinator | null> {
  if (mcus < 2 || !multicoreAvailable()) return null;
  const plan = planLanes(mcus, Math.min(maxCores, navigator.hardwareConcurrency || 1));
  if (!plan) return null;
  try {
    return await McuCoordinator.start({ ...plan, spawn: spawnMcuWorker, timeoutMs: 5000 });
  } catch (err) {
    console.warn('Axion: multi-core start failed, running on one core.', err);
    return null;
  }
}

function stopCoordinator() {
  coordinator?.dispose();
  coordinator = null;
  engine.offload = null;
}

async function start(gen: number, diagram: Diagram, firmware: Record<string, string>, maxCores?: number) {
  stopCoordinator();
  const co = await startCoordinator(mcuCount(diagram, firmware), maxCores);
  if (gen !== generation) {
    co?.dispose();
    return;
  }
  coordinator = co;
  engine.offload = co;
  engine.load(diagram, firmware);
  if (co) {
    try {
      await co.ready();
    } catch (err) {
      if (gen !== generation) return;
      // A worker could not build its MCU: run everything here instead (a firmware error
      // shows up again, now as a normal simulation error).
      console.warn('Axion: multi-core start failed, running on one core.', err);
      stopCoordinator();
      engine.load(diagram, firmware);
    }
    if (gen !== generation) return;
  }
  post({ type: 'started', cores: coordinator?.cores ?? 1 });
  running = true;
  await run(gen);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'start':
        generation++;
        running = false;
        start(generation, msg.diagram, msg.firmware, msg.maxCores).catch(fail);
        break;
      case 'stop':
        generation++;
        running = false;
        stopCoordinator();
        post({ type: 'stopped' });
        break;
      case 'input':
        if (running) engine.input(msg.part, msg.event, msg.data);
        break;
    }
  } catch (err) {
    fail(err);
  }
};

function fail(err: unknown) {
  running = false;
  generation++;
  stopCoordinator();
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
}
