// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';
import { motorFace, resetMotor, svgRoot, terminal, updateMotor } from '../../physics/motor-view';

const W = 84;
const H = 118;
const CX = 42;
const CY = 40;

const view: PartView = {
  create: () =>
    svgRoot(
      W,
      H,
      `
      <rect x="18" y="70" width="48" height="42" rx="4" fill="#facc15" stroke="#a16207"/>
      ${motorFace(CX, CY, 36, '#f97316')}
      <text class="rpm" x="${CX}" y="86" font-size="9" font-weight="600" fill="#422006" text-anchor="middle"></text>
      ${terminal(30, H, '+', '#c0c0c0', '#422006')}
      ${terminal(54, H, '−', '#c0c0c0', '#422006')}`,
    ),
  update: (el, s) => updateMotor(el, CX, CY, s),
  reset: resetMotor,
  pins: () => [
    { name: '+', x: 30, y: H },
    { name: '-', x: 54, y: H },
  ],
};

export default view;
