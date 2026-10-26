// SPDX-License-Identifier: Apache-2.0
import { parseValue } from '../../core/analog/units';
import type { AnalogElement, ModelFactory } from '../../core/types';

/** Resistance left between the wiper and an end at the end stop. */
const END_OHMS = 1;

/**
 * A potentiometer is two resistors, VCC–SIG and SIG–GND, that add up to its
 * `resistance` (default 10 kΩ). Turning the knob moves resistance from one to the other,
 * so SIG gives a fraction of the voltage across it, and a load on SIG pulls it like a real pot.
 */
const create: ModelFactory = (ctx) => {
  const total = Math.max(2 * END_OHMS, parseValue(ctx.props.resistance, 10_000));
  const clamp = (n: number) => Math.min(1, Math.max(0, n / 1023));
  let position = clamp(Number(ctx.props.value) || 0);
  const top = { kind: 'R', a: 'VCC', b: 'SIG', ohms: total, id: 'top' } satisfies AnalogElement;
  const bottom = { kind: 'R', a: 'SIG', b: 'GND', ohms: total, id: 'bottom' } satisfies AnalogElement;
  const els: AnalogElement[] = [top, bottom];
  const update = () => {
    top.ohms = Math.max(END_OHMS, total * (1 - position));
    bottom.ohms = Math.max(END_OHMS, total * position);
  };
  update();
  return {
    elements: () => els,
    input(event, data) {
      if (event !== 'value') return;
      position = clamp(Number(data));
      update();
      ctx.invalidate();
    },
    state: () => ({ value: Math.round(position * 1023) }),
  };
};

export default create;
