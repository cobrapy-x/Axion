// SPDX-License-Identifier: Apache-2.0
import { fetModel } from '../../physics/semiconductors';

/** 2N7000: VGS(th) ≈ 2.1 V, RDS(on) ≈ 2.5 Ω at VGS = 4.5–5 V, ID 200 mA, VDSS 60 V. */
export default fetModel({ name: '2N7000', type: 'n', vth: 2.1, rdsOn: 2.5, maxAmps: 0.2, vdss: 60 });
