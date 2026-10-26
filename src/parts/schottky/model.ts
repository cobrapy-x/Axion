// SPDX-License-Identifier: Apache-2.0
import { diodeModel } from '../../physics/semiconductors';

/** 1N5819: VF ≈ 0.3 V (+ 0.3 Ω: ≈ 0.6 V at 1 A), VR 40 V, IF 1 A. */
export default diodeModel({ name: '1N5819', vf: 0.3, ohms: 0.3, breakdown: 40, maxAmps: 1 });
