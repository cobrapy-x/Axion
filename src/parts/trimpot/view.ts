// SPDX-License-Identifier: Apache-2.0
import { parseValue } from '../../core/analog/units';
import type { PartView } from '../../core/types';
import { svgRoot } from '../../physics/motor-view';

/** Top view of a 3362P-style trimmer: blue square body, rotor with a screwdriver slot, three legs. */
const W = 38.4;
const H = 58;
const CX = 19.2;
const CY = 18;
const LEGS: Array<[string, number]> = [
  ['GND', 9.6],
  ['SIG', 19.2],
  ['VCC', 28.8],
];
/** The rotor turns 270°, from −135° (GND end) to +135° (VCC end). */
const SWEEP = 270;
const MAX = 1023;

/** "103" = 10 × 10³ Ω: the code printed on trimmers. */
export function trimmerCode(ohms: number): string {
  if (!(ohms >= 10)) return String(Math.round(ohms));
  const exp = Math.floor(Math.log10(ohms)) - 1;
  return `${Math.round(ohms / Math.pow(10, exp))}${exp}`;
}

const angleOf = (value: number) => -SWEEP / 2 + (SWEEP * Math.min(MAX, Math.max(0, value))) / MAX;

function setRotor(el: HTMLElement, value: number): void {
  el.querySelector('.rotor')!.setAttribute('transform', `rotate(${angleOf(value).toFixed(1)} ${CX} ${CY})`);
}

const view: PartView = {
  create(props) {
    const el = svgRoot(
      W,
      H,
      `
      <defs>
        <linearGradient id="axion-trim-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3b82f6"/><stop offset="0.6" stop-color="#1d4ed8"/><stop offset="1" stop-color="#1e3a8a"/>
        </linearGradient>
        <radialGradient id="axion-trim-rotor" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stop-color="#fffdf5"/><stop offset="0.7" stop-color="#e9e1cc"/><stop offset="1" stop-color="#bfb59b"/>
        </radialGradient>
      </defs>
      ${LEGS.map(([, x]) => `<line x1="${x}" y1="34" x2="${x}" y2="${H}" stroke="#a3a9b1" stroke-width="1.8" stroke-linecap="round"/>`).join('')}
      <rect x="1.7" y="1" width="35" height="35" rx="2" fill="url(#axion-trim-body)" stroke="#1e3a8a" stroke-width="0.8"/>
      <rect x="3" y="2.3" width="32.4" height="2" rx="1" fill="#fff" opacity="0.18"/>
      <text class="code" x="${CX}" y="34" font-size="4.6" font-weight="700" fill="#dbeafe" text-anchor="middle"></text>
      <circle cx="${CX}" cy="${CY}" r="13.2" fill="#1e3a8a" opacity="0.6"/>
      <g class="rotor" style="cursor:grab">
        <circle class="knob" cx="${CX}" cy="${CY}" r="12" fill="url(#axion-trim-rotor)" stroke="#8a7f62" stroke-width="0.6"/>
        <rect x="${CX - 1.4}" y="${CY - 9}" width="2.8" height="18" rx="1" fill="#6b6249"/>
        <rect x="${CX - 9}" y="${CY - 1.4}" width="18" height="2.8" rx="1" fill="#6b6249"/>
        <path d="M${CX} ${CY - 13.6} l-2.4 3.4 h4.8 Z" fill="#f8fafc" stroke="#1e3a8a" stroke-width="0.4"/>
      </g>
      ${LEGS.map(([n, x]) => `<text x="${x + 2}" y="54" font-size="4.6" font-weight="700" fill="currentColor" opacity="0.8" transform="rotate(-90 ${x + 2} 54)">${n}</text>`).join('')}`,
    );
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    setRotor(el, Number(props.value) || 0);
    el.querySelector('.code')!.textContent = trimmerCode(parseValue(props.resistance, 10_000));
  },
  update(el, s) {
    if (el.dataset.dragging) return; // the pointer is in charge
    if (typeof s.value === 'number') setRotor(el, s.value);
  },
  pins: () => LEGS.map(([name, x]) => ({ name, x, y: H })),
  attach(el, send) {
    const svg = el.querySelector('svg')!;
    const rotor = el.querySelector('.rotor') as SVGGElement;
    let last = -1;
    const move = (e: PointerEvent) => {
      // Pointer → the part's own coordinates (works when zoomed or rotated).
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      const deg = (Math.atan2(p.x - CX, CY - p.y) * 180) / Math.PI;
      const a = Math.max(-SWEEP / 2, Math.min(SWEEP / 2, deg));
      const value = Math.round(((a + SWEEP / 2) / SWEEP) * MAX);
      if (value === last) return;
      last = value;
      setRotor(el, value);
      send('value', value);
    };
    rotor.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // turning the screw doesn't drag the part
      e.preventDefault();
      rotor.setPointerCapture(e.pointerId);
      el.dataset.dragging = '1';
      rotor.style.cursor = 'grabbing';
      move(e);
    });
    rotor.addEventListener('pointermove', (e) => {
      if (rotor.hasPointerCapture(e.pointerId)) move(e);
    });
    const end = (e: PointerEvent) => {
      if (rotor.hasPointerCapture(e.pointerId)) rotor.releasePointerCapture(e.pointerId);
      delete el.dataset.dragging;
      rotor.style.cursor = 'grab';
    };
    rotor.addEventListener('pointerup', end);
    rotor.addEventListener('pointercancel', end);
  },
};

export default view;
