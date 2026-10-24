// SPDX-License-Identifier: Apache-2.0
/**
 * Simulation worker: runs the Engine off the UI thread, paced to real time,
 * and posts ~60 state snapshots per second for the views to animate.
 */
import { Engine } from '../core/engine';
import { loadPartTypes } from '../core/parts-models';
import type { FromWorker, ToWorker } from './protocol';

const engine = new Engine(loadPartTypes());
let generation = 0;
let running = false;

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

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'start':
        generation++;
        engine.load(msg.diagram, msg.firmware);
        running = true;
        run(generation).catch(fail);
        break;
      case 'stop':
        generation++;
        running = false;
        post({ type: 'stopped' });
        break;
      case 'input':
        engine.input(msg.part, msg.event, msg.data);
        break;
    }
  } catch (err) {
    fail(err);
  }
};

function fail(err: unknown) {
  running = false;
  generation++;
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
}
