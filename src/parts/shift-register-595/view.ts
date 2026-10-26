// SPDX-License-Identifier: Apache-2.0
/**
 * DIP-16 package seen from above, notch on the left. Legs sit on the 0.1" (9.6 px)
 * grid and the two rows are 0.3" apart, so the chip straddles a breadboard's centre
 * channel (rows e and f). Pin 1 is bottom left, as on the real package:
 *   top    (16 → 9): VCC Q0 DS OE STCP SHCP MR Q7S
 *   bottom (1 → 8):  Q1 Q2 Q3 Q4 Q5 Q6 Q7 GND
 * While running, the output legs light up red when HIGH.
 */
import type { PartView, PinPosition } from '../../core/types';

const P = 9.6;
const W = 8 * P;
const H = 3 * P;
const TOP = ['VCC', 'Q0', 'DS', 'OE', 'STCP', 'SHCP', 'MR', 'Q7S'];
const BOTTOM = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'GND'];
const x = (i: number) => P / 2 + i * P;
const OUT_LEGS: Record<string, number> = { Q0: 0, Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 5, Q6: 6, Q7: 7 };

const leg = (name: string, i: number, top: boolean) => {
  const y = top ? 0 : H - 5;
  const cls = name in OUT_LEGS ? ` class="q${OUT_LEGS[name]}"` : '';
  return `<rect${cls} x="${x(i) - 1.8}" y="${y}" width="3.6" height="5" rx="0.6" fill="#c0c4ca" stroke="#7b8088" stroke-width="0.4"/>`;
};
const label = (name: string, i: number, top: boolean) =>
  `<text x="${x(i)}" y="${top ? 9.6 : H - 6.2}" font-size="${name.length > 3 ? 2.9 : 3.3}" text-anchor="middle" fill="#e5e7eb">${name}</text>`;

const pins: PinPosition[] = [
  ...TOP.map((name, i) => ({ name, x: x(i), y: 0 })),
  ...BOTTOM.map((name, i) => ({ name, x: x(i), y: H })),
];

const view: PartView = {
  create() {
    const el = document.createElement('div');
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,monospace">
      ${TOP.map((n, i) => leg(n, i, true)).join('')}
      ${BOTTOM.map((n, i) => leg(n, i, false)).join('')}
      <rect x="0.5" y="4" width="${W - 1}" height="${H - 8}" rx="1.5" fill="#22252b" stroke="#0d0f12" stroke-width="0.8"/>
      <path d="M0.5 ${H / 2 - 3.2} a3.2 3.2 0 0 1 0 6.4" fill="#0d0f12"/>
      <circle cx="5" cy="${H - 12}" r="1" fill="#4b5563"/>
      ${TOP.map((n, i) => label(n, i, true)).join('')}
      ${BOTTOM.map((n, i) => label(n, i, false)).join('')}
      <text x="${W / 2}" y="${H / 2 + 1.9}" font-size="5.2" font-weight="700" text-anchor="middle" fill="#f3f4f6" letter-spacing="0.3">74HC595</text>
    </svg>`;
    return el;
  },
  update(el, s) {
    const q = Number(s.q) || 0;
    for (let i = 0; i < 8; i++) el.querySelector(`.q${i}`)?.setAttribute('fill', (q >> i) & 1 ? '#ef4444' : '#c0c4ca');
  },
  reset(el) {
    for (let i = 0; i < 8; i++) el.querySelector(`.q${i}`)?.setAttribute('fill', '#c0c4ca');
  },
  pins: () => pins,
};

export default view;
