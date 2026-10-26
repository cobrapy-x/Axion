// SPDX-License-Identifier: Apache-2.0
import { bjtModel } from '../../physics/transistor';

/** 2N2907: PNP, hFE ≈ 100 (simplified BJT model: cutoff / active / saturation). */
export default bjtModel('pnp', 100);
