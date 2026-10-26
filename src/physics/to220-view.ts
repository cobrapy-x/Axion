// SPDX-License-Identifier: Apache-2.0
import type { PartView, Props } from '../core/types';
import { svgRoot } from './motor-view';

/** Width / height of a TO-220 part; its three legs are one breadboard hole (9.6 px) apart. */
const W = 40;
const H = 104;
const LEGS = [10.4, 20, 29.6];
const BODY_TOP = 26;
const BODY_BOTTOM = 64;

/**
 * Front view of a TO-220 package: metal tab with its mounting hole, black epoxy body
 * with the part number, and three legs with their names. `part` may depend on the props
 * (e.g. a MOSFET model select).
 */
export function to220View(part: string | ((props: Props) => string), kind: string, pins: [string, string, string]): PartView {
  const name = (props: Props) => (typeof part === 'function' ? part(props) : part);
  return {
    create(props) {
      const el = svgRoot(
        W,
        H,
        `
        <defs>
          <linearGradient id="axion-to220-tab" x1="0" x2="1">
            <stop offset="0" stop-color="#8b929c"/><stop offset="0.45" stop-color="#e5e7eb"/><stop offset="1" stop-color="#7b828c"/>
          </linearGradient>
          <linearGradient id="axion-to220-body" x1="0" x2="1">
            <stop offset="0" stop-color="#0b0d10"/><stop offset="0.5" stop-color="#2a2f37"/><stop offset="1" stop-color="#0b0d10"/>
          </linearGradient>
        </defs>
        ${LEGS.map(
          (x) => `
          <rect x="${x - 2.2}" y="${BODY_BOTTOM}" width="4.4" height="9" fill="#b8bec6" stroke="#6b7280" stroke-width="0.5"/>
          <line x1="${x}" y1="${BODY_BOTTOM + 8}" x2="${x}" y2="${H}" stroke="#a3a9b1" stroke-width="2" stroke-linecap="round"/>`,
        ).join('')}
        <path d="M3 ${BODY_TOP + 2} V6 Q3 2 7 2 H33 Q37 2 37 6 V${BODY_TOP + 2} Z" fill="url(#axion-to220-tab)" stroke="#6b7280" stroke-width="0.7"/>
        <circle cx="20" cy="13" r="5" fill="#1f2937" stroke="#6b7280" stroke-width="0.8"/>
        <circle cx="20" cy="13" r="5" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="0.6" stroke-dasharray="6 26"/>
        <rect x="2" y="${BODY_TOP}" width="36" height="${BODY_BOTTOM - BODY_TOP}" rx="1.5" fill="url(#axion-to220-body)" stroke="#4b5563" stroke-width="0.7"/>
        <text class="part-no" x="20" y="${BODY_TOP + 11}" font-size="6.6" font-weight="700" fill="#e5e7eb" text-anchor="middle"></text>
        <text x="20" y="${BODY_TOP + 19.5}" font-size="5.4" fill="#9ca3af" text-anchor="middle" letter-spacing="0.4">${kind}</text>
        <rect class="glow" x="6" y="${BODY_TOP + 23}" width="28" height="1.2" rx="0.6" fill="#22c55e" opacity="0"/>
        ${pins.map((p, i) => `<text x="${LEGS[i]}" y="${BODY_BOTTOM - 3.5}" font-size="6.6" font-weight="700" fill="#f3f4f6" text-anchor="middle">${p}</text>`).join('')}`,
      );
      this.setProps!(el, props);
      return el;
    },
    setProps(el, props) {
      const text = name(props);
      const label = el.querySelector('.part-no')!;
      label.textContent = text;
      label.setAttribute('font-size', text.length > 7 ? '5.6' : '6.6');
    },
    update(el, s) {
      el.querySelector('.glow')?.setAttribute('opacity', s.on ? '0.9' : '0');
    },
    reset(el) {
      el.querySelector('.glow')?.setAttribute('opacity', '0');
    },
    pins: () => pins.map((n, i) => ({ name: n, x: LEGS[i], y: H })),
  };
}
