// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';
import { DutyMeter } from '../../physics/duty';
import { LedGuard, ledElement } from '../../physics/lamp';

/**
 * An LED (D element from A to C) with a forward voltage set by its colour.
 * Brightness follows the current (full at 20 mA), averaged per frame so
 * analogWrite() / PWM dims it smoothly. Warns when there is no current-limiting resistor.
 */
const create: ModelFactory = (ctx) => {
  const els = [ledElement('A', 'C', ctx.props.color, 'd')];
  const duty = new DutyMeter(1, ctx.now());
  const guard = new LedGuard(ctx);
  const level = [0];
  const update = () => {
    level[0] = guard.level('d', `LED ${ctx.id}`);
    duty.set(level, ctx.now());
  };

  return {
    elements: () => els,
    onPinChange: update,
    state() {
      update();
      return { brightness: duty.read(ctx.now())[0] };
    },
  };
};

export default create;
