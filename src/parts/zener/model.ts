// SPDX-License-Identifier: Apache-2.0
import { diodeModel } from '../../physics/semiconductors';

/**
 * Zener (1N4733-style, 1 W): VF ≈ 0.7 V forward; reverse breakdown at the `voltage` prop
 * (default 5.1 V) with ≈ 5 Ω dynamic resistance. 1 W at 5.1 V is ≈ 200 mA.
 */
export default diodeModel({ name: 'zener', vf: 0.7, ohms: 5, breakdown: 5.1, maxAmps: 0.2 });
