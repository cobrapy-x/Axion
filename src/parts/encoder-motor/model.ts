// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';
import { ElectricMotor, across, motorDriver } from '../../physics/motor';

/**
 * DC motor + quadrature encoder. The encoder position is checked every simulation
 * quantum (50 µs) and A/B are updated when it crosses an edge, so edge timing is
 * accurate to 50 µs (fine up to ~5000 edges per second per channel).
 *
 * Quadrature sequence (forward): AB = 00 → 10 → 11 → 01 → 00 …
 */
const create: ModelFactory = (ctx) => {
  const motor = new ElectricMotor(
    {
      rpm: Number(ctx.props.rpm),
      ratedVoltage: Number(ctx.props.ratedVoltage),
      stallCurrent: Number(ctx.props.stallCurrent),
      noLoadCurrent: Number(ctx.props.noLoadCurrent),
    },
    ctx.now(),
  );
  const drv = motorDriver(motor, ctx);
  const countsPerDeg = (Math.max(1, Number(ctx.props.ppr) || 1) * 4) / 360;
  let count = 0;
  let a = false;
  let b = false;

  const powered = () => {
    const v = across(ctx.voltage('VCC'), ctx.voltage('GND'));
    return v !== null && v >= 3;
  };

  return {
    drive(pin) {
      if (pin !== 'A' && pin !== 'B') return 'z';
      if (!powered()) return 'z';
      return (pin === 'A' ? a : b) ? 'high' : 'low';
    },
    elements: drv.elements,
    onPinChange() {
      drv.solved();
    },
    step(timeNs) {
      motor.advance(timeNs);
      const c = Math.floor(motor.angle * countsPerDeg);
      if (c === count) return;
      count = c;
      const q = ((c % 4) + 4) % 4;
      const na = q === 1 || q === 2;
      const nb = q === 2 || q === 3;
      if (na !== a || nb !== b) {
        a = na;
        b = nb;
        ctx.advanceTime(timeNs);
        ctx.invalidate();
      }
    },
    state() {
      motor.advance(ctx.now());
      return { angle: motor.angle % 360, rpm: Math.round(motor.rpm), amps: Math.round(motor.amps * 1000) / 1000, a, b };
    },
  };
};

export default create;
