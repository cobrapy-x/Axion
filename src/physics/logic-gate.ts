// SPDX-License-Identifier: Apache-2.0
/**
 * Behavioural CMOS logic gates (74HC-style). The output is recomputed in `drive()` on
 * every solve, so gates chain without any events. Thresholds follow the supply:
 * an input is HIGH above 60 % of VCC and LOW below 30 %; anything else (or a
 * floating input) is undefined, and the output then stops driving ('z').
 */
import type { ModelFactory } from '../core/types';

export type GateKind = 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor' | 'not';

/** Minimum supply for the chip to work (74HC: 2–6 V). */
export const GATE_MIN_VCC = 2;
/** Recommended maximum supply (74HC). Above it the gate still works but the view warns. */
export const GATE_MAX_VCC = 6;

export const GATE_INPUTS: Record<GateKind, string[]> = {
  and: ['A', 'B'],
  or: ['A', 'B'],
  nand: ['A', 'B'],
  nor: ['A', 'B'],
  xor: ['A', 'B'],
  xnor: ['A', 'B'],
  not: ['A'],
};

/** Truth function of each gate. */
export const GATE_LOGIC: Record<GateKind, (a: boolean, b: boolean) => boolean> = {
  and: (a, b) => a && b,
  or: (a, b) => a || b,
  nand: (a, b) => !(a && b),
  nor: (a, b) => !(a || b),
  xor: (a, b) => a !== b,
  xnor: (a, b) => a === b,
  not: (a) => !a,
};

export function gateModel(kind: GateKind): ModelFactory {
  const inputs = GATE_INPUTS[kind];
  const logic = GATE_LOGIC[kind];
  return (ctx) => {
    /** Supply rails, or null when the chip is not powered. */
    const rails = (): { vcc: number; gnd: number } | null => {
      const vcc = ctx.voltage('VCC');
      const gnd = ctx.voltage('GND');
      if (vcc === null || gnd === null || vcc - gnd < GATE_MIN_VCC) return null;
      return { vcc, gnd };
    };
    /** 1 / 0, 'float' (not connected) or 'mid' (an in-between voltage). */
    const read = (pin: string, r: { vcc: number; gnd: number }): 0 | 1 | 'float' | 'mid' => {
      const v = ctx.voltage(pin);
      if (v === null) return 'float';
      const rel = (v - r.gnd) / (r.vcc - r.gnd);
      return rel >= 0.6 ? 1 : rel <= 0.3 ? 0 : 'mid';
    };
    const evaluate = () => {
      const r = rails();
      if (!r) return { r, out: null as boolean | null, levels: inputs.map(() => null as 0 | 1 | null), hint: 'not powered: connect VCC and GND' };
      const raw = inputs.map((p) => read(p, r));
      const levels = raw.map((x) => (x === 0 || x === 1 ? x : null));
      const bad = inputs.filter((_, i) => levels[i] === null);
      if (bad.length) {
        const why = raw[inputs.indexOf(bad[0])] === 'float' ? 'floating' : 'undefined (between LOW and HIGH)';
        return { r, out: null, levels, hint: `input ${bad.join(' and ')} ${why}: output is unpredictable` };
      }
      const out = logic(levels[0] === 1, levels[1] === 1);
      const hint = r.vcc - r.gnd > GATE_MAX_VCC + 0.05 ? `VCC above ${GATE_MAX_VCC} V` : '';
      return { r, out, levels, hint };
    };
    return {
      drive(pin) {
        if (pin !== 'Y') return 'z';
        const { r, out } = evaluate();
        if (!r || out === null) return 'z';
        return out ? r.vcc : r.gnd;
      },
      state() {
        const { r, out, levels, hint } = evaluate();
        return { powered: !!r, y: out === null ? null : out ? 1 : 0, inputs: levels, hint };
      },
    };
  };
}
