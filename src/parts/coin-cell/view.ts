// SPDX-License-Identifier: Apache-2.0
import { batteryBankView } from '../../physics/battery-bank';

const W = 76;
const H = 78;
const PLUS = 28.4;
const MINUS = 47.6; // 2 breadboard holes apart
const CX = 38;
const CY = 38;

/** One CR2032 in its holder; the bank helper repeats it for 2–4 cells in series. */
export default batteryBankView({
  w: W,
  h: H,
  plusX: PLUS,
  minusX: MINUS,
  side: 'bottom',
  volts: 3,
  maxCount: 4,
  defs: `
        <radialGradient id="axion-coin" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#cfd3d8"/><stop offset="1" stop-color="#868c95"/>
        </radialGradient>
        <linearGradient id="axion-coin-clip" x1="0" x2="1">
          <stop offset="0" stop-color="#9ca3af"/><stop offset="0.5" stop-color="#e5e7eb"/><stop offset="1" stop-color="#9ca3af"/>
        </linearGradient>
      `,
  cell: `
      <path d="M8 18 Q8 4 22 4 H54 Q68 4 68 18 V66 Q68 76 58 76 H18 Q8 76 8 66 Z" fill="#1f2328" stroke="#5b636e"/>
      <circle cx="${CX}" cy="${CY}" r="29" fill="url(#axion-coin)" stroke="#6b7280" stroke-width="0.8"/>
      <circle cx="${CX}" cy="${CY}" r="25.5" fill="none" stroke="#9aa0a8" stroke-width="0.7"/>
      <text x="${CX}" y="${CY - 7}" font-size="12" font-weight="800" fill="#4b5563" text-anchor="middle">+</text>
      <text x="${CX}" y="${CY + 5}" font-size="9" font-weight="800" fill="#374151" text-anchor="middle">CR2032</text>
      <text x="${CX}" y="${CY + 15}" font-size="8" font-weight="700" fill="#4b5563" text-anchor="middle">3V</text>
      <path d="M58 30 H70 V46 H58 Q54 38 58 30 Z" fill="url(#axion-coin-clip)" stroke="#6b7280" stroke-width="0.6"/>
      <text x="${PLUS}" y="74" font-size="8" font-weight="800" fill="#e5e7eb" text-anchor="middle">+</text>
      <text x="${MINUS}" y="74" font-size="8" font-weight="800" fill="#e5e7eb" text-anchor="middle">−</text>`,
});
