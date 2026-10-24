// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';
import { motorFace, resetMotor, svgRoot, terminal, updateMotor } from '../../physics/motor-view';

const W = 112;
const H = 140;
const CX = 56;
const CY = 44;
const PINS = ['+', '-', 'A', 'B', 'GND', 'VCC'];
const LABELS = ['M+', 'M−', 'A', 'B', 'GND', 'VCC'];
const pinX = (i: number) => 16 + i * 16;

const view: PartView = {
  create: () =>
    svgRoot(
      W,
      H,
      `
      <rect x="6" y="76" width="100" height="58" rx="5" fill="#1e3a8a" stroke="#1e40af"/>
      ${motorFace(CX, CY, 40, '#22d3ee')}
      <text class="rpm" x="${CX}" y="94" font-size="9" font-weight="600" fill="#e0f2fe" text-anchor="middle"></text>
      <circle class="led-a" cx="86" cy="88" r="3" fill="#1f2937"/>
      <circle class="led-b" cx="96" cy="88" r="3" fill="#1f2937"/>
      ${PINS.map((_, i) => terminal(pinX(i), H, LABELS[i])).join('')}`,
    ),
  update(el, s) {
    updateMotor(el, CX, CY, s);
    el.querySelector('.led-a')!.setAttribute('fill', s.a ? '#22c55e' : '#1f2937');
    el.querySelector('.led-b')!.setAttribute('fill', s.b ? '#22c55e' : '#1f2937');
  },
  reset(el) {
    resetMotor(el);
    el.querySelector('.led-a')!.setAttribute('fill', '#1f2937');
    el.querySelector('.led-b')!.setAttribute('fill', '#1f2937');
  },
  pins: () => PINS.map((name, i) => ({ name, x: pinX(i), y: H })),
};

export default view;
