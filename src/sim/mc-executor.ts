// SPDX-License-Identifier: Apache-2.0
/**
 * MCU side of a remote microcontroller (docs/MULTICORE.md): owns the real McuRuntime and a
 * host that turns its callbacks into ring events (outputs, UART) and synchronous requests
 * (analogRead, I²C, SPI, read-after-write). Runs in an MCU worker thread, or inline in the
 * coordinator's thread with the same channel layout.
 */
import { createRuntime } from '../mcu/families';
import { decodeLevel, type McuDescriptor, type McuHost, type McuRuntime } from '../mcu/runtime';
import {
  EV_PIN,
  EV_RX,
  EV_TX,
  F_REPLY,
  F_TARGET,
  F_TIME,
  H_A,
  H_B,
  H_INPUTS,
  H_KIND,
  H_REQ,
  H_RX,
  RQ_ADC,
  RQ_FLUSH,
  RQ_I2C_CONNECT,
  RQ_I2C_READ,
  RQ_I2C_START,
  RQ_I2C_STOP,
  RQ_I2C_WRITE,
  RQ_SPI,
  RQ_SYNC,
  type McuChannel,
} from './mc-channel';

/**
 * `call(seq)` hands request `seq` to the coordinator and returns once it is answered
 * (inline: a direct call; worker: doorbell + wait).
 */
export type RequestCall = (seq: number) => void;

export class McuExecutor {
  readonly runtime: McuRuntime;
  /** Input levels already applied to the runtime (255 = never). */
  private readonly applied: Uint8Array;
  private inputsSeen = -1;
  /** Outputs were reported since the coordinator last answered a request. */
  private dirty = false;
  private seq = 0;

  constructor(
    private readonly ch: McuChannel,
    descriptor: McuDescriptor,
    firmware: string,
    private readonly call: RequestCall,
  ) {
    const req = (kind: number, a: number, b: number, t: number) => this.request(kind, a, b, t);
    const host: McuHost = {
      outputs: (t, pins) => {
        for (const p of pins) this.push(t, EV_PIN, (p << 8) | this.runtime.drive(p));
        this.dirty = true;
      },
      uartTx: (port, byte, t) => this.push(t, EV_TX, (port << 8) | (byte & 0xff)),
      uartRx: (port, byte, t) => this.push(t, EV_RX, (port << 8) | (byte & 0xff)),
      analogRead: (channel, t) => req(RQ_ADC, channel, 0, t),
      i2c: {
        start: (t) => void req(RQ_I2C_START, 0, 0, t),
        connect: (t, address, read) => req(RQ_I2C_CONNECT, address, read ? 1 : 0, t) !== 0,
        write: (t, byte) => req(RQ_I2C_WRITE, byte & 0xff, 0, t) !== 0,
        read: (t, ack) => req(RQ_I2C_READ, ack ? 1 : 0, 0, t),
        stop: (t) => void req(RQ_I2C_STOP, 0, 0, t),
      },
      spi: { transfer: (t, byte) => req(RQ_SPI, byte & 0xff, 0, t) },
      // Read-after-write: only costs a round trip when outputs changed since the last one.
      syncInputs: () => {
        if (this.dirty) req(RQ_SYNC, 0, 0, this.runtime.timeNs);
      },
    };
    this.applied = new Uint8Array(descriptor.pins).fill(255);
    this.runtime = createRuntime(descriptor, firmware, host);
  }

  /**
   * Run one quantum: apply the inputs the coordinator wrote, then run to the target time.
   * `poll` (inline MCUs next to worker threads) is called every `chunkNs` of simulated time
   * so the coordinator can serve the workers' requests meanwhile.
   */
  runQuantum(poll?: () => void, chunkNs = 5_000): void {
    this.readInputs();
    const target = this.ch.f64[F_TARGET];
    const rt = this.runtime;
    if (!poll) {
      rt.runUntil(target);
      return;
    }
    for (let t = rt.timeNs; t < target; ) {
      t = Math.min(target, t + chunkNs);
      rt.runUntil(t);
      poll();
    }
  }

  private readInputs(): void {
    const ch = this.ch;
    const v = Atomics.load(ch.i32, H_INPUTS);
    if (v === this.inputsSeen) return;
    this.inputsSeen = v;
    const { levels } = ch;
    const applied = this.applied;
    for (let p = 0; p < applied.length; p++) {
      const x = levels[p];
      if (x === applied[p]) continue;
      applied[p] = x;
      this.runtime.setInput(p, decodeLevel(x));
    }
    const n = ch.i32[H_RX];
    if (n) {
      ch.i32[H_RX] = 0;
      for (let i = 0; i < n; i++) this.runtime.uartReceive(ch.rx[i] >> 8, ch.rx[i] & 0xff);
    }
  }

  private push(t: number, kind: number, arg: number): void {
    while (!this.ch.tryPush(t, kind, arg)) this.request(RQ_FLUSH, 0, 0, t);
  }

  private request(kind: number, a: number, b: number, t: number): number {
    const ch = this.ch;
    ch.i32[H_KIND] = kind;
    ch.i32[H_A] = a;
    ch.i32[H_B] = b;
    ch.f64[F_TIME] = t;
    this.seq = (this.seq + 1) | 0;
    Atomics.store(ch.i32, H_REQ, this.seq);
    this.call(this.seq);
    // The coordinator applied our outputs before answering, and may have sent new input levels.
    this.dirty = false;
    this.readInputs();
    return ch.f64[F_REPLY];
  }
}
