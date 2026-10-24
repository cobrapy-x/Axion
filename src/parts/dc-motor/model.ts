// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';
import { MotorPhysics, across } from '../../physics/motor';

const create: ModelFactory = (ctx) => {
  const motor = new MotorPhysics({ rpm: Number(ctx.props.rpm), ratedVoltage: Number(ctx.props.ratedVoltage) }, ctx.now());
  return {
    onPinChange() {
      motor.setVoltage(across(ctx.voltage('+'), ctx.voltage('-')), ctx.now());
    },
    state() {
      motor.advance(ctx.now());
      return { angle: motor.angle % 360, rpm: Math.round(motor.rpm) };
    },
  };
};

export default create;
