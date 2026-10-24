// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

/**
 * An LED is lit when its anode (A) is HIGH and its cathode (C) is LOW.
 * Brightness = fraction of time it was lit since the last frame, so
 * analogWrite() / PWM dims it smoothly.
 */
const create: ModelFactory = (ctx) => {
  let lit = false;
  let since = ctx.now();
  let windowStart = since;
  let onTime = 0;

  const isLit = () => ctx.level('A') === 1 && ctx.level('C') === 0;

  return {
    onPinChange() {
      const now = ctx.now();
      if (lit) onTime += Math.max(0, now - since);
      since = now;
      lit = isLit();
    },
    state() {
      const now = ctx.now();
      if (lit) onTime += Math.max(0, now - since);
      since = now;
      const span = now - windowStart;
      const brightness = span > 0 ? Math.min(1, onTime / span) : lit ? 1 : 0;
      windowStart = now;
      onTime = 0;
      return { brightness: Math.round(brightness * 100) / 100 };
    },
  };
};

export default create;
