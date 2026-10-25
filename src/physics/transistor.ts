// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../core/types';

/** Base-emitter voltage that turns a silicon transistor on. */
export const VBE_ON = 0.6;

/**
 * Switching model of a bipolar transistor (no gain, no linear region):
 * collector and emitter are joined while the base-emitter junction is forward
 * biased by ≥ 0.6 V. NPN: V(B) − V(E); PNP: V(E) − V(B).
 * Works for the usual low-side (NPN, emitter to GND) and high-side (PNP, emitter
 * to the supply) switches.
 */
export function bjtSwitch(kind: 'npn' | 'pnp'): ModelFactory {
  return (ctx) => {
    let on = false;
    const conducting = () => {
      const b = ctx.voltage('B');
      const e = ctx.voltage('E');
      if (b === null || e === null) return false;
      return (kind === 'npn' ? b - e : e - b) >= VBE_ON;
    };
    return {
      switches: () => (on ? [['C', 'E']] : []),
      onPinChange() {
        const next = conducting();
        if (next === on) return;
        on = next;
        ctx.invalidate(true); // connectivity changed
      },
      state: () => ({ on }),
    };
  };
}
