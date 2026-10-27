// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';
import { ElectricMotor, motorDriver } from '../../physics/motor';

/** Brushed DC motor: an electrical load (R + L + back-EMF) with a spinning shaft. See physics/motor.ts. */
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
  return {
    elements: drv.elements,
    onPinChange() {
      drv.solved();
    },
    state() {
      motor.advance(ctx.now());
      return { angle: motor.angle % 360, rpm: Math.round(motor.rpm), amps: Math.round(motor.amps * 1000) / 1000 };
    },
  };
};

export default create;
