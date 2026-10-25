// SPDX-License-Identifier: Apache-2.0
import { bankSource } from '../../physics/battery-bank';

/** '+' is count × 1.5 V above '−' (ideal cells: they never run flat). */
export default bankSource(1.5, 8);
