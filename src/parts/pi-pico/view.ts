// SPDX-License-Identifier: Apache-2.0
/**
 * Raspberry Pi Pico, drawn from scratch (no third-party artwork): 51 × 21 mm board, two rows
 * of 20 castellated pins on the 0.1" grid, 0.7" apart, so it straddles a breadboard's centre
 * gap in rows c and h. Lying down with the USB connector on the left; R rotates it.
 */
import type { PartView } from '../../core/types';
import { svgRoot } from '../../physics/motor-view';

const P = 9.6; // 0.1" in px
const W = 202;
const H = 80;
const X0 = 9.8; // first pin
const TOP = 6.4;
const BOTTOM = TOP + 7 * P; // 0.7" between the rows

/** Physical pins 1–20 (bottom row, left → right). */
const BOTTOM_PINS = ['GP0', 'GP1', 'GND.1', 'GP2', 'GP3', 'GP4', 'GP5', 'GND.2', 'GP6', 'GP7', 'GP8', 'GP9', 'GND.3', 'GP10', 'GP11', 'GP12', 'GP13', 'GND.4', 'GP14', 'GP15'];
/** Physical pins 40–21 (top row, left → right). */
const TOP_PINS = ['VBUS', 'VSYS', 'GND.7', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND.6', 'GP21', 'GP20', 'GP19', 'GP18', 'GND.5', 'GP17', 'GP16'];

const label = (name: string) => (name.startsWith('GND') || name === 'AGND' ? (name === 'AGND' ? 'AGND' : 'GND') : name.replace('ADC_VREF', 'VREF').replace('3V3_EN', 'EN'));

function pad(x: number, y: number, name: string): string {
  const gnd = name.startsWith('GND') || name === 'AGND';
  return `<rect x="${x - 3.4}" y="${y - 4.6}" width="6.8" height="9.2" rx="1.2" fill="#d6b45a" stroke="#8a6d1f" stroke-width="0.5"/>
    <circle cx="${x}" cy="${y}" r="1.9" fill="${gnd ? '#3b2f12' : '#1b1407'}"/>`;
}

function pinLabel(x: number, y: number, name: string, up: boolean): string {
  const ty = up ? y + 8 : y - 8;
  const anchor = 'end';
  const rot = up ? 90 : -90;
  return `<text x="${x + 1.6}" y="${ty}" font-size="5.2" font-weight="600" fill="#f0fdf4" text-anchor="${anchor}" transform="rotate(${rot} ${x + 1.6} ${ty})">${label(name)}</text>`;
}

const body = () => `
  <defs>
    <linearGradient id="axion-pico-pcb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c8a4d"/><stop offset="1" stop-color="#127040"/>
    </linearGradient>
  </defs>
  <rect x="2" y="0.5" width="${W - 2.5}" height="${H - 1}" rx="3" fill="url(#axion-pico-pcb)" stroke="#0b4a29"/>
  <!-- USB micro-B -->
  <rect x="0" y="${H / 2 - 9}" width="17" height="18" rx="1.5" fill="#c7cdd4" stroke="#7b8590"/>
  <rect x="2.5" y="${H / 2 - 5}" width="10" height="10" rx="1" fill="#9aa3ad"/>
  <!-- BOOTSEL button -->
  <rect x="34" y="${H / 2 + 6}" width="13" height="10" rx="1.5" fill="#e5e7eb" stroke="#9ca3af"/>
  <circle cx="40.5" cy="${H / 2 + 11}" r="3" fill="#f9fafb" stroke="#d1d5db"/>
  <text x="40.5" y="${H / 2 + 21}" font-size="4" fill="#e8f5e9" text-anchor="middle">BOOTSEL</text>
  <!-- LED (GP25) -->
  <rect class="led" x="26" y="${H / 2 - 12}" width="6" height="4" rx="0.8" fill="#d1fae5" stroke="#6b7280" stroke-width="0.4"/>
  <text x="29" y="${H / 2 - 14}" font-size="4" fill="#e8f5e9" text-anchor="middle">LED</text>
  <!-- RP2040 -->
  <rect x="${W / 2 - 14}" y="${H / 2 - 14}" width="28" height="28" rx="1.5" fill="#1f2328" stroke="#0b0d10"/>
  <text x="${W / 2}" y="${H / 2 + 1.5}" font-size="5.5" fill="#cbd5e1" text-anchor="middle" font-weight="600">RP2040</text>
  <!-- flash + crystal -->
  <rect x="${W / 2 + 22}" y="${H / 2 - 8}" width="16" height="12" rx="1" fill="#2a2f36"/>
  <rect x="${W / 2 + 44}" y="${H / 2 - 5}" width="11" height="7" rx="2" fill="#cbd5e1" stroke="#94a3b8"/>
  <!-- debug pads -->
  ${[0, 1, 2].map((i) => `<circle cx="${W - 6}" cy="${H / 2 - 8 + i * 8}" r="2" fill="#d6b45a"/>`).join('')}
  ${BOTTOM_PINS.map((n, i) => pad(X0 + i * P, BOTTOM, n) + pinLabel(X0 + i * P, BOTTOM, n, false)).join('')}
  ${TOP_PINS.map((n, i) => pad(X0 + i * P, TOP, n) + pinLabel(X0 + i * P, TOP, n, true)).join('')}`;

const view: PartView = {
  create: () => svgRoot(W, H, body()),
  update(el, s) {
    el.querySelector('.led')!.setAttribute('fill', s.led13 ? '#22c55e' : '#d1fae5');
  },
  reset(el) {
    el.querySelector('.led')!.setAttribute('fill', '#d1fae5');
  },
  pins: () => [
    ...BOTTOM_PINS.map((name, i) => ({ name, x: X0 + i * P, y: BOTTOM })),
    ...TOP_PINS.map((name, i) => ({ name, x: X0 + i * P, y: TOP })),
  ],
};

export default view;
