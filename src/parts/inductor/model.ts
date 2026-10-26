// SPDX-License-Identifier: Apache-2.0
import { parseValue } from '../../core/analog/units';
import type { AnalogElement, ModelFactory } from '../../core/types';

/**
 * An inductor between pins 1 and 2: the inductance (L element) in series with the
 * resistance of its winding (R element) through an internal node `M`, which is not a
 * part pin. "10mH", "1H", "470uH"; resistance "1Ω", "0" for an ideal coil.
 * State: `mA`, the current from 1 to 2.
 */
const create: ModelFactory = (ctx) => {
  const henries = Math.max(1e-9, parseValue(ctx.props.inductance, 10e-3));
  const ohms = Math.max(0, parseValue(ctx.props.resistance, 1));
  const els: AnalogElement[] =
    ohms > 0
      ? [
          { kind: 'L', a: '1', b: 'M', henries, id: 'l' },
          { kind: 'R', a: 'M', b: '2', ohms, id: 'r' },
        ]
      : [{ kind: 'L', a: '1', b: '2', henries, id: 'l' }];
  return {
    elements: () => els,
    state: () => ({ mA: Math.round(ctx.current('l') * 1e5) / 100 }),
  };
};

export default create;
