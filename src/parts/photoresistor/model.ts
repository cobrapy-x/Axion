// SPDX-License-Identifier: Apache-2.0
import { parseValue } from '../../core/analog/units';
import type { AnalogElement, ModelFactory } from '../../core/types';
import { ldrOhms } from '../../physics/ldr';

/**
 * A photoresistor between pins 1 and 2: R = R10 · (lux / 10)^(−γ), 1 MΩ in the dark.
 * The light level is a live prop (`input('prop', { key: 'lux', value })`).
 * State: `lux`, `ohms`.
 */
const create: ModelFactory = (ctx) => {
  const r10 = Math.max(1, parseValue(ctx.props.rl10, 10_000));
  const gamma = Number(ctx.props.gamma) > 0 ? Number(ctx.props.gamma) : 0.7;
  let lux = Math.max(0, Number(ctx.props.lux) || 0);
  const r = { kind: 'R', a: '1', b: '2', ohms: ldrOhms(lux, r10, gamma), id: 'r' } satisfies AnalogElement;
  const els: AnalogElement[] = [r];
  return {
    elements: () => els,
    input(event, data) {
      const d = data as { key: string; value: number };
      if (event !== 'prop' || d.key !== 'lux') return;
      lux = Math.max(0, Number(d.value) || 0);
      r.ohms = ldrOhms(lux, r10, gamma);
      ctx.invalidate();
    },
    state: () => ({ lux, ohms: Math.round(r.ohms) }),
  };
};

export default create;
