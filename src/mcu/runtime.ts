// SPDX-License-Identifier: Apache-2.0
/**
 * Chip-independent microcontroller runtime: the seam between a board model (src/mcu/board.ts),
 * which knows about pins, nets and parts, and a CPU emulator (avr8js today; rp2040js and
 * Espressif's QEMU later), which knows about registers and instructions.
 *
 * A runtime never touches the circuit. Everything it needs from the outside world goes
 * through its `McuHost`, with the MCU's own clock as the timestamp:
 *   - GPIO outputs:   `host.outputs(timeNs, pins)` when pin drives changed
 *   - GPIO inputs:    `runtime.setInput(pin, level)`
 *   - analogRead():   `host.analogRead(channel, timeNs)` returns volts
 *   - UART:           `host.uartTx(...)` out, `runtime.uartReceive(...)` in
 *   - I²C / SPI:      `host.i2c` / `host.spi`, synchronous controller calls (see buses.ts)
 *
 * Because the interface is this narrow, the same runtime runs in-process (single-threaded
 * engine) or in its own worker behind a proxy (multi-core, see docs/MULTICORE.md).
 */
import type { Level } from '../core/types';

/** Pin drive codes, compact so they fit in a shared ring buffer. Index into DRIVE_NAMES. */
export const PIN_Z = 0;
export const PIN_LOW = 1;
export const PIN_HIGH = 2;
export const PIN_PULLUP = 3;
export const PIN_PULLDOWN = 4;
export type PinDrive = typeof PIN_Z | typeof PIN_LOW | typeof PIN_HIGH | typeof PIN_PULLUP | typeof PIN_PULLDOWN;

/** I²C controller (master) as seen by a runtime. `t` is the MCU's clock in ns at the call. */
export interface I2CBus {
  start(t: number): void;
  /** Address phase; true = ACK. */
  connect(t: number, address: number, read: boolean): boolean;
  write(t: number, byte: number): boolean;
  read(t: number, ack: boolean): number;
  stop(t: number): void;
}

/** SPI controller (master): full-duplex byte exchange with the selected devices. */
export interface SPIBus {
  transfer(t: number, byte: number): number;
}

/** What a runtime may ask of the board / circuit around it. */
export interface McuHost {
  /** The drives of `pins` changed at `timeNs` (read them with `runtime.drive()`). `pins` is reused: copy it to keep it. */
  outputs(timeNs: number, pins: readonly number[]): void;
  /** A byte left UART `port`'s transmitter. */
  uartTx(port: number, byte: number, timeNs: number): void;
  /** A byte entered UART `port`'s receiver (drives the RX LED). */
  uartRx?(port: number, byte: number, timeNs: number): void;
  /** Voltage on analog input `channel` at `timeNs` (analogRead). */
  analogRead(channel: number, timeNs: number): number;
  i2c?: I2CBus;
  spi?: SPIBus;
  /**
   * Called just before the firmware samples its input pins (e.g. a PIN register read).
   * In-process hosts leave it out: outputs reach the circuit immediately anyway. A remote
   * host uses it to push pending outputs and fetch fresh inputs, so "write a pin, then read
   * another one" (keypad scanning, loopback wires) behaves exactly as in-process.
   */
  syncInputs?(): void;
}

export interface McuRuntime {
  /** The MCU's own clock, in ns. */
  readonly timeNs: number;
  /** Run the CPU until its clock reaches `ns`. */
  runUntil(ns: number): void;
  /** Level seen on GPIO `pin` (index into the descriptor's pin list) changed. */
  setInput(pin: number, level: Level): void;
  /** Current drive of GPIO `pin`. */
  drive(pin: number): PinDrive;
  /** A byte arrived for UART `port`'s receiver (queued until the receiver is free). */
  uartReceive(port: number, byte: number): void;
  /** Release resources (out-of-process runtimes, timers). */
  dispose?(): void;
}

/**
 * Everything needed to build a runtime, in a form that can be posted to a worker
 * (structured-cloneable: plain data, no functions).
 */
export interface McuDescriptor {
  /** Runtime family, e.g. 'avr' (see families.ts). */
  family: string;
  /** Number of GPIO pins the board maps (runtime pin indices 0 … pins-1). */
  pins: number;
  /** Family-specific configuration (chip, pin mapping…). */
  config: unknown;
}

export type RuntimeFactory = (config: unknown, firmware: string, host: McuHost) => McuRuntime;

/** Level ⇄ byte, for shared memory. */
export const encodeLevel = (level: Level): number => (level === null ? 2 : level);
export const decodeLevel = (v: number): Level => (v === 2 ? null : (v as 0 | 1));
