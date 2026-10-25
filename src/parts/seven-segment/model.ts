// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';
import { DutyMeter } from '../../physics/duty';
import { ledLit } from '../../physics/lamp';

const SEGMENTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];

/**
 * Every segment is an LED between its pin and the digit's common pin. Lit time is
 * averaged per frame, so multiplexed digits and PWM show up as brightness.
 * State: `values` = brightness of each segment (A..G, DP per digit), `colon`.
 */
const create: ModelFactory = (ctx) => {
  const anode = String(ctx.props.common) === 'anode';
  const digits = Math.min(4, Math.max(1, Math.round(Number(ctx.props.digits)) || 1));
  const common = (d: number) => (digits === 1 ? 'COM.1' : `DIG${d + 1}`);
  const duty = new DutyMeter(digits * 8 + 1, ctx.now());

  return {
    onPinChange() {
      const lit: boolean[] = [];
      for (let d = 0; d < digits; d++) {
        const com = ctx.voltage(common(d));
        for (const seg of SEGMENTS) lit.push(ledLit(ctx.voltage(seg), com, anode));
      }
      lit.push(digits === 4 && ledLit(ctx.voltage('CLN'), ctx.voltage('COM'), anode));
      duty.set(lit, ctx.now());
    },
    state() {
      const values = duty.read(ctx.now());
      const colon = values.pop()!;
      return { values, colon };
    },
  };
};

export default create;
