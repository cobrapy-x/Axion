// SPDX-License-Identifier: Apache-2.0
import { bankSource } from '../../physics/battery-bank';

/** '+' is count × 9 V above '−' (ideal cells: they never run flat). */
export default bankSource(9, 4);
