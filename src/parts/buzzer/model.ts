// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';
import { FrequencyMeter } from '../../physics/frequency';

/**
 * A passive piezo buzzer sounds while the voltage across it toggles. The
 * frequency is measured from the edges (tone() produces a square wave).
 */
const create: ModelFactory = (ctx) => {
  const meter = new FrequencyMeter();
  return {
    onPinChange() {
      const a = ctx.voltage('2');
      const b = ctx.voltage('1');
      meter.update(a !== null && b !== null && Math.abs(a - b) >= 1.5, ctx.now());
    },
    state: () => meter.read(ctx.now()),
  };
};

export default create;
