// SPDX-License-Identifier: Apache-2.0
/**
 * Multi-core simulation (docs/MULTICORE.md): the coordinator with the in-process transport
 * and with real worker_threads, compared against the single-threaded engine.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDiagram, type Diagram } from '../src/core/diagram';
import { Engine } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import { McuCoordinator, planLanes, type SpawnThread } from '../src/sim/mc-coordinator';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const MS = 1e6;
const types = loadPartTypes();

// ───────────────────────────── worker_threads transport ─────────────────────────────

let bundleDir = '';
let threadScript = '';
const live: Array<McuCoordinator | null> = [];

/** The lane thread entry bundled for Node (worker_threads cannot load TypeScript). */
beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), 'axion-mc-'));
  await build({
    configFile: false,
    logLevel: 'silent',
    root,
    build: {
      ssr: resolve(root, 'src/sim/mcu-thread-node.ts'),
      outDir: bundleDir,
      emptyOutDir: true,
      target: 'node20',
      minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'mcu-thread.mjs' } },
    },
    ssr: { noExternal: true },
  });
  threadScript = join(bundleDir, 'mcu-thread.mjs');
}, 60_000);

afterAll(() => {
  for (const co of live) co?.dispose();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

const spawn: SpawnThread = (loaded, failed) => {
  const w = new Worker(threadScript);
  w.on('message', (m: { type?: string }) => m?.type === 'loaded' && loaded());
  w.on('error', (e) => failed(e.message));
  return { post: (m) => w.postMessage(m), terminate: () => void w.terminate() };
};

// ───────────────────────────── circuits ─────────────────────────────

interface Circuit {
  diagram: Diagram;
  firmware: Record<string, string>;
}

/** Several examples side by side in one circuit; ids get a prefix per example. */
function merge(parts: Array<[prefix: string, example: string, hex: Record<string, string>]>): Circuit {
  const d = { version: 1, parts: [] as Array<Record<string, unknown>>, connections: [] as unknown[] };
  const firmware: Record<string, string> = {};
  parts.forEach(([prefix, example, hex], k) => {
    const src = JSON.parse(read(`examples/${example}/diagram.json`));
    for (const p of src.parts) d.parts.push({ ...p, id: prefix + p.id, left: p.left + k * 1000 });
    for (const [a, b, color, route] of src.connections) d.connections.push([prefix + a, prefix + b, color, route]);
    for (const [id, file] of Object.entries(hex)) firmware[prefix + id] = read(`examples/${example}/${file}`);
  });
  return { diagram: parseDiagram(d), firmware };
}

const twoUnos = (): Circuit => merge([['', 'two-unos-serial', { uno1: 'sender.hex', uno2: 'receiver.hex' }]]);

/** 4 boards: UART between MCUs, an ultrasonic echo (ctx.schedule), keypad scanning (read-after-write). */
const fourBoards = (): Circuit =>
  merge([
    ['a_', 'two-unos-serial', { uno1: 'sender.hex', uno2: 'receiver.hex' }],
    ['s_', 'ultrasonic-distance', { uno: 'sketch.hex' }],
    ['k_', 'keypad-lock', { uno: 'sketch.hex' }],
  ]);

/** 3 boards on buses: I²C LCD, encoder motor + analogRead + interrupts, servo + analogRead. */
const busBoards = (): Circuit =>
  merge([
    ['l_', 'lcd-hello', { uno: 'sketch.hex' }],
    ['m_', 'motor-encoder', { uno: 'sketch.hex' }],
    ['v_', 'servo-knob', { uno: 'sketch.hex' }],
  ]);

// ───────────────────────────── runner ─────────────────────────────

type Mode = 'single' | 'inproc' | 'threads' | 'per-mcu';

async function engineFor(mode: Mode, c: Circuit): Promise<Engine> {
  const mcus = Object.keys(c.firmware).length;
  let co: McuCoordinator | null = null;
  if (mode === 'inproc') co = new McuCoordinator({ threads: 0, cloneInline: true });
  // What the app picks on a 2-core machine: the coordinator's thread + 1 worker.
  if (mode === 'threads') co = await McuCoordinator.start({ ...planLanes(mcus, 2)!, spawn });
  // The literal "one worker per MCU" layout (the coordinator only serves).
  if (mode === 'per-mcu') co = await McuCoordinator.start({ threads: mcus, inline: false, spawn, spin: 2000 });
  live.push(co);
  const e = new Engine(types);
  e.offload = co;
  e.load(c.diagram, c.firmware);
  await co?.ready();
  return e;
}

interface Run {
  serial: Record<string, string>;
  states: Record<string, Record<string, unknown>>;
  warnings: string[];
  ms: number;
}

/** Run a script of steps; serial output is collected every 50 ms of simulated time. */
async function run(mode: Mode, c: Circuit, script: (step: (ms: number) => void, e: Engine) => void): Promise<Run> {
  const e = await engineFor(mode, c);
  const serial: Record<string, string> = {};
  const step = (ms: number) => {
    const end = e.time + ms * MS;
    while (e.time < end) {
      e.stepTo(Math.min(end, e.time + 50 * MS));
      for (const ev of e.snapshot().events) if (ev.event === 'serial') serial[ev.part] = (serial[ev.part] ?? '') + String(ev.data);
    }
  };
  const t0 = performance.now();
  script(step, e);
  const ms = performance.now() - t0;
  const snap = e.snapshot();
  return { serial, states: snap.states, warnings: snap.warnings, ms };
}

/** Same states, numbers within a small tolerance (timing differs by at most a quantum). */
function expectSameStates(a: Run['states'], b: Run['states']) {
  expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  for (const [id, sa] of Object.entries(a)) {
    for (const [k, va] of Object.entries(sa)) {
      const vb = b[id][k];
      if (typeof va === 'number' && typeof vb === 'number') expect(Math.abs(va - vb), `${id}.${k}`).toBeLessThanOrEqual(Math.max(0.02, Math.abs(va) * 0.02));
      else expect(vb, `${id}.${k}`).toEqual(va);
    }
  }
}

const twoUnosScript = (step: (ms: number) => void) => step(2100);

const keys: Record<string, [number, number]> = { '1': [0, 0], '2': [0, 1], '3': [0, 2], '4': [1, 0], '9': [2, 2], '#': [3, 2] };
const fourScript = (step: (ms: number) => void, e: Engine) => {
  step(400);
  e.input('s_sonar1', 'prop', { key: 'distance', value: 57 });
  const type = (code: string) => {
    for (const k of code) {
      const [row, column] = keys[k];
      e.input('k_keypad1', 'press', { key: k, row, column });
      step(80);
      e.input('k_keypad1', 'release', { key: k, row, column });
      step(80);
    }
  };
  type('1239#');
  step(800); // "Wrong code" stays on for a moment
  type('1234#');
  step(300);
};

const busScript = (step: (ms: number) => void, e: Engine) => {
  step(1000);
  e.input('m_pot1', 'value', 900);
  e.input('v_pot1', 'value', 1023);
  step(1400);
};

// ───────────────────────────── tests ─────────────────────────────

describe('multi-core planning', () => {
  it('uses one thread for a single MCU or a single core, else one lane per core', () => {
    expect(planLanes(1, 8)).toBeNull();
    expect(planLanes(4, 1)).toBeNull();
    expect(planLanes(2, 8)).toMatchObject({ threads: 1, inline: true });
    expect(planLanes(4, 2)).toMatchObject({ threads: 1, inline: true });
    expect(planLanes(3, 16)).toMatchObject({ threads: 2, inline: true });
  });
});

describe('multi-core: same results as single-threaded', () => {
  it('two-unos-serial, in-process transport: identical output', async () => {
    const a = await run('single', twoUnos(), twoUnosScript);
    const b = await run('inproc', twoUnos(), twoUnosScript);
    expect(a.serial.uno2).toContain('Received: N3');
    expect(b.serial).toEqual(a.serial);
    expectSameStates(a.states, b.states);
  });

  it('two-unos-serial on worker threads (both layouts)', async () => {
    const a = await run('single', twoUnos(), twoUnosScript);
    for (const mode of ['threads', 'per-mcu'] as const) {
      const b = await run(mode, twoUnos(), twoUnosScript);
      expect(b.serial, mode).toEqual(a.serial);
      expectSameStates(a.states, b.states);
    }
  });

  it('4 boards: UART, ultrasonic echo timing and keypad scanning', async () => {
    const a = await run('single', fourBoards(), fourScript);
    expect(a.serial.a_uno2).toContain('Received: N2');
    expect(a.serial.s_uno).toContain('Distance: 56 cm');
    expect(a.serial.k_uno).toContain('Wrong code');
    expect(a.serial.k_uno).toContain('Unlocked!');
    {
      const mode = 'threads';
      const b = await run(mode, fourBoards(), fourScript);
      expect(b.serial, mode).toEqual(a.serial);
      expectSameStates(a.states, b.states);
      expect(b.warnings).toEqual(a.warnings);
    }
  }, 60_000);

  it('3 boards on buses: I²C LCD, encoder motor with analogRead, servo', async () => {
    const a = await run('single', busBoards(), busScript);
    expect(a.serial.v_uno).toContain('angle=180');
    expect(String.fromCharCode(...(a.states.l_lcd1.chars as number[]))).toContain('Hello, Axion!');
    for (const mode of ['inproc', 'threads'] as const) {
      const b = await run(mode, busBoards(), busScript);
      expect(b.serial, mode).toEqual(a.serial);
      expectSameStates(a.states, b.states);
    }
  }, 60_000);

  it('is deterministic across threaded runs', async () => {
    const a = await run('threads', fourBoards(), fourScript);
    const b = await run('threads', fourBoards(), fourScript);
    expect(b.serial).toEqual(a.serial);
    expect(b.states).toEqual(a.states);
  }, 60_000);
});

describe('multi-core fallbacks', () => {
  it('start() rejects and cleans up when a worker cannot start', async () => {
    let terminated = 0;
    const broken: SpawnThread = (_loaded, failed) => {
      setTimeout(() => failed('no workers here'), 1);
      return { post: () => {}, terminate: () => void terminated++ };
    };
    await expect(McuCoordinator.start({ threads: 2, spawn: broken })).rejects.toThrow('no workers here');
    expect(terminated).toBe(2);
  });

  it('start() times out on a worker that never loads', async () => {
    const silent: SpawnThread = () => ({ post: () => {}, terminate: () => {} });
    await expect(McuCoordinator.start({ threads: 1, spawn: silent, timeoutMs: 50 })).rejects.toThrow(/did not start/);
  });

  it('ready() reports an MCU that fails to build in its worker', async () => {
    const c = twoUnos();
    c.firmware.uno1 = ':0400000001020304F0\n'; // bad checksum; uno1 goes to the worker lane
    const co = await McuCoordinator.start({ threads: 1, spawn });
    live.push(co);
    const e = new Engine(types);
    e.offload = co;
    e.load(c.diagram, c.firmware);
    await expect(co.ready()).rejects.toThrow(/uno1: Corrupt HEX file/);
  });

  it('a circuit with one MCU attaches nothing and runs in-process', async () => {
    const co = new McuCoordinator({ threads: 0 });
    const e = new Engine(types);
    // The worker only uses a coordinator for 2+ MCUs; without one, boards run in-process.
    e.load(parseDiagram(JSON.parse(read('examples/blink-button/diagram.json'))), { uno: read('examples/blink-button/sketch.hex') });
    e.stepTo(300 * MS);
    expect(co.mcuCount).toBe(0);
    expect(e.snapshot().events.map((x) => x.data).join('')).toContain('Axion demo');
  });
});

describe('multi-core speed (worker_threads)', () => {
  it('reports single-threaded vs multi-core time', async () => {
    const cases: Array<[string, () => Circuit, (step: (ms: number) => void, e: Engine) => void]> = [
      ['two-unos-serial (2 MCUs)', twoUnos, (step) => step(2000)],
      ['3 boards (I2C, encoder, servo)', busBoards, busScript],
    ];
    const lines: string[] = [];
    for (const [name, circuit, script] of cases) {
      const single = await run('single', circuit(), script);
      const threads = await run('threads', circuit(), script);
      // The literal "one worker per MCU" layout, for comparison (oversubscribes a 2-core machine).
      const perMcu = await run('per-mcu', circuit(), script);
      expect(threads.serial).toEqual(single.serial);
      lines.push(
        `${name}: single ${single.ms.toFixed(0)} ms, multi-core ${threads.ms.toFixed(0)} ms (${(single.ms / threads.ms).toFixed(2)}x), ` +
          `one worker per MCU ${perMcu.ms.toFixed(0)} ms (${(single.ms / perMcu.ms).toFixed(2)}x)`,
      );
    }
    process.stderr.write(`\n[multicore speed]\n${lines.join('\n')}\n`);
  }, 180_000);
});
