// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

const create: ModelFactory = (ctx) => {
  let pressed = false;
  return {
    switches: () => (pressed ? [['1.l', '2.l']] : []),
    input(event) {
      const next = event === 'press' ? true : event === 'release' ? false : pressed;
      if (next !== pressed) {
        pressed = next;
        ctx.invalidate(true); // connectivity changed
      }
    },
    state: () => ({ pressed }),
  };
};

export default create;
