// SPDX-License-Identifier: Apache-2.0
/**
 * Core types shared by the simulation engine (runs in a Web Worker)
 * and the editor/UI (runs on the main thread).
 *
 * A *part* is made of three files in `src/parts/<folder>/`:
 *   - part.json  → PartManifest (metadata, pins, properties)
 *   - model.ts   → ModelFactory (behaviour; runs inside the simulation worker)
 *   - view.ts    → PartView     (drawing + animation; runs on the main thread)
 */

import type { McuDescriptor, McuHost, McuRuntime } from '../mcu/runtime';

/** Logic level of a net. `null` = floating / in-between / shorted. */
export type Level = 0 | 1 | null;

/** Supply voltage used for 'high' and 'pullup' drives. */
export const VCC = 5;

/**
 * How a part drives one of its pins (see docs/SOLVER.md for the electrical model).
 * - 'z'                 high impedance (input, not connected internally)
 * - 'high' / 'low'      push-pull output: VCC / 0 V behind a pin's output resistance (~25 Ω)
 * - number              stiff (ideal) source of that many volts: power pins, batteries, motor driver outputs
 * - 'pullup'/'pulldown' weak drive: internal pull resistor (~35 kΩ) to VCC / 0 V
 * - { volts, ohms }     a source of `volts` behind `ohms` (0 / omitted = stiff). Below 1 kΩ it counts as a
 *                       strong drive, above as a pull. Use it for other logic families (e.g. 3.3 V MCUs).
 */
export type Drive = 'z' | 'high' | 'low' | 'pullup' | 'pulldown' | number | SourceDrive;

export interface SourceDrive {
  volts: number;
  ohms?: number;
}

/** Input thresholds of a logic family: at or above `vih` reads HIGH, at or below `vil` reads LOW. */
export interface LogicThresholds {
  vih: number;
  vil: number;
}

/**
 * CMOS input thresholds for a supply voltage: VIH = 0.6 × VCC, VIL = 0.3 × VCC (the ATmega
 * datasheet values; 5 V gives 3.0 V / 1.5 V). Chips with fixed thresholds (e.g. the RP2040's
 * 2.0 V / 0.8 V) pass their own numbers instead.
 */
export function cmosLogic(vcc: number): LogicThresholds {
  return { vih: 0.6 * vcc, vil: 0.3 * vcc };
}

/** Default thresholds of 5 V parts. */
export const LOGIC_5V: LogicThresholds = cmosLogic(VCC);

/** Turns a net voltage into a Level (null = floating or in the undefined band between the thresholds). */
export function levelOf(volts: number | null, t: LogicThresholds = LOGIC_5V): Level {
  if (volts === null) return null;
  if (volts >= t.vih) return 1;
  if (volts <= t.vil) return 0;
  return null;
}

// ─────────────────────────────── Manifest ───────────────────────────────

export interface PropSpec {
  type: 'string' | 'number' | 'select' | 'boolean';
  label?: string;
  default: string | number | boolean;
  options?: string[];
  /** Number props with min and max are edited with a −/+ stepper in the inspector. */
  min?: number;
  max?: number;
  step?: number;
  /**
   * Can be changed while the simulation runs (e.g. a sensor's distance or light level).
   * The inspector stays enabled for it; changes reach the model as
   * `input('prop', { key, value })` and are also saved to the part's attrs.
   */
  live?: boolean;
  /** Unit shown after the value in the inspector, e.g. "cm", "lux", "Ω". */
  unit?: string;
}

export interface McuSpec {
  /** CPU architecture, used to pick the emulator. */
  arch: 'avr' | 'rp2040';
  /** Arduino fully-qualified board name, used by the local compiler. */
  fqbn: string;
  /** Default sketch shown when the part is added. */
  template?: string;
  /**
   * The board can also run MicroPython: `firmware` is the interpreter image (a file in public/,
   * fetched when needed), `template` the starter main.py. Chosen with the board's `language` prop.
   */
  micropython?: { firmware: string; template: string; version?: string };
}

export interface PartManifest {
  /** Unique type id. Wokwi-compatible parts reuse Wokwi's type (e.g. "wokwi-led"). */
  type: string;
  name: string;
  category: string;
  description?: string;
  version: string;
  /** SPDX license id of this part package. */
  license: string;
  /** Pins that are permanently connected inside the part (e.g. both GND pins). */
  internal?: string[][];
  props?: Record<string, PropSpec>;
  /** Present if the part is a programmable microcontroller board. */
  mcu?: McuSpec;
  /** True if the user interacts with the part while the simulation runs (buttons, pots…). */
  interactive?: boolean;
  /** Prefix used when auto-generating ids, e.g. "led" → led1, led2… */
  idPrefix?: string;
  /**
   * Free-form tags used by the component panel. "basic" puts the part in the
   * default "Basic" list (the parts a beginner needs first).
   */
  tags?: string[];
  /**
   * Breadboards and similar carriers: parts dropped on top snap to their holes and
   * are connected automatically. Drawn underneath other parts.
   */
  carrier?: boolean;
  /**
   * Kept so older projects still open, but not offered in the components panel
   * (e.g. replaced by a better part).
   */
  hidden?: boolean;
  /**
   * Attributes written into a part freshly added from the components panel (and used for its
   * thumbnail). The file-format defaults in `props` stay Wokwi's, so existing diagrams keep
   * their meaning; this only picks a friendlier starting point (e.g. the LCD's I²C backpack).
   */
  newAttrs?: Record<string, string>;
}

// ─────────────────────────────── Model (worker) ─────────────────────────

export type Props = Record<string, string | number | boolean>;

/** What the engine gives each part model. */
export interface PartContext {
  readonly id: string;
  readonly props: Props;
  /** Current simulation time in nanoseconds. */
  now(): number;
  /** Solved level of the net attached to one of this part's pins (using this part's logic thresholds). */
  level(pin: string): Level;
  /**
   * Sets the input thresholds this part uses for `level()` and `onPinChange` (default: 5 V CMOS,
   * see `cmosLogic`). A 3.3 V microcontroller calls `ctx.setLogic(cmosLogic(3.3))` once.
   */
  setLogic?(thresholds: LogicThresholds): void;
  /** Solved voltage of the net attached to a pin, or null if floating / shorted. */
  voltage(pin: string): number | null;
  /**
   * Tell the engine this part's drives / switches / resistors changed.
   * The engine re-solves the circuit immediately.
   */
  invalidate(topology?: boolean): void;
  /**
   * MCU parts call this with their own clock (in ns) just before `invalidate`,
   * so other parts see accurate timestamps (needed for PWM brightness etc.).
   */
  advanceTime(ns: number): void;
  /**
   * Send a data unit (e.g. a UART byte) to every other pin on the same net.
   * This is a fast "transaction level" link used for MCU↔MCU communication.
   */
  sendData(pin: string, channel: string, value: number): void;
  /** Send an event to the UI (e.g. serial output). */
  emit(event: string, data: unknown): void;
  /**
   * Other parts' pins on the same net as `pin` (transaction-level buses: I²C, SPI,
   * one-wire…). Excludes this part's own pin.
   */
  peers(pin: string): Peer[];
  /**
   * Run `fn` at simulation time `atNs` (ns, absolute). Microcontrollers are advanced to
   * exactly that moment first, so timed outputs (an ultrasonic echo, a one-shot pulse)
   * are seen with ns precision. Call `invalidate()` inside `fn` if drives changed.
   */
  schedule(atNs: number, fn: () => void): void;
  /**
   * Current through one of this part's analog elements (see AnalogElement.id), in amps, as of the
   * last solve. 0 if unknown or not conducting. Sign conventions are listed on AnalogElement.
   */
  current(elementId: string): number;
  /** Show a warning in the UI (e.g. "LED led1 has no current-limiting resistor"). Repeats are merged. */
  warn(message: string): void;
  /** Firmware for MCU parts (Intel HEX text), if any. */
  readonly firmware?: string;
  /**
   * Microcontroller boards only (src/mcu/board.ts): offer the MCU to the engine's multi-core
   * executor (docs/MULTICORE.md). Returns a stand-in runtime when the MCU will run on another
   * core, or undefined to run it in-process. Contexts made outside the Engine may omit it.
   */
  attachMcu?(descriptor: McuDescriptor, host: McuHost): McuRuntime | undefined;
}

export interface PartModel {
  /** Drive applied on a pin. Default: 'z'. */
  drive?(pin: string): Drive;
  /** Pin pairs that are currently connected by a closed switch. */
  switches?(): Array<[string, string]>;
  /** Pin pairs linked through a resistor (legacy: each becomes a 1 kΩ R element; prefer `elements()`). */
  resistors?(): Array<[string, string]>;
  /**
   * Called when the level or voltage of a net attached to `pin` changes.
   * Drives are re-evaluated automatically afterwards, so parts whose outputs depend
   * on their inputs (logic gates, motor drivers…) only need to read `ctx.voltage()` in `drive()`.
   */
  onPinChange?(pin: string, level: Level): void;
  /** Data unit received on `pin` (see PartContext.sendData). */
  onData?(pin: string, channel: string, value: number): void;
  /** Advance internal state (e.g. run CPU instructions) up to `timeNs`. */
  step?(timeNs: number): void;
  /** Input from the UI (button press, serial text…). */
  input?(event: string, data?: unknown): void;
  /** Snapshot sent to the view ~60 times/second. Keep it small. */
  state?(): Record<string, unknown>;
  /**
   * Analog elements for the circuit solver. Polled on every solve: return the same array
   * (and the same objects) while nothing changes, and update values in place or return a new
   * array when they do. Changing the number, kinds or pins of elements rebuilds the netlist.
   */
  elements?(): AnalogElement[];
  /** I²C target behaviour (see I2CDevice). */
  i2c?: I2CDevice;
  /** SPI device behaviour (see SPIDevice). */
  spi?: SPIDevice;
}

export type ModelFactory = (ctx: PartContext) => PartModel;

// ─────────────────────────────── Analog elements ────────────────────────
/**
 * Electrical elements a part can expose with `PartModel.elements()`, for the
 * analog solver (voltage dividers, RC/RL timing, diode drops, transistor bias).
 * Pin names refer to the part's own pins. `id` lets the part ask for the element's
 * current later with `ctx.current(id)`, in amps:
 *   R, C, L, SW: from `a` to `b` through the element · V: from `p` through the source to `n`
 *   (negative while it delivers power) · D: anode → cathode (negative in zener breakdown) ·
 *   BJT: into the collector (negative for a conducting PNP) · FET: from drain to source.
 * See docs/SOLVER.md for the models and their accuracy.
 */
export type AnalogElement = AnalogElementKind & {
  /**
   * Current (A) above which the solver reports a short circuit through this element (default 1 A).
   * Parts that legitimately carry more raise it: a motor's armature (stall current), power
   * transistors and diodes (a surge level well above the rating they check themselves).
   */
  maxAmps?: number;
};

type AnalogElementKind =
  | { kind: 'R'; a: string; b: string; ohms: number; id?: string }
  | { kind: 'C'; a: string; b: string; farads: number; id?: string }
  | { kind: 'L'; a: string; b: string; henries: number; id?: string }
  /** Ideal voltage source `p` − `n` = volts, with an optional series resistance. */
  | { kind: 'V'; p: string; n: string; volts: number; ohms?: number; id?: string }
  /** Diode / LED: conducts anode→cathode above `vf` with series resistance `ohms`. Optional reverse breakdown (zener). */
  | { kind: 'D'; anode: string; cathode: string; vf: number; ohms?: number; zener?: number; id?: string }
  /** Switch / relay contact / closed = `ohms` (default ~0.05 Ω), open = no connection. */
  | { kind: 'SW'; a: string; b: string; closed: boolean; ohms?: number; id?: string }
  /** Bipolar transistor (simplified: VBE ≈ 0.65 V, IC = β·IB limited by saturation). */
  | { kind: 'BJT'; type: 'npn' | 'pnp'; b: string; c: string; e: string; beta?: number; id?: string }
  /** MOSFET (simplified: switch with on-resistance above the gate threshold). */
  | { kind: 'FET'; type: 'n' | 'p'; g: string; d: string; s: string; vth: number; rdsOn?: number; id?: string };

// ─────────────────────────────── Buses (transaction level) ──────────────
/**
 * I²C target (slave) device. Exposed by a part on its SDA pin's net; the MCU's TWI
 * peripheral finds devices with `ctx.peers('SDA')` and calls these synchronously.
 */
export interface I2CDevice {
  /** 7-bit address(es) the device answers to. */
  addresses(): number[];
  /** START + address. Return true to ACK. */
  start(address: number, read: boolean): boolean;
  /** Controller wrote a byte. Return true to ACK. */
  write(byte: number): boolean;
  /** Controller reads a byte; `ack` = whether the controller will ACK it (false on the last byte). */
  read(ack: boolean): number;
  stop(): void;
}

/** SPI device on the MOSI/MISO/SCK nets, selected by its CS pin (active low unless stated). */
export interface SPIDevice {
  /** Full-duplex byte exchange while selected. Return the byte shifted out on MISO. */
  transfer(byte: number): number;
  /** True when this device's chip-select is active (read from its CS pin level). */
  selected(): boolean;
}

export interface Peer {
  id: string;
  pin: string;
  model: PartModel;
}

// ─────────────────────────────── View (main thread) ─────────────────────

export interface PinPosition {
  name: string;
  x: number;
  y: number;
}

export interface PartView {
  /** Create the DOM element for the part. */
  create(props: Props): HTMLElement;
  /** Apply new property values (from the inspector). */
  setProps?(el: HTMLElement, props: Props): void;
  /** Apply a simulation state snapshot (drives animation). */
  update?(el: HTMLElement, state: Record<string, unknown>): void;
  /** Reset visual state when the simulation stops. */
  reset?(el: HTMLElement): void;
  /** Pin positions relative to the element's top-left corner, in CSS px. */
  pins?(el: HTMLElement): PinPosition[];
  /** Wire up user interaction; call `send` to deliver input to the model. */
  attach?(el: HTMLElement, send: (event: string, data?: unknown) => void): void;
}
