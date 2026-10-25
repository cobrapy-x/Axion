// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../core/types';
import { svgRoot } from './motor-view';

/** Width / height of a TO-92 part and its three legs, one breadboard hole (9.6 px) apart. */
const W = 38.4;
const H = 76;
const LEGS = [9.6, 19.2, 28.8];

/**
 * Front view of a TO-92 package (flat face towards you) with the part number,
 * polarity and the name of each leg printed on the body.
 */
export function to92View(part: string, kind: string, pins: [string, string, string]): PartView {
  return {
    create: () =>
      svgRoot(
        W,
        H,
        `
        <defs>
          <linearGradient id="axion-to92" x1="0" x2="1">
            <stop offset="0" stop-color="#0b0d10"/><stop offset="0.5" stop-color="#2a2f37"/><stop offset="1" stop-color="#0b0d10"/>
          </linearGradient>
        </defs>
        ${LEGS.map((x) => `<line x1="${x}" y1="40" x2="${x}" y2="${H}" stroke="#a3a9b1" stroke-width="1.8" stroke-linecap="round"/>`).join('')}
        <path d="M2 40 V10 Q2 2 10 2 H28.4 Q36.4 2 36.4 10 V40 Z" fill="url(#axion-to92)" stroke="#4b5563" stroke-width="0.7"/>
        <path d="M5 6 Q6 4.5 9 4.5 H29.4 Q32.4 4.5 33.4 6" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="1"/>
        <text x="${W / 2}" y="15" font-size="6.6" font-weight="700" fill="#e5e7eb" text-anchor="middle">${part}</text>
        <text x="${W / 2}" y="24" font-size="5.6" fill="#9ca3af" text-anchor="middle" letter-spacing="0.5">${kind}</text>
        <rect class="glow" x="4" y="27" width="30.4" height="1.2" rx="0.6" fill="#22c55e" opacity="0"/>
        ${pins.map((p, i) => `<text x="${LEGS[i]}" y="37" font-size="6.6" font-weight="700" fill="#f3f4f6" text-anchor="middle">${p}</text>`).join('')}`,
      ),
    update(el, s) {
      el.querySelector('.glow')?.setAttribute('opacity', s.on ? '0.9' : '0');
    },
    reset(el) {
      el.querySelector('.glow')?.setAttribute('opacity', '0');
    },
    pins: () => pins.map((name, i) => ({ name, x: LEGS[i], y: H })),
  };
}
