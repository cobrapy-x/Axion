// SPDX-License-Identifier: Apache-2.0
import { parseValue } from '../../core/analog/units';
import type { AnalogElement, ModelFactory } from '../../core/types';

/** A capacitor between pins 1 and 2: "100nF", "10µF", "4.7uF". Charges and discharges in time. */
const create: ModelFactory = (ctx) => {
  const farads = Math.max(0, parseValue(ctx.props.capacitance, 100e-9));
  const els: AnalogElement[] = [{ kind: 'C', a: '1', b: '2', farads, id: 'c' }];
  return { elements: () => els };
};

export default create;
