// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';
import { svgRoot } from '../../physics/motor-view';

const W = 124;
const H = 150;
const MINUS = 52.8;
const PLUS = 72; // 2 breadboard holes apart

/** One AA cell standing up; `up` = '+' end at the top. Cells alternate in a series pack. */
function cell(x: number, up: boolean): string {
  const top = 12;
  const h = 96;
  const nub = up
    ? `<rect x="${x + 7}" y="${top - 3}" width="8" height="4" rx="1" fill="url(#axion-4aa-metal)"/>`
    : `<rect x="${x + 7}" y="${top + h - 1}" width="8" height="4" rx="1" fill="url(#axion-4aa-metal)"/>`;
  const copperY = up ? top : top + h * 0.66;
  const textY = top + h / 2;
  return `
    ${nub}
    <rect x="${x}" y="${top}" width="22" height="${h}" rx="3" fill="url(#axion-4aa-black)"/>
    <rect x="${x}" y="${copperY}" width="22" height="${h * 0.34}" fill="url(#axion-4aa-copper)"/>
    <text x="0" y="0" font-size="8" font-weight="800" fill="#f3f4f6" text-anchor="middle" transform="translate(${x + 14} ${textY}) rotate(-90)">AA</text>
    <text x="${x + 11}" y="${up ? top + 11 : top + h - 5}" font-size="9" font-weight="800" fill="#2a1602" text-anchor="middle">+</text>`;
}

const view: PartView = {
  create: () =>
    svgRoot(
      W,
      H,
      `
      <defs>
        <linearGradient id="axion-4aa-black" x1="0" x2="1">
          <stop offset="0" stop-color="#030712"/><stop offset="0.4" stop-color="#4b5563"/><stop offset="1" stop-color="#030712"/>
        </linearGradient>
        <linearGradient id="axion-4aa-copper" x1="0" x2="1">
          <stop offset="0" stop-color="#6b3a05"/><stop offset="0.4" stop-color="#fbbf6b"/><stop offset="1" stop-color="#6b3a05"/>
        </linearGradient>
        <linearGradient id="axion-4aa-metal" x1="0" x2="1">
          <stop offset="0" stop-color="#8b9099"/><stop offset="0.5" stop-color="#f3f4f6"/><stop offset="1" stop-color="#8b9099"/>
        </linearGradient>
      </defs>
      <path d="M${MINUS} 124 V${H}" stroke="#9ca3af" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M${MINUS} 124 V${H}" stroke="#111827" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M${PLUS} 124 V${H}" stroke="#dc2626" stroke-width="2.4" stroke-linecap="round"/>
      <rect x="2" y="2" width="${W - 4}" height="124" rx="6" fill="#262b33" stroke="#5b636e"/>
      <rect x="6" y="6" width="${W - 12}" height="108" rx="3" fill="#15181d"/>
      ${[0, 1, 2, 3].map((i) => cell(10 + i * 27, i % 2 === 0)).join('')}
      <text x="${W / 2}" y="122" font-size="7.5" font-weight="700" fill="#d1d5db" text-anchor="middle">4 × AA · 6V</text>
      <text x="${MINUS - 5}" y="142" font-size="10" font-weight="700" fill="currentColor" text-anchor="end">−</text>
      <text x="${PLUS + 5}" y="142" font-size="10" font-weight="700" fill="currentColor">+</text>`,
    ),
  pins: () => [
    { name: '-', x: MINUS, y: H },
    { name: '+', x: PLUS, y: H },
  ],
};

export default view;
