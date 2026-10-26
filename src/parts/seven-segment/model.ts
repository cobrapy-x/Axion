// SPDX-License-Identifier: Apache-2.0
import type { AnalogElement, ModelFactory } from '../../core/types';
import { DutyMeter } from '../../physics/duty';
import { LedGuard, ledElement } from '../../physics/lamp';

const SEGMENTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];

/**
 * Every segment is an LED (D element) between its pin and the digit's common pin.
 * Brightness follows the segment current (full at 20 mA) and is averaged per frame,
 * so multiplexed digits and PWM show up as brightness. A single resistor on the common
 * pin shares its current between the lit segments, just like on a real display.
 * State: `values` = brightness of each segment (A..G, DP per digit), `colon`.
 */
const create: ModelFactory = (ctx) => {
  const anode = String(ctx.props.common) === 'anode';
  const color = ctx.props.color;
  const digits = Math.min(4, Math.max(1, Math.round(Number(ctx.props.digits)) || 1));
  const common = (d: number) => (digits === 1 ? 'COM.1' : `DIG${d + 1}`);
  const led = (pin: string, com: string, id: string) => (anode ? ledElement(com, pin, color, id) : ledElement(pin, com, color, id));

  const ids: string[] = [];
  const labels: string[] = [];
  const els: AnalogElement[] = [];
  for (let d = 0; d < digits; d++) {
    for (const seg of SEGMENTS) {
      const id = `${seg}${d + 1}`;
      ids.push(id);
      labels.push(`7-segment display ${ctx.id} (segment ${digits > 1 ? id : seg})`);
      els.push(led(seg, common(d), id));
    }
  }
  if (digits === 4) {
    ids.push('CLN');
    labels.push(`7-segment display ${ctx.id} (colon)`);
    els.push(led('CLN', 'COM', 'CLN'));
  }

  const duty = new DutyMeter(digits * 8 + 1, ctx.now());
  const guard = new LedGuard(ctx);
  const levels = new Array<number>(digits * 8 + 1).fill(0);
  const update = () => {
    for (let i = 0; i < ids.length; i++) levels[i] = guard.level(ids[i], labels[i]);
    duty.set(levels, ctx.now());
  };

  return {
    elements: () => els,
    onPinChange: update,
    state() {
      update();
      const values = duty.read(ctx.now());
      const colon = values.pop()!;
      return { values, colon };
    },
  };
};

export default create;
