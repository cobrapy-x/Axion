// SPDX-License-Identifier: Apache-2.0
import { formatValue, parseValue } from '../../core/analog/units';
import type { PartView, Props } from '../../core/types';
import { svgRoot } from '../../physics/motor-view';

/**
 * A small sliding rheostat: a ceramic tube wound with resistance wire between two end
 * plates, and a slider on a rod above it. Pin 1 is the left end of the winding, pin 2 the
 * rod (the slider), so the resistance grows as the slider moves right.
 */
const W = 134.4;
const H = 78;
const P1 = 19.2;
const P2 = 115.2; // 10 breadboard holes apart
const X0 = 22; // winding from X0 to X1
const X1 = 112;
const TUBE_Y = 22;
const TUBE_H = 18;

const winding = (() => {
  let s = '';
  for (let x = X0 + 1; x < X1; x += 2.2) s += `<line x1="${x.toFixed(1)}" y1="${TUBE_Y}" x2="${(x + 1.2).toFixed(1)}" y2="${TUBE_Y + TUBE_H}"/>`;
  return s;
})();

function draw(el: HTMLElement, position: number, total: number): void {
  const p = Math.min(100, Math.max(0, position)) / 100;
  const x = X0 + 3 + p * (X1 - X0 - 6);
  el.querySelector('.slider')!.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
  el.querySelector('.ohms')!.textContent = formatValue(Math.max(1, total * p), 'Ω');
}

const totalOf = (props: Props) => Math.max(2, parseValue(props.resistance, 10_000));

const view: PartView = {
  create(props) {
    const el = svgRoot(
      W,
      H,
      `
      <defs>
        <linearGradient id="axion-rh-tube" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#f8f5ee"/><stop offset="0.5" stop-color="#e2dccd"/><stop offset="1" stop-color="#a8a090"/>
        </linearGradient>
        <linearGradient id="axion-rh-rod" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#f3f4f6"/><stop offset="1" stop-color="#6b7280"/>
        </linearGradient>
      </defs>
      <rect x="4" y="${H - 10}" width="${W - 8}" height="3" rx="1.5" fill="#4b5563"/>
      <rect x="${X0 - 2}" y="${TUBE_Y}" width="${X1 - X0 + 4}" height="${TUBE_H}" rx="3" fill="url(#axion-rh-tube)" stroke="#8b8372" stroke-width="0.6"/>
      <g stroke="#b45309" stroke-width="0.9" opacity="0.9">${winding}</g>
      <rect x="${X0}" y="${TUBE_Y + 1}" width="${X1 - X0}" height="3" fill="#fff" opacity="0.25"/>
      <rect x="6" y="6" width="${X0 - 9}" height="${H - 15}" rx="2" fill="#1f2937" stroke="#030712" stroke-width="0.6"/>
      <rect x="${X1 + 3}" y="6" width="${W - X1 - 9}" height="${H - 15}" rx="2" fill="#1f2937" stroke="#030712" stroke-width="0.6"/>
      <rect x="9" y="10" width="${W - 18}" height="4" rx="2" fill="url(#axion-rh-rod)" stroke="#4b5563" stroke-width="0.4"/>
      <g class="slider">
        <rect x="-6" y="6" width="12" height="12" rx="2" fill="#111827" stroke="#000" stroke-width="0.5"/>
        <rect x="-4.5" y="7.2" width="9" height="2.2" rx="1" fill="#fff" opacity="0.15"/>
        <path d="M-2 18 L-2 ${TUBE_Y + 2} L2 ${TUBE_Y + 2} L2 18 Z" fill="#d4a017" stroke="#7c5e0a" stroke-width="0.4"/>
      </g>
      <text class="ohms" x="${W / 2}" y="${TUBE_Y + TUBE_H + 12}" font-size="8" font-weight="700" fill="currentColor" text-anchor="middle"></text>
      ${[P1, P2].map((x) => `<rect x="${x - 3}" y="${H - 7}" width="6" height="7" fill="#d4a017" stroke="#7c5e0a" stroke-width="0.6"/>`).join('')}
      <text x="${P1 - 6}" y="${H - 15}" font-size="7.5" font-weight="700" fill="#e5e7eb" text-anchor="middle">1</text>
      <text x="${P2 + 6}" y="${H - 15}" font-size="7.5" font-weight="700" fill="#e5e7eb" text-anchor="middle">2</text>`,
    );
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    el.dataset.total = String(totalOf(props));
    draw(el, Number(props.position ?? 50), totalOf(props));
  },
  update(el, s) {
    if (typeof s.position === 'number') draw(el, s.position, Number(el.dataset.total) || 10_000);
  },
  pins: () => [
    { name: '1', x: P1, y: H },
    { name: '2', x: P2, y: H },
  ],
};

export default view;
