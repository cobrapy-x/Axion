// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';
import { svgRoot } from '../../physics/motor-view';

const W = 40;
const H = 92;
const PLUS = 10.4;
const MINUS = 29.6; // 2 breadboard holes apart

const view: PartView = {
  create(props) {
    const el = svgRoot(
      W,
      H,
      `
      <defs>
        <linearGradient id="axion-ecap-body" x1="0" x2="1">
          <stop offset="0" stop-color="#172554"/>
          <stop offset="0.35" stop-color="#3b6fd8"/>
          <stop offset="1" stop-color="#172554"/>
        </linearGradient>
        <linearGradient id="axion-ecap-stripe" x1="0" x2="1">
          <stop offset="0" stop-color="#cbd5e1"/>
          <stop offset="1" stop-color="#8b97a8"/>
        </linearGradient>
      </defs>
      <line x1="${PLUS}" y1="60" x2="${PLUS}" y2="${H}" stroke="#a3a9b1" stroke-width="2" stroke-linecap="round"/>
      <line x1="${MINUS}" y1="60" x2="${MINUS}" y2="${H}" stroke="#a3a9b1" stroke-width="2" stroke-linecap="round"/>
      <rect x="3" y="3" width="34" height="58" rx="5" fill="url(#axion-ecap-body)" stroke="#0b1430" stroke-width="0.8"/>
      <path d="M27 3.4 H32 a5 5 0 0 1 5 5 V55.6 a5 5 0 0 1 -5 5 H27 Z" fill="url(#axion-ecap-stripe)"/>
      <g fill="#1e293b">
        <rect x="29.5" y="14" width="5" height="1.6"/><rect x="29.5" y="28" width="5" height="1.6"/><rect x="29.5" y="42" width="5" height="1.6"/>
      </g>
      <rect x="3" y="3" width="34" height="5" rx="2.5" fill="#c7ccd3" stroke="#6b7280" stroke-width="0.5"/>
      <path d="M14 5.5 L20 5.5 M20 5.5 L24 4 M20 5.5 L24 7" stroke="#6b7280" stroke-width="0.6" fill="none"/>
      <rect x="3" y="54" width="34" height="2.5" fill="#0b1430" opacity="0.5"/>
      <text class="value" x="0" y="0" font-size="8" font-weight="700" fill="#e0e7ff" text-anchor="middle" transform="translate(16.5 33) rotate(-90)"></text>
      <text x="${PLUS - 4.5}" y="73" font-size="9" font-weight="700" fill="currentColor" text-anchor="end">+</text>
      <text x="${MINUS + 4.5}" y="73" font-size="9" font-weight="700" fill="currentColor">−</text>`,
    );
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    el.querySelector('.value')!.textContent = String(props.capacitance ?? '100µF');
  },
  pins: () => [
    { name: '+', x: PLUS, y: H },
    { name: '-', x: MINUS, y: H },
  ],
};

export default view;
