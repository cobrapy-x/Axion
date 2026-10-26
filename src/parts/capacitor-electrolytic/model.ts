// SPDX-License-Identifier: Apache-2.0
import { parseValue } from '../../core/analog/units';
import type { AnalogElement, ModelFactory } from '../../core/types';

/** Reverse voltage that an electrolytic capacitor is warned about. */
const REVERSE_VOLTS = 1;

/**
 * Polarised capacitor between '+' and '−' ("100µF", "4.7uF"). Charges and discharges in
 * time; warns when it is connected the wrong way round.
 */
const create: ModelFactory = (ctx) => {
  const farads = Math.max(0, parseValue(ctx.props.capacitance, 100e-6));
  const els: AnalogElement[] = [{ kind: 'C', a: '+', b: '-', farads, id: 'c' }];
  let warned = false;
  return {
    elements: () => els,
    onPinChange() {
      const p = ctx.voltage('+');
      const n = ctx.voltage('-');
      if (!warned && p !== null && n !== null && n - p > REVERSE_VOLTS) {
        warned = true;
        ctx.warn(`Electrolytic capacitor ${ctx.id} is connected the wrong way round (− is ${(n - p).toFixed(1)} V above +)`);
      }
    },
  };
};

export default create;
