// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';
import { across } from '../../physics/motor';

/** An ideal voltmeter: reads V(V) − V(COM), or null if either probe floats. Draws no current. */
const create: ModelFactory = (ctx) => ({
  state() {
    const v = across(ctx.voltage('V'), ctx.voltage('COM'));
    return { volts: v === null ? null : Math.round(v * 100) / 100 };
  },
});

export default create;
