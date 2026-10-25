// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';
import { svgRoot } from '../../physics/motor-view';

const W = 96;
const H = 148;
const COM = 33.6;
const V = 62.4; // 3 breadboard holes apart

/** Text shown on the LCD for a reading. */
export function formatVolts(v: unknown): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '--';
  const n = Number(v);
  return (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);
}

const jack = (x: number, ring: string, label: string) => `
  <rect x="${x - 3}" y="${H - 14}" width="6" height="14" fill="#9ca3af" stroke="#4b5563" stroke-width="0.6"/>
  <circle cx="${x}" cy="${H - 22}" r="8" fill="${ring}" stroke="#111" stroke-width="0.8"/>
  <circle cx="${x}" cy="${H - 22}" r="3.6" fill="#0b0b0b"/>
  <text x="${x}" y="${H - 34}" font-size="7" font-weight="700" fill="#e5e7eb" text-anchor="middle">${label}</text>`;

const ticks = Array.from({ length: 12 }, (_, i) => {
  const a = (i * 30 * Math.PI) / 180;
  const x1 = 48 + Math.sin(a) * 19;
  const y1 = 74 - Math.cos(a) * 19;
  const x2 = 48 + Math.sin(a) * 22;
  const y2 = 74 - Math.cos(a) * 22;
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#9ca3af" stroke-width="1"/>`;
}).join('');

const view: PartView = {
  create: () => {
    const el = svgRoot(
      W,
      H,
      `
      <rect x="1" y="1" width="${W - 2}" height="${H - 9}" rx="12" fill="#f59e0b" stroke="#92400e" stroke-width="1.2"/>
      <rect x="7" y="7" width="${W - 14}" height="${H - 21}" rx="7" fill="#2b3038"/>
      <rect x="13" y="13" width="${W - 26}" height="32" rx="3" fill="#111" />
      <rect x="15" y="15" width="${W - 30}" height="28" rx="2" fill="#b8c7a1"/>
      <text class="lcd" x="${W - 26}" y="38" font-size="17" font-weight="700" fill="#1d2416" text-anchor="end" font-family="ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace">--</text>
      <text x="${W - 18}" y="38" font-size="8" font-weight="700" fill="#1d2416" text-anchor="end">V</text>
      <text x="18.5" y="21.5" font-size="5" font-weight="700" fill="#38452a">DC</text>
      ${ticks}
      <circle cx="48" cy="74" r="16" fill="#111827" stroke="#000"/>
      <circle cx="48" cy="74" r="12.5" fill="#1f2937"/>
      <rect x="46" y="58" width="4" height="14" rx="2" fill="#f3f4f6"/>
      <text x="48" y="104" font-size="7" font-weight="700" fill="#e5e7eb" text-anchor="middle">V ⎓</text>
      ${jack(COM, '#1f1f1f', 'COM')}
      ${jack(V, '#dc2626', 'V')}`,
    );
    return el;
  },
  update(el, s) {
    const text = formatVolts(s.volts);
    const lcd = el.querySelector('.lcd')!;
    if (lcd.textContent !== text) {
      lcd.textContent = text;
      lcd.setAttribute('font-size', text.length > 5 ? '14' : '17'); // e.g. -12.34
    }
  },
  reset(el) {
    const lcd = el.querySelector('.lcd')!;
    lcd.textContent = '--';
    lcd.setAttribute('font-size', '17');
  },
  pins: () => [
    { name: 'COM', x: COM, y: H },
    { name: 'V', x: V, y: H },
  ],
};

export default view;
