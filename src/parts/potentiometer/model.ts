// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

const create: ModelFactory = (ctx) => {
  const clamp = (n: number) => Math.min(1, Math.max(0, n / 1023));
  let position = clamp(Number(ctx.props.value) || 0);
  return {
    drive(pin) {
      if (pin !== 'SIG') return 'z';
      const vcc = ctx.voltage('VCC');
      const gnd = ctx.voltage('GND');
      if (vcc === null || gnd === null) return 'z';
      return gnd + position * (vcc - gnd);
    },
    input(event, data) {
      if (event !== 'value') return;
      position = clamp(Number(data));
      ctx.invalidate();
    },
    state: () => ({ value: Math.round(position * 1023) }),
  };
};

export default create;
