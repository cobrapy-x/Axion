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

/** Logic level of a net. `null` = floating / undefined / shorted. */
export type Level = 0 | 1 | null;

/**
 * How a part drives one of its pins.
 * - 'z'        high impedance (input, not connected internally)
 * - 'high'/'low' strong drive (push-pull output, power rail)
 * - 'pullup'/'pulldown' weak drive (internal pull resistor)
 */
export type Drive = 'z' | 'high' | 'low' | 'pullup' | 'pulldown';

// ─────────────────────────────── Manifest ───────────────────────────────

export interface PropSpec {
  type: 'string' | 'number' | 'select' | 'boolean';
  label?: string;
  default: string | number | boolean;
  options?: string[];
}

export interface McuSpec {
  /** CPU architecture, used to pick the emulator. */
  arch: 'avr';
  /** Arduino fully-qualified board name, used by the local compiler. */
  fqbn: string;
  /** Default sketch shown when the part is added. */
  template?: string;
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
}

// ─────────────────────────────── Model (worker) ─────────────────────────

export type Props = Record<string, string | number | boolean>;

/** What the engine gives each part model. */
export interface PartContext {
  readonly id: string;
  readonly props: Props;
  /** Current simulation time in nanoseconds. */
  now(): number;
  /** Solved level of the net attached to one of this part's pins. */
  level(pin: string): Level;
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
  /** Firmware for MCU parts (Intel HEX text), if any. */
  readonly firmware?: string;
}

export interface PartModel {
  /** Drive applied on a pin. Default: 'z'. */
  drive?(pin: string): Drive;
  /** Pin pairs that are currently connected by a closed switch. */
  switches?(): Array<[string, string]>;
  /** Pin pairs linked through a resistor. */
  resistors?(): Array<[string, string]>;
  /** Called when the level of a net attached to `pin` changes. */
  onPinChange?(pin: string, level: Level): void;
  /** Data unit received on `pin` (see PartContext.sendData). */
  onData?(pin: string, channel: string, value: number): void;
  /** Advance internal state (e.g. run CPU instructions) up to `timeNs`. */
  step?(timeNs: number): void;
  /** Input from the UI (button press, serial text…). */
  input?(event: string, data?: unknown): void;
  /** Snapshot sent to the view ~60 times/second. Keep it small. */
  state?(): Record<string, unknown>;
}

export type ModelFactory = (ctx: PartContext) => PartModel;

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
