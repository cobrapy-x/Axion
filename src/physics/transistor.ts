// SPDX-License-Identifier: Apache-2.0
import type { AnalogElement, ModelFactory } from '../core/types';

/** Base-emitter voltage of a conducting silicon transistor (the solver's BJT model). */
export const VBE_ON = 0.65;

/** Collector current above which the transistor is shown as conducting. */
const ON_AMPS = 1e-6;

/**
 * Bipolar transistor as a BJT element (see docs/SOLVER.md): cutoff below VBE ≈ 0.65 V,
 * active region with IC = β·IB, saturation at VCE ≈ 0.2 V. Works as a low-side (NPN,
 * emitter to GND) or high-side (PNP, emitter to the supply) switch and as an amplifier.
 * State: `on` (collector current flows), `ic` (collector current in mA).
 */
export function bjtModel(kind: 'npn' | 'pnp', beta: number): ModelFactory {
  return (ctx) => {
    const els: AnalogElement[] = [{ kind: 'BJT', type: kind, b: 'B', c: 'C', e: 'E', beta, id: 'q' }];
    return {
      elements: () => els,
      state() {
        const ic = Math.abs(ctx.current('q'));
        return { on: ic > ON_AMPS, ic: Math.round(ic * 1e4) / 10 };
      },
    };
  };
}
