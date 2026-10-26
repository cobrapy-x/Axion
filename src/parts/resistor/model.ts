// SPDX-License-Identifier: Apache-2.0
import { parseValue } from '../../core/analog/units';
import type { AnalogElement, ModelFactory } from '../../core/types';

/** A resistor between pins 1 and 2. `value` in ohms: "220", "4.7k", "1M". */
const create: ModelFactory = (ctx) => {
  const ohms = Math.max(1e-3, parseValue(ctx.props.value, 220));
  const els: AnalogElement[] = [{ kind: 'R', a: '1', b: '2', ohms, id: 'r' }];
  return { elements: () => els };
};

export default create;
