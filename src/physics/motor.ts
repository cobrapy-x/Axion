// SPDX-License-Identifier: Apache-2.0
/**
 * Brushed DC motor as an electrical load, shared by the motor parts.
 *
 * Electrically the motor is its armature: a resistance R and an inductance L in series with
 * the back-EMF, a voltage source k·ω. The circuit solver works out the current, so the motor
 * loads whatever drives it (a weak MCU pin barely turns it, a battery through a MOSFET does),
 * draws its stall current when it starts, and its inductance needs a flyback path when the
 * current is switched off.
 *
 *     '+' ──R── m1 ──L── m2 ──(+ k·ω −)── '−'
 *
 * Mechanically:  J·dω/dt = k·i − b·ω   (torque from the current, viscous friction).
 * Between updates the current is taken as constant and ω follows the exact solution of that
 * equation; updates happen whenever the circuit changes and every TICK_NS while the motor
 * turns or carries current, so PWM averages out and an idle motor costs nothing.
 *
 * Parameters come from the datasheet-style props: rated voltage, no-load speed, stall
 * current and no-load current, plus the time to reach speed:
 *   R = V / I_stall      k = (V − R·I0) / ω0      b = k·I0 / ω0      J = τ·(k²/R + b)
 * At the rated voltage and no load this gives exactly ω0 and I0; τ is the mechanical time
 * constant (spin-up and braking with shorted terminals); coasting takes J / b.
 */
import type { AnalogElement } from '../core/types';

export interface MotorParams {
  /** No-load speed at the rated voltage, in RPM (output shaft). */
  rpm: number;
  /** Rated voltage. */
  ratedVoltage: number;
  /** Current with the shaft blocked at the rated voltage (sets R). Default 1.5 A. */
  stallCurrent?: number;
  /** Current at the rated voltage with no load (sets the friction). Default 0.15 A. */
  noLoadCurrent?: number;
  /** Armature inductance in henries. Default 1.5 mH. */
  inductance?: number;
  /** Mechanical time constant in seconds (0 → 63 % of the speed). Default 0.12 s. */
  tau?: number;
}

/** How often a turning motor updates its back-EMF. */
export const TICK_NS = 1_000_000;

const RAD_TO_DEG = 180 / Math.PI;

export class ElectricMotor {
  /** Total shaft rotation in degrees (not wrapped). */
  angle = 0;
  /** Output shaft speed in rad/s. */
  omega = 0;
  /** Armature current (+ → −) in amps, as of the last update. */
  amps = 0;
  readonly ohms: number;
  readonly k: number;
  private readonly b: number;
  private readonly J: number;
  private last: number;
  private readonly emf: Extract<AnalogElement, { kind: 'V' }>;
  /** R, L and the back-EMF, for the part's `elements()`. Internal nodes: m1, m2. */
  readonly elements: AnalogElement[];

  constructor(p: MotorParams, now: number) {
    const v = Math.max(0.1, p.ratedVoltage);
    const w0 = Math.max(1e-3, (Math.max(1, p.rpm) * 2 * Math.PI) / 60);
    const stall = Math.max(0.01, p.stallCurrent ?? 1.5);
    const i0 = Math.min(stall * 0.5, Math.max(0, p.noLoadCurrent ?? 0.15));
    this.ohms = v / stall;
    this.k = (v - this.ohms * i0) / w0;
    this.b = Math.max(1e-9, (this.k * i0) / w0);
    this.J = Math.max(0.01, p.tau ?? 0.12) * ((this.k * this.k) / this.ohms + this.b);
    this.last = now;
    // A stalled motor legitimately draws its stall current: only twice that is a short.
    const maxAmps = Math.max(1, 2 * stall);
    this.emf = { kind: 'V', p: 'm2', n: '-', volts: 0, id: 'emf', maxAmps };
    this.elements = [
      { kind: 'R', a: '+', b: 'm1', ohms: this.ohms, id: 'r', maxAmps },
      { kind: 'L', a: 'm1', b: 'm2', henries: Math.max(1e-6, p.inductance ?? 1.5e-3), id: 'l', maxAmps },
      this.emf,
    ];
  }

  /** Advance the shaft to `now` (ns) with the current of the last update. */
  advance(now: number): void {
    const dt = (now - this.last) / 1e9;
    if (dt <= 0) return;
    this.last = now;
    const a = this.b / this.J;
    const wInf = (this.k * this.amps) / this.b;
    const e = Math.exp(-a * dt);
    this.angle += (wInf * dt + ((this.omega - wInf) * (1 - e)) / a) * RAD_TO_DEG;
    this.omega = wInf + (this.omega - wInf) * e;
  }

  /**
   * After a solve: advance to `now`, take the new current and update the back-EMF.
   * Returns true if the EMF changed (the circuit needs another solve).
   */
  update(now: number, amps: number): boolean {
    this.advance(now);
    this.amps = Number.isFinite(amps) ? amps : 0;
    const v = this.k * this.omega;
    if (Math.abs(v - this.emf.volts) < 1e-4) return false;
    this.emf.volts = v;
    return true;
  }

  /** Still turning or carrying current: keep updating. */
  get active(): boolean {
    return Math.abs(this.omega) > 1e-3 || Math.abs(this.amps) > 1e-5;
  }

  get rpm(): number {
    return (this.omega * 60) / (2 * Math.PI);
  }
}

/**
 * The PartModel plumbing shared by the motor parts: elements, updates after every solve
 * that touches the motor, and a TICK_NS heartbeat while it turns.
 */
export function motorDriver(motor: ElectricMotor, ctx: { now(): number; current(id: string): number; schedule(at: number, fn: () => void): void; invalidate(): void }) {
  let ticking = false;
  const tick = () => {
    ticking = false;
    if (motor.update(ctx.now(), ctx.current('r'))) ctx.invalidate();
    keepTicking();
  };
  const keepTicking = () => {
    if (ticking || !motor.active) return;
    ticking = true;
    ctx.schedule(ctx.now() + TICK_NS, tick);
  };
  return {
    elements: () => motor.elements,
    /** Call from onPinChange: the circuit was re-solved. */
    solved() {
      motor.update(ctx.now(), ctx.current('r'));
      keepTicking();
    },
  };
}

/** Voltage across two pins, or null when either side is floating. */
export function across(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}
