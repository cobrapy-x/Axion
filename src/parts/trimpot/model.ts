// SPDX-License-Identifier: Apache-2.0
import { potModel } from '../../physics/variable-resistor';

/** Two resistors VCC–SIG and SIG–GND (total `resistance`), set by the screw (0–1023). */
export default potModel({ vcc: 'VCC', sig: 'SIG', gnd: 'GND', max: 1023 });
