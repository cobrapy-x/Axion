// SPDX-License-Identifier: Apache-2.0
/**
 * Multi-core coordinator (docs/MULTICORE.md). Implements the engine's McuOffload: every
 * MCU board gets a RemoteRuntime stand-in, while the real runtime runs in an McuExecutor,
 * either in a worker thread (SharedArrayBuffer channel) or inline in this thread.
 *
 * Per quantum (conservative lock-step):
 *   1. begin: each MCU gets its input levels and pending UART bytes, then GO.
 *   2. All MCUs run the quantum in parallel. Outputs go to a ring as timestamped events.
 *      Requests that need an answer now (analogRead, I²C, SPI, read-after-write) block the
 *      MCU; the coordinator serves them while it waits for the barrier, after first applying
 *      that MCU's own earlier outputs.
 *   3. barrier: the remaining events of all MCUs are applied in time order (ties: board order).
 * Input changes caused by other parts reach an MCU at the next quantum boundary; changes
 * caused by its own outputs reach it at its next request, as in the single-threaded engine.
 *
 * Lanes: lane 0 may run inline (in this thread); the others are worker threads. With more
 * MCUs than lanes, a lane runs several MCUs one after another.
 */
import type { McuOffload } from '../core/engine';
import { encodeLevel, type McuDescriptor, type McuHost, type McuRuntime, type PinDrive } from '../mcu/runtime';
import type { Level } from '../core/types';
import {
  CMD_STOP,
  EV_PIN,
  EV_RX,
  EV_TX,
  EventQueue,
  F_REPLY,
  F_TARGET,
  F_TIME,
  H_A,
  H_B,
  H_CMD,
  H_DONE,
  H_GO,
  H_INPUTS,
  H_KIND,
  H_REP,
  H_REQ,
  H_RX,
  H_STATUS,
  McuChannel,
  RQ_ADC,
  RQ_I2C_CONNECT,
  RQ_I2C_READ,
  RQ_I2C_START,
  RQ_I2C_STOP,
  RQ_I2C_WRITE,
  RQ_SPI,
  RX_CAP,
  STATUS_FAILED,
  STATUS_READY,
  STATUS_STARTING,
} from './mc-channel';
import { McuExecutor } from './mc-executor';
import type { ThreadMsg } from './mc-thread';

/** A worker thread that runs one lane (see mc-thread.ts). */
export interface ThreadHandle {
  post(msg: ThreadMsg): void;
  terminate(): void;
}

/** Starts a lane thread; call `loaded()` once its module is ready, `failed()` if it cannot start. */
export type SpawnThread = (loaded: () => void, failed: (message: string) => void) => ThreadHandle;

export interface CoordinatorOptions {
  /** Worker threads to start (0 = everything inline: the in-process transport). */
  threads: number;
  spawn?: SpawnThread;
  /** Run one lane in the coordinator's own thread (default true). */
  inline?: boolean;
  /** Busy-wait iterations before sleeping in Atomics.wait (high when every lane has its own core). */
  spin?: number;
  /** Give up on unresponsive workers after this long (ms). */
  timeoutMs?: number;
  /** Structured-clone descriptors of inline MCUs too (tests: proves they can be posted to a worker). */
  cloneInline?: boolean;
}

interface Lane {
  thread: ThreadHandle | null;
  slots: Slot[];
}

interface Slot {
  index: number;
  id: string;
  ch: McuChannel;
  host: McuHost;
  remote: RemoteRuntime;
  lane: Lane;
  queue: EventQueue;
  exec: McuExecutor | null;
  go: number;
  done: boolean;
}

/** Stand-in for a remote MCU inside the engine: mirrors its pin drives, records its inputs. */
class RemoteRuntime implements McuRuntime {
  timeNs = 0;
  readonly drives: Uint8Array;
  /** Input levels as the circuit sees them now. */
  readonly levels: Uint8Array;
  /** Pins changed by the MCU's own outputs since they were last sent (sent at its next request). */
  readonly own: Uint8Array;
  ownAny = false;
  /** Anything to send at the next quantum start. */
  changed = true;
  readonly rx: number[] = [];

  constructor(
    private readonly co: McuCoordinator,
    private readonly slot: () => Slot,
    pins: number,
  ) {
    this.drives = new Uint8Array(pins);
    this.levels = new Uint8Array(pins);
    this.own = new Uint8Array(pins);
  }

  runUntil(): void {
    // The coordinator runs remote MCUs (McuOffload.runQuantum).
  }

  setInput(pin: number, level: Level): void {
    const v = encodeLevel(level);
    if (this.levels[pin] === v) return;
    this.levels[pin] = v;
    this.changed = true;
    if (this.co.applying === this.slot()) {
      this.own[pin] = 1;
      this.ownAny = true;
    }
  }

  drive(pin: number): PinDrive {
    return this.drives[pin] as PinDrive;
  }

  uartReceive(port: number, byte: number): void {
    if (this.rx.length >= 4096) return;
    this.rx.push(((port & 0xff) << 8) | (byte & 0xff));
    this.changed = true;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class McuCoordinator implements McuOffload {
  /** The MCU whose events / request are being applied right now (RemoteRuntime.setInput reads it). */
  applying: Slot | null = null;

  private readonly slots: Slot[] = [];
  private readonly lanes: Lane[] = [];
  private readonly inlineSlots: Slot[] = [];
  private readonly threadSlots: Slot[] = [];
  private readonly doorBuf: SharedArrayBuffer | null;
  private readonly door: Int32Array | null;
  private readonly spin: number;
  private readonly timeoutMs: number;
  private pendingThreads = 0;
  private lastBell = 0;
  private started = false;
  private disposed = false;
  private readonly pins: number[] = [];
  private readonly poll = () => {
    const bell = Atomics.load(this.door!, 0);
    if (bell === this.lastBell) return;
    this.lastBell = bell;
    this.pollThreads();
  };

  /** Use `McuCoordinator.start()` for worker threads; `new McuCoordinator({ threads: 0 })` runs everything inline. */
  constructor(
    private readonly opts: CoordinatorOptions,
    threads: ThreadHandle[] = [],
  ) {
    this.spin = opts.spin ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    if (threads.length) {
      this.doorBuf = new SharedArrayBuffer(4);
      this.door = new Int32Array(this.doorBuf);
    } else {
      this.doorBuf = null;
      this.door = null;
    }
    if (opts.inline !== false || !threads.length) this.lanes.push({ thread: null, slots: [] });
    for (const thread of threads) this.lanes.push({ thread, slots: [] });
  }

  /** Start `opts.threads` lane workers and wait until they are loaded. Rejects (after cleaning up) if one fails. */
  static async start(opts: CoordinatorOptions): Promise<McuCoordinator> {
    const handles: ThreadHandle[] = [];
    const loaded: Array<Promise<void>> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (opts.threads && !opts.spawn) throw new Error('No way to start worker threads');
      for (let i = 0; i < opts.threads; i++) {
        loaded.push(new Promise<void>((resolve, reject) => handles.push(opts.spawn!(resolve, (m) => reject(new Error(m))))));
      }
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('MCU workers did not start in time')), opts.timeoutMs ?? 10_000);
      });
      await Promise.race([Promise.all(loaded), timeout]);
    } catch (err) {
      for (const h of handles) h.terminate();
      throw err;
    } finally {
      clearTimeout(timer);
    }
    return new McuCoordinator(opts, handles);
  }

  /** Threads running MCU code in parallel (the "cores" shown in the UI). */
  get cores(): number {
    return this.lanes.filter((l) => l.slots.length).length;
  }

  get mcuCount(): number {
    return this.slots.length;
  }

  // ───────────────────────────── McuOffload ─────────────────────────────

  attach(partId: string, descriptor: McuDescriptor, firmware: string, host: McuHost): McuRuntime | undefined {
    const index = this.slots.length;
    // Round-robin, worker lanes first: the inline lane also carries the circuit, so with
    // uneven counts it gets the fewest MCUs (3 MCUs on 2 lanes: 1 inline, 2 in the worker).
    const lane = this.lanes[(index + 1) % this.lanes.length];
    const ch = McuChannel.create(descriptor.pins, !!lane.thread);
    let slot!: Slot;
    const remote = new RemoteRuntime(this, () => slot, descriptor.pins);
    slot = { index, id: partId, ch, host, remote, lane, queue: new EventQueue(), exec: null, go: 0, done: true };
    if (lane.thread) {
      lane.thread.post({ type: 'add', buffer: ch.buffer as SharedArrayBuffer, pins: descriptor.pins, descriptor, firmware, door: this.doorBuf!, spin: this.spin, id: partId });
      this.threadSlots.push(slot);
    } else {
      const desc = this.opts.cloneInline ? structuredClone(descriptor) : descriptor;
      slot.exec = new McuExecutor(ch, desc, firmware, () => this.serve(slot));
      this.inlineSlots.push(slot);
    }
    lane.slots.push(slot);
    this.slots.push(slot);
    return remote;
  }

  runQuantum(_fromNs: number, toNs: number): void {
    if (!this.slots.length) return;
    if (this.disposed) throw new Error('Simulation stopped');
    if (!this.started) this.checkStarted();
    // Threads first, so they start while the inline lane runs.
    for (const s of this.threadSlots) this.begin(s, toNs);
    for (const s of this.inlineSlots) this.begin(s, toNs);
    this.pendingThreads = this.threadSlots.length;
    const poll = this.pendingThreads ? this.poll : undefined;
    for (const s of this.inlineSlots) {
      s.exec!.runQuantum(poll);
      s.ch.drain(s.queue);
      s.done = true;
    }
    if (this.pendingThreads) this.waitThreads();
    this.applyAll();
    for (const s of this.slots) s.remote.timeNs = toNs;
  }

  /** Stop and terminate the worker threads. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.threadSlots) {
      Atomics.store(s.ch.i32, H_CMD, CMD_STOP);
      Atomics.add(s.ch.i32, H_GO, 1);
      Atomics.notify(s.ch.i32, H_GO);
    }
    for (const lane of this.lanes) lane.thread?.terminate();
  }

  // ───────────────────────────── internals ─────────────────────────────

  /**
   * Call after the engine loaded the circuit (all MCUs attached), before the first quantum:
   * lets the threads build their MCUs and enter their run loop. Asynchronous on purpose:
   * browsers deliver messages to a nested worker through its parent's event loop, so the
   * coordinator must not block (Atomics.wait) until every worker has its MCUs.
   */
  async ready(): Promise<void> {
    if (this.started) return;
    for (const lane of this.lanes) if (lane.thread && lane.slots.length) lane.thread.post({ type: 'run' });
    const deadline = now() + this.timeoutMs;
    for (const s of this.threadSlots) {
      while (Atomics.load(s.ch.i32, H_STATUS) === STATUS_STARTING) {
        if (this.disposed) throw new Error('Simulation stopped');
        if (now() > deadline) throw new Error(`${s.id}: the MCU worker did not start`);
        await new Promise((r) => setTimeout(r, 2));
      }
    }
    this.checkStarted();
  }

  private checkStarted(): void {
    this.started = true;
    for (const s of this.threadSlots) {
      const status = Atomics.load(s.ch.i32, H_STATUS);
      if (status === STATUS_STARTING) throw new Error(`${s.id}: the MCU worker is not ready (call ready() first)`);
      if (status !== STATUS_READY) throw new Error(s.ch.error() || `${s.id}: the MCU worker failed`);
    }
  }

  /** Write a slot's inputs for the next quantum and (worker) start it. */
  private begin(s: Slot, toNs: number): void {
    const { ch, remote: r } = s;
    if (r.changed) {
      r.changed = false;
      ch.levels.set(r.levels);
      const n = Math.min(r.rx.length, RX_CAP - ch.i32[H_RX]);
      if (n > 0) {
        const base = ch.i32[H_RX];
        for (let i = 0; i < n; i++) ch.rx[base + i] = r.rx[i];
        r.rx.splice(0, n);
        ch.i32[H_RX] = base + n;
        if (r.rx.length) r.changed = true;
      }
      Atomics.add(ch.i32, H_INPUTS, 1);
    }
    if (r.ownAny) {
      r.own.fill(0);
      r.ownAny = false;
    }
    ch.f64[F_TARGET] = toNs;
    s.done = false;
    if (s.lane.thread) {
      s.go = (s.go + 1) | 0;
      Atomics.store(ch.i32, H_GO, s.go);
      Atomics.notify(ch.i32, H_GO);
    }
  }

  /** Serve worker requests and collect finished workers until all are done. */
  private waitThreads(): void {
    const door = this.door!;
    let lastProgress = now();
    while (this.pendingThreads > 0) {
      const bell = Atomics.load(door, 0);
      if (this.pollThreads()) {
        lastProgress = now();
        continue;
      }
      for (let k = 0; Atomics.load(door, 0) === bell && k < this.spin; k++);
      if (Atomics.load(door, 0) !== bell) continue;
      if (Atomics.wait(door, 0, bell, 100) === 'timed-out' && now() - lastProgress > this.timeoutMs) {
        throw new Error('An MCU worker stopped responding');
      }
    }
  }

  /** One pass over the worker slots. Returns true if anything happened. */
  private pollThreads(): boolean {
    let progressed = false;
    for (const s of this.threadSlots) {
      if (s.done) continue;
      const i32 = s.ch.i32;
      if (Atomics.load(i32, H_REQ) !== Atomics.load(i32, H_REP)) {
        this.serve(s);
        progressed = true;
      }
      if (Atomics.load(i32, H_DONE) === s.go) {
        s.ch.drain(s.queue);
        s.done = true;
        this.pendingThreads--;
        progressed = true;
        if (Atomics.load(i32, H_STATUS) === STATUS_FAILED) throw new Error(`${s.id}: ${s.ch.error() || 'MCU failed'}`);
      } else if (s.ch.drain(s.queue)) {
        progressed = true; // keeps the ring from filling up
      }
    }
    return progressed;
  }

  /** Answer a synchronous request from MCU `s`, after applying its own earlier outputs. */
  private serve(s: Slot): void {
    const { ch, host } = s;
    const i32 = ch.i32;
    const kind = i32[H_KIND];
    const a = i32[H_A];
    const b = i32[H_B];
    const t = ch.f64[F_TIME];
    ch.drain(s.queue);
    const outer = this.applying;
    this.applying = s;
    try {
      while (s.queue.pending) this.applyGroup(s);
      s.queue.clear();
      let reply = 0;
      switch (kind) {
        case RQ_ADC:
          reply = host.analogRead(a, t);
          break;
        case RQ_I2C_START:
          host.i2c?.start(t);
          break;
        case RQ_I2C_CONNECT:
          reply = host.i2c?.connect(t, a, b !== 0) ? 1 : 0;
          break;
        case RQ_I2C_WRITE:
          reply = host.i2c?.write(t, a) ? 1 : 0;
          break;
        case RQ_I2C_READ:
          reply = host.i2c ? host.i2c.read(t, a !== 0) : 0xff;
          break;
        case RQ_I2C_STOP:
          host.i2c?.stop(t);
          break;
        case RQ_SPI:
          reply = host.spi ? host.spi.transfer(t, a) : 0xff;
          break;
        // RQ_SYNC / RQ_FLUSH: applying the outputs (above) and sending inputs (below) is the answer.
      }
      ch.f64[F_REPLY] = reply;
    } finally {
      this.applying = outer;
    }
    // Inputs changed by the MCU's own outputs are visible to it right away, as in-process.
    const r = s.remote;
    if (r.ownAny) {
      for (let p = 0; p < r.own.length; p++) {
        if (!r.own[p]) continue;
        r.own[p] = 0;
        ch.levels[p] = r.levels[p];
      }
      r.ownAny = false;
      Atomics.add(i32, H_INPUTS, 1);
    }
    Atomics.store(i32, H_REP, Atomics.load(i32, H_REQ));
    if (s.lane.thread) Atomics.notify(i32, H_REP);
  }

  /** Apply the events left from this quantum, all MCUs merged in time order (ties: board order). */
  private applyAll(): void {
    for (;;) {
      let best: Slot | null = null;
      let bestT = Infinity;
      for (const s of this.slots) {
        const q = s.queue;
        if (q.head < q.t.length && q.t[q.head] < bestT) {
          best = s;
          bestT = q.t[q.head];
        }
      }
      if (!best) break;
      this.applying = best;
      this.applyGroup(best);
    }
    this.applying = null;
    for (const s of this.slots) s.queue.clear();
  }

  /** Apply the events of `s` that share the time of its next event (pin changes → one solve). */
  private applyGroup(s: Slot): void {
    const q = s.queue;
    const t = q.t[q.head];
    const { host, remote } = s;
    const pins = this.pins;
    pins.length = 0;
    while (q.head < q.t.length && q.t[q.head] === t) {
      const kind = q.kind[q.head];
      const arg = q.arg[q.head++];
      if (kind === EV_PIN) {
        remote.drives[arg >> 8] = arg & 0xff;
        pins.push(arg >> 8);
        continue;
      }
      if (pins.length) {
        host.outputs(t, pins);
        pins.length = 0;
      }
      if (kind === EV_TX) host.uartTx(arg >> 8, arg & 0xff, t);
      else if (kind === EV_RX) host.uartRx?.(arg >> 8, arg & 0xff, t);
    }
    if (pins.length) host.outputs(t, pins);
  }
}

/**
 * How to spread `mcus` microcontrollers over `cores` CPU cores. Null when one thread is best
 * (a single MCU, or a single core). By default the coordinator's thread runs lane 0 itself:
 * with N lanes on N cores nobody sleeps, and threads never wait on an idle coordinator.
 */
export function planLanes(mcus: number, cores: number): { threads: number; inline: boolean; spin: number } | null {
  const lanes = Math.min(mcus, Math.max(1, Math.floor(cores)));
  if (lanes < 2) return null;
  return { threads: lanes - 1, inline: true, spin: 20_000 };
}
