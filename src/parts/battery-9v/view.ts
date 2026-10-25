// SPDX-License-Identifier: Apache-2.0
import { batteryBankView } from '../../physics/battery-bank';

const W = 64;
const H = 116;
const PLUS = 22.4;
const MINUS = 41.6; // 2 breadboard holes apart

/** Small round '+' stud. */
const stud = `
  <rect x="${PLUS - 5}" y="4" width="10" height="9" fill="url(#axion-9v-metal)" stroke="#6b7280" stroke-width="0.6"/>
  <rect x="${PLUS - 3}" y="0" width="6" height="5" rx="1" fill="url(#axion-9v-metal)" stroke="#6b7280" stroke-width="0.6"/>`;
/** Larger hexagonal '−' snap. */
const hexSnap = `
  <path d="M${MINUS - 7} 13 V5 L${MINUS - 4} 0 H${MINUS + 4} L${MINUS + 7} 5 V13 Z" fill="url(#axion-9v-metal)" stroke="#6b7280" stroke-width="0.6"/>
  <path d="M${MINUS - 3.5} 13 V6 H${MINUS + 3.5} V13" fill="none" stroke="#6b7280" stroke-width="0.6"/>`;

/** One 9 V battery; the bank helper repeats it for 2–4 batteries in series. */
export default batteryBankView({
  w: W,
  h: H,
  plusX: PLUS,
  minusX: MINUS,
  side: 'top',
  volts: 9,
  maxCount: 4,
  defs: `
        <linearGradient id="axion-9v-metal" x1="0" x2="1">
          <stop offset="0" stop-color="#9ca3af"/><stop offset="0.45" stop-color="#f3f4f6"/><stop offset="1" stop-color="#8b9099"/>
        </linearGradient>
        <linearGradient id="axion-9v-body" x1="0" x2="1">
          <stop offset="0" stop-color="#0b0f17"/><stop offset="0.4" stop-color="#2b3445"/><stop offset="1" stop-color="#0b0f17"/>
        </linearGradient>
        <linearGradient id="axion-9v-band" x1="0" x2="1">
          <stop offset="0" stop-color="#9a6b12"/><stop offset="0.4" stop-color="#f2c14e"/><stop offset="1" stop-color="#9a6b12"/>
        </linearGradient>
      `,
  cell: `
      ${stud}${hexSnap}
      <rect x="4" y="12" width="56" height="10" rx="2" fill="url(#axion-9v-metal)" stroke="#6b7280" stroke-width="0.6"/>
      <rect x="4" y="20" width="56" height="${H - 22}" rx="4" fill="url(#axion-9v-body)" stroke="#4b5563" stroke-width="0.8"/>
      <rect x="4" y="20" width="56" height="40" fill="url(#axion-9v-band)"/>
      <text x="${PLUS}" y="34" font-size="11" font-weight="800" fill="#3d2a05" text-anchor="middle">+</text>
      <text x="${MINUS}" y="34" font-size="11" font-weight="800" fill="#3d2a05" text-anchor="middle">−</text>
      <text x="32" y="55" font-size="15" font-weight="800" fill="#1c1303" text-anchor="middle">9V</text>
      <text x="32" y="80" font-size="7.5" font-weight="700" fill="#e5e7eb" text-anchor="middle" letter-spacing="0.8">ALKALINE</text>
      <text x="32" y="92" font-size="6" fill="#9ca3af" text-anchor="middle">6LR61 · 9 VOLT</text>
      <rect x="4" y="${H - 6}" width="56" height="4" rx="2" fill="#000" opacity="0.35"/>`,
});
