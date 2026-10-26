// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';
import { formatLux, lightLevel } from '../../physics/ldr';
import { svgRoot } from '../../physics/motor-view';

/**
 * Top view of a 5 mm CdS photoresistor: white ceramic disc with the orange serpentine
 * track between two silver electrodes, under clear epoxy. A halo and a sun / moon glyph
 * show the light level, with the value in lux underneath.
 */
const W = 38.4;
const H = 66;
const CX = 19.2;
const CY = 16;
const R = 12.5;
const P1 = 9.6;
const P2 = 28.8; // 2 breadboard holes apart

/** Meander of the CdS track inside the disc. */
const track = (() => {
  const rows = 7;
  const top = CY - R + 3.5;
  const step = (2 * R - 7) / (rows - 1);
  let d = '';
  for (let i = 0; i < rows; i++) {
    const y = top + i * step;
    const half = Math.sqrt(Math.max(0, (R - 2.6) ** 2 - (y - CY) ** 2));
    const [xa, xb] = i % 2 ? [CX + half, CX - half] : [CX - half, CX + half];
    d += i === 0 ? `M${xa.toFixed(2)} ${y.toFixed(2)} ` : `L${xa.toFixed(2)} ${y.toFixed(2)} `;
    d += `L${xb.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
})();

const SUN = `
  <g class="sun">
    <circle cx="0" cy="0" r="2.6" fill="#facc15" stroke="#b45309" stroke-width="0.4"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<line x1="0" y1="-3.6" x2="0" y2="-5" stroke="#f59e0b" stroke-width="0.9" stroke-linecap="round" transform="rotate(${a})"/>`).join('')}
  </g>`;
const MOON = `<path class="moon" d="M1.6 -3.6 A3.8 3.8 0 1 0 1.6 3.6 A2.9 2.9 0 1 1 1.6 -3.6 Z" fill="#c7d2fe" stroke="#4f46e5" stroke-width="0.4"/>`;

function draw(el: HTMLElement, lux: number): void {
  const level = lightLevel(lux);
  el.querySelector('.halo')!.setAttribute('opacity', (level * 0.9).toFixed(2));
  el.querySelector('.disc')!.setAttribute('fill', level > 0.35 ? '#fbf6e9' : '#ddd6c6');
  const day = lux >= 10;
  (el.querySelector('.sun') as SVGElement).style.display = day ? '' : 'none';
  (el.querySelector('.moon') as SVGElement).style.display = day ? 'none' : '';
  el.querySelector('.lux')!.textContent = formatLux(lux);
}

const view: PartView = {
  create(props) {
    const el = svgRoot(
      W,
      H,
      `
      <defs>
        <radialGradient id="axion-ldr-halo">
          <stop offset="0.45" stop-color="#fde047" stop-opacity="0.9"/><stop offset="1" stop-color="#fde047" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle class="halo" cx="${CX}" cy="${CY}" r="${R + 6}" fill="url(#axion-ldr-halo)" opacity="0"/>
      <line x1="${P1}" y1="${CY + 6}" x2="${P1}" y2="${H}" stroke="#a3a9b1" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="${P2}" y1="${CY + 6}" x2="${P2}" y2="${H}" stroke="#a3a9b1" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="${CX}" cy="${CY}" r="${R + 1}" fill="#e5e7eb" fill-opacity="0.5" stroke="#9ca3af" stroke-width="0.6"/>
      <circle class="disc" cx="${CX}" cy="${CY}" r="${R}" fill="#ddd6c6" stroke="#a8a29e" stroke-width="0.5"/>
      <path d="M${CX - R + 1.2} ${CY - 5} A${R - 1.2} ${R - 1.2} 0 0 1 ${CX + R - 1.2} ${CY - 5}" fill="none" stroke="#9ca3af" stroke-width="2.4"/>
      <path d="M${CX - R + 1.2} ${CY + 5} A${R - 1.2} ${R - 1.2} 0 0 0 ${CX + R - 1.2} ${CY + 5}" fill="none" stroke="#9ca3af" stroke-width="2.4"/>
      <path d="${track}" fill="none" stroke="#c2410c" stroke-width="1.3" stroke-linejoin="round"/>
      <ellipse cx="${CX - 4}" cy="${CY - 6}" rx="5" ry="2.2" fill="#fff" opacity="0.45"/>
      <g transform="translate(${W - 4.5} 4.5)">${SUN}${MOON}</g>
      <rect x="${CX - 13}" y="${CY + R + 3.5}" width="26" height="8.6" rx="4.3" fill="#111827" opacity="0.82"/>
      <text class="lux" x="${CX}" y="${CY + R + 10}" font-size="6" font-weight="700" fill="#f9fafb" text-anchor="middle"></text>`,
    );
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    draw(el, Math.max(0, Number(props.lux ?? 100) || 0));
  },
  update(el, s) {
    if (typeof s.lux === 'number') draw(el, s.lux);
  },
  pins: () => [
    { name: '1', x: P1, y: H },
    { name: '2', x: P2, y: H },
  ],
};

export default view;
