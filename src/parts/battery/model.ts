// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

/** An ideal voltage source. All grounds in Axion share 0 V, so '-' drives 0 V. */
const create: ModelFactory = (ctx) => {
  const volts = Math.max(0, Number(ctx.props.voltage) || 0);
  return {
    drive: (pin) => (pin === '+' ? volts : pin === '-' ? 0 : 'z'),
  };
};

export default create;
