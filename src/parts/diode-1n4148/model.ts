// SPDX-License-Identifier: Apache-2.0
import { diodeModel } from '../../physics/semiconductors';

/** 1N4148: VF ≈ 0.65 V (+ 3 Ω: ≈ 1 V at 100 mA), VR 100 V, IF 300 mA. */
export default diodeModel({ name: '1N4148', vf: 0.65, ohms: 3, breakdown: 100, maxAmps: 0.3 });
