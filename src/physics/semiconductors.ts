// SPDX-License-Identifier: Apache-2.0
/**
 * Models of discrete diodes, MOSFETs and Darlington transistors, built from the solver's
 * piecewise-linear elements (see docs/SOLVER.md).
 */
import type { AnalogElement, ModelFactory, PartContext } from '../core/types';

/** Current above which a semiconductor is shown as conducting. */
const ON_AMPS = 1e-6;

const mA = (amps: number) => Math.round(amps * 1e4) / 10;

/** Warns once when |current| goes above `max` amps. */
function overcurrent(ctx: PartContext, label: string, max: number): (amps: number) => void {
  let warned = false;
  return (amps) => {
    if (warned || Math.abs(amps) <= max) return;
    warned = true;
    ctx.warn(`${label} carries ${Math.round(Math.abs(amps) * 1000)} mA, more than its ${Math.round(max * 1000)} mA maximum`);
  };
}

export interface DiodeSpec {
  /** Part number used in messages, e.g. "1N4148". */
  name: string;
  /** Forward voltage (knee) and series resistance. */
  vf: number;
  ohms: number;
  /** Reverse breakdown voltage (zener voltage, or the rated reverse voltage of a rectifier). */
  breakdown?: number;
  /** Largest continuous forward current. */
  maxAmps: number;
}

/**
 * A diode from pin A (anode) to pin K (cathode). State: `on` (conducting forward),
 * `breakdown` (zener conduction), `mA` (anode → cathode current, negative in breakdown).
 * A `voltage` prop, when present, sets the reverse breakdown (zener) voltage.
 */
export function diodeModel(spec: DiodeSpec): ModelFactory {
  return (ctx) => {
    const zener = Number(ctx.props.voltage);
    const breakdown = zener > 0 ? zener : spec.breakdown;
    const d: AnalogElement = { kind: 'D', anode: 'A', cathode: 'K', vf: spec.vf, ohms: spec.ohms, id: 'd' };
    if (breakdown) d.zener = breakdown;
    const els = [d];
    const check = overcurrent(ctx, `Diode ${ctx.id} (${spec.name})`, spec.maxAmps);
    return {
      elements: () => els,
      state() {
        const amps = ctx.current('d');
        check(amps);
        return { on: amps > ON_AMPS, breakdown: amps < -ON_AMPS, mA: mA(amps) };
      },
    };
  };
}

export interface FetSpec {
  name: string;
  type: 'n' | 'p';
  /** Gate threshold (|VGS|) and on-resistance with a 5 V gate drive. */
  vth: number;
  rdsOn: number;
  maxAmps: number;
  /** Drain-source breakdown voltage: above it the body diode avalanches (clamps the drain). */
  vdss: number;
}

/**
 * MOSFET with pins G, D, S: a FET element (switch above the gate threshold) plus the
 * body diode every power MOSFET has (source → drain for N-channel), which avalanches at VDSS:
 * switching off a coil with no flyback diode clamps the drain there instead of at thousands of
 * volts, and the part warns. The gate draws no current, so a floating gate is off: use a
 * pull-down resistor as in a real circuit. State: `on`, `mA` (drain → source current).
 */
export function fetModel(spec: FetSpec | ((ctx: PartContext) => FetSpec)): ModelFactory {
  return (ctx) => {
    const s = typeof spec === 'function' ? spec(ctx) : spec;
    const n = s.type === 'n';
    const els: AnalogElement[] = [
      { kind: 'FET', type: s.type, g: 'G', d: 'D', s: 'S', vth: s.vth, rdsOn: s.rdsOn, id: 'q' },
      { kind: 'D', anode: n ? 'S' : 'D', cathode: n ? 'D' : 'S', vf: 0.8, ohms: 0.5, zener: s.vdss, id: 'body' },
    ];
    const check = overcurrent(ctx, `MOSFET ${ctx.id} (${s.name})`, s.maxAmps);
    let avalanche = false;
    return {
      elements: () => els,
      onPinChange() {
        if (avalanche || ctx.current('body') > -1e-3) return;
        avalanche = true;
        ctx.warn(`MOSFET ${ctx.id} (${s.name}): a ${s.vdss} V spike at the drain when it switched off. Add a flyback diode across the motor or coil.`);
      },
      state() {
        const amps = ctx.current('q');
        check(amps);
        // Shown as on when the gate is above the threshold, even with no load connected.
        const g = ctx.voltage('G');
        const src = ctx.voltage('S');
        const vgs = g === null || src === null ? 0 : n ? g - src : src - g;
        return { on: vgs > s.vth || Math.abs(amps) > ON_AMPS, mA: mA(amps) };
      },
    };
  };
}

/**
 * Darlington transistor (TIP120): two NPN BJTs in one package, with the base-emitter
 * resistors (≈ 8 kΩ, 120 Ω) and the collector–emitter protection diode of the real chip:
 *
 *      C ──┬──────────┬────────┐
 *          Q1         Q2       ▲ D (E → C)
 *   B ── Q1.b   Q1.e = Q2.b    │
 *      R1 8k B–M   R2 120 Ω M–E│
 *      E ─────────────┴────────┘
 *
 * The internal node M is an element pin that is not a part pin (the solver gives it its
 * own net). Overall: VBE ≈ 1.3–1.4 V, hFE ≈ 1000 at a few hundred mA, VCE(sat) ≈ 0.9 V.
 * State: `on`, `ic` (collector current in mA).
 */
export function darlingtonModel(beta1: number, beta2: number, maxAmps: number, name: string): ModelFactory {
  return (ctx) => {
    const els: AnalogElement[] = [
      { kind: 'BJT', type: 'npn', b: 'B', c: 'C', e: 'M', beta: beta1, id: 'q1' },
      { kind: 'BJT', type: 'npn', b: 'M', c: 'C', e: 'E', beta: beta2, id: 'q2' },
      { kind: 'R', a: 'B', b: 'M', ohms: 8000, id: 'r1' },
      { kind: 'R', a: 'M', b: 'E', ohms: 120, id: 'r2' },
      // The C–E diode; its breakdown stands for the 60 V VCEO rating.
      { kind: 'D', anode: 'E', cathode: 'C', vf: 0.7, ohms: 0.3, zener: 60, id: 'd' },
    ];
    const check = overcurrent(ctx, `Transistor ${ctx.id} (${name})`, maxAmps);
    return {
      elements: () => els,
      state() {
        const ic = ctx.current('q1') + ctx.current('q2');
        check(ic);
        return { on: ic > ON_AMPS, ic: mA(ic) };
      },
    };
  };
}
