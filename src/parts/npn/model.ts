// SPDX-License-Identifier: Apache-2.0
import { bjtModel } from '../../physics/transistor';

/** 2N2222: NPN, hFE ≈ 100 (simplified BJT model: cutoff / active / saturation). */
export default bjtModel('npn', 100);
