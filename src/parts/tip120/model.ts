// SPDX-License-Identifier: Apache-2.0
import { darlingtonModel } from '../../physics/semiconductors';

/**
 * TIP120: two NPN BJTs (β 50 and 40) with the internal 8 kΩ / 120 Ω base resistors and the
 * C–E diode. hFE ≈ 1000–1500 at 0.2–1 A, VBE(on) ≈ 1.3–1.4 V, VCE(sat) ≈ 0.9 V.
 */
export default darlingtonModel(50, 40, 5, 'TIP120');
