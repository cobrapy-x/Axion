// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

const MIN_US = 544; // Servo.h MIN_PULSE_WIDTH
const MAX_US = 2400; // Servo.h MAX_PULSE_WIDTH
const DEG_PER_NS = 60 / 0.1e9; // SG90: 0.1 s per 60°

/**
 * Measures the width of each pulse on PWM and turns the horn toward the matching
 * angle at a realistic speed. The position is computed lazily from timestamps,
 * so the servo costs nothing while it isn't receiving pulses.
 */
const create: ModelFactory = (ctx) => {
  let angle = 90;
  let target = 90;
  let last = ctx.now();
  let riseAt: number | null = null;

  const powered = () => {
    const vp = ctx.voltage('V+');
    const gnd = ctx.voltage('GND');
    return vp !== null && gnd !== null && vp - gnd >= 4;
  };

  const advance = () => {
    const now = ctx.now();
    const maxMove = Math.max(0, now - last) * DEG_PER_NS;
    last = now;
    if (!powered()) return;
    const d = target - angle;
    angle = Math.abs(d) <= maxMove ? target : angle + Math.sign(d) * maxMove;
  };

  return {
    onPinChange(pin, level) {
      advance();
      if (pin !== 'PWM') return;
      if (level === 1) riseAt = ctx.now();
      else if (level === 0 && riseAt !== null) {
        const us = (ctx.now() - riseAt) / 1000;
        riseAt = null;
        if (us >= 400 && us <= 2700) {
          target = Math.min(180, Math.max(0, ((us - MIN_US) / (MAX_US - MIN_US)) * 180));
        }
      }
    },
    state() {
      advance();
      return { angle: Math.round(angle * 10) / 10 };
    },
  };
};

export default create;
