// SPDX-License-Identifier: Apache-2.0
import type { AnalogElement, ModelFactory } from '../../core/types';
import { DutyMeter } from '../../physics/duty';
import { LedGuard, ledElement } from '../../physics/lamp';

const CHANNELS = ['R', 'G', 'B'];
const COLORS = ['red', 'green', 'blue'];

/**
 * Three LEDs (D elements) between each colour pin and COM, pointing away from COM
 * (common anode) or towards it (common cathode). Brightness follows each LED's
 * current and is averaged per frame, so PWM mixes colours smoothly.
 */
const create: ModelFactory = (ctx) => {
  const anode = String(ctx.props.common) === 'anode';
  const els: AnalogElement[] = CHANNELS.map((ch, i) => (anode ? ledElement('COM', ch, COLORS[i], ch) : ledElement(ch, 'COM', COLORS[i], ch)));
  const duty = new DutyMeter(3, ctx.now());
  const guard = new LedGuard(ctx);
  const levels = [0, 0, 0];
  const update = () => {
    for (let i = 0; i < 3; i++) levels[i] = guard.level(CHANNELS[i], `RGB LED ${ctx.id} (${COLORS[i]})`);
    duty.set(levels, ctx.now());
  };
  return {
    elements: () => els,
    onPinChange: update,
    state() {
      update();
      const [r, g, b] = duty.read(ctx.now());
      return { r, g, b };
    },
  };
};

export default create;
