// SPDX-License-Identifier: Apache-2.0
import { diodeView } from '../../physics/axial-view';

/** "5V1", "12V": zener voltages as printed on the parts. */
function zenerCode(v: unknown): string {
  const n = Number(v);
  if (!(n > 0)) return '';
  const [i, f] = String(Number(n.toFixed(1))).split('.');
  return f && f !== '0' ? `${i}V${f}` : `${i}V`;
}

export default diodeView({ body: 'glass', length: 24, diameter: 9, print: (props) => zenerCode(props.voltage ?? 5.1) });
