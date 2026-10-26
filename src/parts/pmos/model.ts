// SPDX-License-Identifier: Apache-2.0
import { fetModel } from '../../physics/semiconductors';

/** Small-signal P-MOSFET: VSG(th) ≈ 2 V, RDS(on) ≈ 5 Ω, ID 200 mA. */
export default fetModel({ name: 'P-MOSFET', type: 'p', vth: 2, rdsOn: 5, maxAmps: 0.2, vdss: 60 });
