// SPDX-License-Identifier: Apache-2.0
import { potModel } from '../../physics/variable-resistor';

/** Two resistors VCC–SIG and SIG–GND; the slider (0–100, as in Wokwi) sets SIG from 0 V to VCC. */
export default potModel({ vcc: 'VCC', sig: 'SIG', gnd: 'GND', max: 100 });
