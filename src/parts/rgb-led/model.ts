// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';
import { DutyMeter } from '../../physics/duty';
import { ledLit } from '../../physics/lamp';

const CHANNELS = ['R', 'G', 'B'];

/**
 * Each colour is an LED between its pin and COM. Brightness is the fraction of
 * time it was lit since the last frame, so PWM mixes colours smoothly.
 */
const create: ModelFactory = (ctx) => {
  const anode = String(ctx.props.common) === 'anode';
  const duty = new DutyMeter(3, ctx.now());
  return {
    onPinChange() {
      const com = ctx.voltage('COM');
      duty.set(
        CHANNELS.map((ch) => ledLit(ctx.voltage(ch), com, anode)),
        ctx.now(),
      );
    },
    state() {
      const [r, g, b] = duty.read(ctx.now());
      return { r, g, b };
    },
  };
};

export default create;
