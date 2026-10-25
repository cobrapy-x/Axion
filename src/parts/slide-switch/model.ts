// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

/** SPDT switch: the common leg 2 connects to leg 1 (handle left) or leg 3 (handle right). */
const create: ModelFactory = (ctx) => {
  let right = Number(ctx.props.value) === 1;
  return {
    switches: () => [right ? ['2', '3'] : ['1', '2']],
    input(event, data) {
      if (event !== 'value') return;
      const next = Number(data) === 1;
      if (next === right) return;
      right = next;
      ctx.invalidate(true); // connectivity changed
    },
    state: () => ({ value: right ? 1 : 0 }),
  };
};

export default create;
