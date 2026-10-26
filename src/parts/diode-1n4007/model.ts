// SPDX-License-Identifier: Apache-2.0
import { diodeModel } from '../../physics/semiconductors';

/** 1N4007: VF ≈ 0.7 V (+ 0.25 Ω: ≈ 0.95 V at 1 A), VR 1000 V, IF 1 A. */
export default diodeModel({ name: '1N4007', vf: 0.7, ohms: 0.25, breakdown: 1000, maxAmps: 1 });
