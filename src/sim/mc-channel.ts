// SPDX-License-Identifier: Apache-2.0
/**
 * Shared memory between the coordinator and one remote MCU (docs/MULTICORE.md).
 * The same layout is used over a SharedArrayBuffer (MCU in a worker thread) and over a
 * plain ArrayBuffer (MCU run inline by the coordinator, and the in-process transport used
 * by tests), so both paths run the same encode / decode code.
 *
 * Layout (bytes):
 *   0    Int32 header[16]      sequence numbers, request fields, ring indices
 *   64   Float64 f64[4]        quantum target, request time, reply value
 *   96   ring times  Float64[RING]
 *   …    ring data   Int32[RING * 2]   (kind, arg) per event
 *   …    levels      Uint8[pins]       input levels the MCU should see (0, 1, 2 = floating)
 *   …    rx          Uint8[RX_CAP]     UART bytes delivered at the start of a quantum
 *   …    err         Uint8[ERR_CAP]    error text if the MCU failed
 */

// ── Header words (Int32) ──
/** MCU side: 0 starting, 1 ready, 2 failed. */
export const H_STATUS = 0;
/** Coordinator: quantum sequence number; bumping it starts a quantum. */
export const H_GO = 1;
/** MCU: set to H_GO's value when the quantum is finished. */
export const H_DONE = 2;
/** Coordinator: CMD_RUN or CMD_STOP. */
export const H_CMD = 3;
/** MCU: request sequence number (a request is pending while H_REQ ≠ H_REP). */
export const H_REQ = 4;
/** Coordinator: set to H_REQ's value once the reply is written. */
export const H_REP = 5;
export const H_KIND = 6;
export const H_A = 7;
export const H_B = 8;
/** Coordinator: bumped whenever `levels` or `rx` changed. */
export const H_INPUTS = 9;
/** Number of bytes in `rx` (the MCU zeroes it once consumed). */
export const H_RX = 10;
/** Ring write counter (MCU) and read counter (coordinator). */
export const H_HEAD = 11;
export const H_TAIL = 12;
export const H_ERRLEN = 13;
const HEADER_INTS = 16;

// ── Float64 slots ──
export const F_TARGET = 0;
export const F_TIME = 1;
export const F_REPLY = 2;
const FLOATS = 4;

export const STATUS_STARTING = 0;
export const STATUS_READY = 1;
export const STATUS_FAILED = 2;
export const CMD_RUN = 0;
export const CMD_STOP = 1;

/** Ring slots (power of two). A full ring makes the MCU ask for a flush. */
export const RING = 4096;
const MASK = RING - 1;
export const RX_CAP = 1024;
const ERR_CAP = 512;

// ── MCU → coordinator events (ring) ──
/** arg = pin << 8 | PinDrive */
export const EV_PIN = 1;
/** arg = port << 8 | byte */
export const EV_TX = 2;
export const EV_RX = 3;

// ── MCU → coordinator synchronous requests ──
/** Outputs changed and the firmware is about to read its inputs. */
export const RQ_SYNC = 1;
/** The ring is full. */
export const RQ_FLUSH = 2;
/** a = channel; reply = volts */
export const RQ_ADC = 3;
export const RQ_I2C_START = 4;
/** a = address, b = read; reply = ack */
export const RQ_I2C_CONNECT = 5;
/** a = byte; reply = ack */
export const RQ_I2C_WRITE = 6;
/** a = ack; reply = byte */
export const RQ_I2C_READ = 7;
export const RQ_I2C_STOP = 8;
/** a = byte; reply = byte */
export const RQ_SPI = 9;

const align8 = (n: number) => (n + 7) & ~7;

function layout(pins: number) {
  const f64 = HEADER_INTS * 4;
  const ringT = f64 + FLOATS * 8;
  const ringD = ringT + RING * 8;
  const levels = ringD + RING * 8;
  const rx = levels + align8(pins);
  const err = rx + RX_CAP;
  return { f64, ringT, ringD, levels, rx, err, bytes: align8(err + ERR_CAP) };
}

/** Events taken off the ring, waiting to be applied to the circuit. */
export class EventQueue {
  t: number[] = [];
  kind: number[] = [];
  arg: number[] = [];
  head = 0;

  get pending(): number {
    return this.t.length - this.head;
  }

  clear(): void {
    this.t.length = this.kind.length = this.arg.length = 0;
    this.head = 0;
  }
}

export class McuChannel {
  readonly i32: Int32Array;
  readonly f64: Float64Array;
  readonly ringT: Float64Array;
  readonly ringD: Int32Array;
  readonly levels: Uint8Array;
  readonly rx: Uint8Array;
  private readonly err: Uint8Array;
  /** MCU side: next ring slot to write. */
  private head = 0;

  constructor(
    readonly buffer: ArrayBufferLike,
    readonly pins: number,
  ) {
    const l = layout(pins);
    this.i32 = new Int32Array(buffer, 0, HEADER_INTS);
    this.f64 = new Float64Array(buffer, l.f64, FLOATS);
    this.ringT = new Float64Array(buffer, l.ringT, RING);
    this.ringD = new Int32Array(buffer, l.ringD, RING * 2);
    this.levels = new Uint8Array(buffer, l.levels, pins);
    this.rx = new Uint8Array(buffer, l.rx, RX_CAP);
    this.err = new Uint8Array(buffer, l.err, ERR_CAP);
  }

  /** A new channel; `shared` for a worker thread, plain memory for an inline MCU. */
  static create(pins: number, shared: boolean): McuChannel {
    const bytes = layout(pins).bytes;
    return new McuChannel(shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes), pins);
  }

  // ── MCU side ──

  /** Append an event; false if the ring is full. */
  tryPush(t: number, kind: number, arg: number): boolean {
    const head = this.head;
    if (((head - Atomics.load(this.i32, H_TAIL)) | 0) >= RING) return false;
    const i = head & MASK;
    this.ringT[i] = t;
    this.ringD[2 * i] = kind;
    this.ringD[2 * i + 1] = arg;
    this.head = (head + 1) | 0;
    Atomics.store(this.i32, H_HEAD, this.head);
    return true;
  }

  setError(message: string): void {
    const bytes = new TextEncoder().encode(message).slice(0, ERR_CAP);
    this.err.set(bytes);
    Atomics.store(this.i32, H_ERRLEN, bytes.length);
  }

  // ── coordinator side ──

  /** Move every event written so far into `q`. Returns the number moved. */
  drain(q: EventQueue): number {
    const head = Atomics.load(this.i32, H_HEAD);
    let tail = this.i32[H_TAIL];
    const n = (head - tail) | 0;
    if (!n) return 0;
    for (; tail !== head; tail = (tail + 1) | 0) {
      const i = tail & MASK;
      q.t.push(this.ringT[i]);
      q.kind.push(this.ringD[2 * i]);
      q.arg.push(this.ringD[2 * i + 1]);
    }
    Atomics.store(this.i32, H_TAIL, tail);
    return n;
  }

  error(): string {
    const n = Atomics.load(this.i32, H_ERRLEN);
    // TextDecoder refuses views of shared memory: copy first.
    return n ? new TextDecoder().decode(this.err.slice(0, n)) : '';
  }
}

/** Block until `i32[index]` differs from `old`: spin a little (cheap when the other side is about to answer), then sleep. */
export function waitChange(i32: Int32Array, index: number, old: number, spin: number): void {
  for (let k = 0; Atomics.load(i32, index) === old; ) {
    if (++k > spin) Atomics.wait(i32, index, old, 1000);
  }
}
