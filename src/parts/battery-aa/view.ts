// SPDX-License-Identifier: Apache-2.0
import { batteryBankView } from '../../physics/battery-bank';

/** One AA cell standing in a holder slot; the bank helper repeats it for 2–8 cells in series. */
const W = 38.4; // 4 breadboard holes
const H = 104;

const spring = Array.from({ length: 5 }, (_, i) => `M9 ${94 + (i % 2) * 3} L${13 + i * 4} ${97 - (i % 2) * 3}`).join(' ');

export default batteryBankView({
  w: W,
  h: H,
  plusX: 9.6,
  minusX: 28.8,
  side: 'bottom',
  volts: 1.5,
  maxCount: 8,
  defs: `
    <linearGradient id="axion-aa-black" x1="0" x2="1">
      <stop offset="0" stop-color="#030712"/><stop offset="0.4" stop-color="#374151"/><stop offset="1" stop-color="#030712"/>
    </linearGradient>
    <linearGradient id="axion-aa-copper" x1="0" x2="1">
      <stop offset="0" stop-color="#6b3a05"/><stop offset="0.4" stop-color="#fbbf6b"/><stop offset="1" stop-color="#6b3a05"/>
    </linearGradient>
    <linearGradient id="axion-aa-metal" x1="0" x2="1">
      <stop offset="0" stop-color="#8b9099"/><stop offset="0.5" stop-color="#f3f4f6"/><stop offset="1" stop-color="#8b9099"/>
    </linearGradient>`,
  cell: `
    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="4" fill="#262b33" stroke="#5b636e"/>
    <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="2" fill="#15181d"/>
    <rect x="${W / 2 - 4}" y="6" width="8" height="5" rx="1.5" fill="url(#axion-aa-metal)"/>
    <rect x="7" y="11" width="${W - 14}" height="80" rx="3" fill="url(#axion-aa-black)"/>
    <rect x="7" y="11" width="${W - 14}" height="24" rx="3" fill="url(#axion-aa-copper)"/>
    <rect x="7" y="31" width="${W - 14}" height="4" fill="url(#axion-aa-copper)"/>
    <text x="${W / 2}" y="27" font-size="11" font-weight="800" fill="#2a1602" text-anchor="middle">+</text>
    <text x="${W / 2}" y="63" font-size="8.5" font-weight="800" fill="#f9fafb" text-anchor="middle" transform="rotate(-90 ${W / 2} 60)">AA 1.5V</text>
    <path d="${spring}" stroke="#c0c4ca" stroke-width="1.1" fill="none"/>
    <text x="9.6" y="${H - 3}" font-size="7" font-weight="700" fill="#fca5a5" text-anchor="middle">+</text>
    <text x="28.8" y="${H - 3}" font-size="7" font-weight="700" fill="#e5e7eb" text-anchor="middle">−</text>`,
});
