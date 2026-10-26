// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

const COUNT = 8;

/** Parse "01001000" (switch 1 first) into on/off flags. Anything but '1' is OFF. */
export function parseSwitches(value: unknown): boolean[] {
  const s = String(value ?? '');
  return Array.from({ length: COUNT }, (_, i) => s[i] === '1');
}

/** Eight independent switches: switch n joins pins `na` and `nb` while it is ON. */
const create: ModelFactory = (ctx) => {
  let on = parseSwitches(ctx.props.value);
  const text = () => on.map((v) => (v ? '1' : '0')).join('');
  return {
    switches: () => on.flatMap((v, i) => (v ? [[`${i + 1}a`, `${i + 1}b`] as [string, string]] : [])),
    input(event, data) {
      if (event !== 'value') return;
      const next = parseSwitches(data);
      if (next.join() === on.join()) return;
      on = next;
      ctx.invalidate(true); // connectivity changed
    },
    state: () => ({ value: text() }),
  };
};

export default create;
