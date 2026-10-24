// SPDX-License-Identifier: Apache-2.0
import type { Drive, ModelFactory } from '../../core/types';

const DROP = 1.4; // typical L298 saturation loss on the high side

/**
 * Behavioural L298N: every output is recomputed from the inputs whenever the
 * engine re-solves the circuit, so no events need to be handled here.
 */
const create: ModelFactory = (ctx) => {
  const supply = () => {
    const vs = ctx.voltage('12V');
    const gnd = ctx.voltage('GND') ?? 0;
    return vs === null ? 0 : vs - gnd;
  };
  // ENA/ENB left floating = the on-board jumper is fitted = always enabled.
  const enabled = (pin: string) => ctx.voltage(pin) === null || ctx.level(pin) === 1;

  const bridge = (enable: string, input: string): Drive => {
    const vs = supply();
    if (vs < 4 || !enabled(enable)) return 'z';
    return ctx.level(input) === 1 ? Math.max(0, vs - DROP) : 0;
  };

  return {
    drive(pin) {
      switch (pin) {
        case 'OUT1':
          return bridge('ENA', 'IN1');
        case 'OUT2':
          return bridge('ENA', 'IN2');
        case 'OUT3':
          return bridge('ENB', 'IN3');
        case 'OUT4':
          return bridge('ENB', 'IN4');
        case '5V':
          return supply() >= 7 ? 5 : 'z';
        default:
          return 'z';
      }
    },
    state: () => ({ powered: supply() >= 4 }),
  };
};

export default create;
