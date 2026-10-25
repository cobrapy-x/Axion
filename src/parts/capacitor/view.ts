// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';
import { svgRoot } from '../../physics/motor-view';

const W = 40;
const H = 66;
const P1 = 10.4;
const P2 = 29.6; // 2 breadboard holes apart

const view: PartView = {
  create(props) {
    const el = svgRoot(
      W,
      H,
      `
      <defs>
        <radialGradient id="axion-cap-disc" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stop-color="#f6b44a"/>
          <stop offset="0.6" stop-color="#d97706"/>
          <stop offset="1" stop-color="#9a4a07"/>
        </radialGradient>
      </defs>
      <path d="M${P1} ${H} V46 L14 34" fill="none" stroke="#a3a9b1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M${P2} ${H} V46 L26 34" fill="none" stroke="#a3a9b1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <ellipse cx="20" cy="19" rx="18.5" ry="17" fill="url(#axion-cap-disc)" stroke="#7c3a06" stroke-width="0.8"/>
      <ellipse cx="14" cy="11" rx="6" ry="3" fill="#fff" opacity="0.18"/>
      <text class="value" x="20" y="22" font-size="8" font-weight="700" fill="#3b1d04" text-anchor="middle"></text>`,
    );
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    const text = String(props.capacitance ?? '100nF');
    const label = el.querySelector('.value')!;
    label.textContent = text;
    label.setAttribute('font-size', text.length > 6 ? '6.5' : '8');
  },
  pins: () => [
    { name: '1', x: P1, y: H },
    { name: '2', x: P2, y: H },
  ],
};

export default view;
