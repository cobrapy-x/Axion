// SPDX-License-Identifier: Apache-2.0
/**
 * Views of axial parts lying flat, like the resistor: a lead on each side, 6 breadboard
 * holes (57.6 px) apart, the body in the middle. Used by the diodes and the inductor.
 */
import type { PartView, Props } from '../core/types';
import { parseValue } from '../core/analog/units';
import { svgRoot } from './motor-view';

export const AXIAL_W = 57.6;

const LEAD = '#a3a9b1';

export interface DiodeLook {
  /** 'glass': clear orange glass (1N4148, zeners); 'black': moulded epoxy (1N4007, 1N5819). */
  body: 'glass' | 'black';
  /** Body length and diameter in px. */
  length: number;
  diameter: number;
  /** Text printed on the body (may depend on props, e.g. the zener voltage). */
  print?: string | ((props: Props) => string);
}

/**
 * Diode lying flat: anode (A) on the left, cathode (K, the band) on the right.
 * State `on` (forward) or `breakdown` (zener) make the die glow slightly.
 */
export function diodeView(look: DiodeLook): PartView {
  const H = 14;
  const cy = 7;
  const x0 = (AXIAL_W - look.length) / 2;
  const x1 = x0 + look.length;
  const r = look.diameter / 2;
  const bandW = Math.max(2.4, look.length * 0.14);
  const bandX = x1 - bandW - look.length * 0.08;
  const glass = look.body === 'glass';
  // A printed glass body (zener) keeps the die beside the text, near the band.
  const dieX = glass && look.print ? (x0 + look.length * 0.62 + bandX) / 2 : AXIAL_W / 2;
  const textX = glass && look.print ? (x0 + dieX - 1.6) / 2 + 0.3 : (x0 + bandX) / 2 + 0.5;
  const text = (props: Props) => (typeof look.print === 'function' ? look.print(props) : (look.print ?? ''));
  const body = glass
    ? `
      <rect x="${x0}" y="${cy - r}" width="${look.length}" height="${look.diameter}" rx="${r}" fill="#f59e3b" fill-opacity="0.55" stroke="#b45309" stroke-width="0.5"/>
      <line x1="${x0 + 1}" y1="${cy}" x2="${x1 - 1}" y2="${cy}" stroke="#d1d5db" stroke-width="1.6"/>
      <rect class="die" x="${dieX - 1.6}" y="${cy - 1.6}" width="3.2" height="3.2" fill="#374151"/>
      <rect x="${bandX}" y="${cy - r}" width="${bandW}" height="${look.diameter}" fill="#111827" opacity="0.9"/>
      <rect x="${x0 + 1.5}" y="${cy - r + 0.8}" width="${look.length - 3}" height="${Math.max(1, r * 0.45)}" rx="0.8" fill="#fff" opacity="0.45"/>`
    : `
      <rect x="${x0}" y="${cy - r}" width="${look.length}" height="${look.diameter}" rx="${r * 0.55}" fill="url(#axion-diode-black)" stroke="#000" stroke-width="0.4"/>
      <rect x="${bandX}" y="${cy - r}" width="${bandW}" height="${look.diameter}" fill="#c7ccd3"/>
      <rect class="die" x="0" y="0" width="0" height="0"/>`;
  return {
    create(props) {
      const el = svgRoot(
        AXIAL_W,
        H,
        `
        <defs>
          <linearGradient id="axion-diode-black" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#4b5563"/><stop offset="0.35" stop-color="#1f2937"/><stop offset="1" stop-color="#030712"/>
          </linearGradient>
        </defs>
        <line x1="0.8" y1="${cy}" x2="${AXIAL_W - 0.8}" y2="${cy}" stroke="${LEAD}" stroke-width="1.6" stroke-linecap="round"/>
        ${body}
        <text class="print" x="${textX}" y="${cy + 1.6}" font-size="${glass ? 4 : 4.6}" font-weight="700" fill="${glass ? '#3b1d04' : '#d1d5db'}" text-anchor="middle"></text>
        <text x="3" y="${cy - 2.2}" font-size="4.8" font-weight="700" fill="currentColor" opacity="0.75">A</text>
        <text x="${AXIAL_W - 3}" y="${cy - 2.2}" font-size="4.8" font-weight="700" fill="currentColor" opacity="0.75" text-anchor="end">K</text>`,
      );
      this.setProps!(el, props);
      return el;
    },
    setProps(el, props) {
      el.querySelector('.print')!.textContent = text(props);
    },
    update(el, s) {
      if (!glass) return;
      const die = el.querySelector('.die')!;
      die.setAttribute('fill', s.on || s.breakdown ? '#f97316' : '#374151');
    },
    reset(el) {
      if (glass) el.querySelector('.die')!.setAttribute('fill', '#374151');
    },
    pins: () => [
      { name: 'A', x: 0, y: cy },
      { name: 'K', x: AXIAL_W, y: cy },
    ],
  };
}

// ───────────────────────────── inductor ─────────────────────────────

const BAND_COLORS = ['#111111', '#8b4513', '#dc2626', '#f97316', '#facc15', '#16a34a', '#2563eb', '#7c3aed', '#9ca3af', '#f9fafb'];
const GOLD = '#c9a227';
const SILVER = '#c0c4ca';

/** Colour bands of an inductance in µH (two digits + multiplier), like a resistor. */
export function inductorBands(henries: number): string[] {
  const uh = henries * 1e6;
  if (!(uh > 0)) return [BAND_COLORS[0], BAND_COLORS[0], BAND_COLORS[0]];
  let exp = Math.floor(Math.log10(uh)) - 1;
  let digits = Math.round(uh / Math.pow(10, exp));
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp++;
  }
  const mult = exp >= 0 && exp <= 9 ? BAND_COLORS[exp] : exp === -1 ? GOLD : SILVER;
  return [BAND_COLORS[Math.floor(digits / 10) % 10], BAND_COLORS[digits % 10], mult];
}

/** Axial moulded choke: light green body with µH colour bands and the value printed below. */
export function inductorView(): PartView {
  const H = 22;
  const cy = 7.5;
  const len = 26;
  const d = 11;
  const x0 = (AXIAL_W - len) / 2;
  return {
    create(props) {
      const el = svgRoot(
        AXIAL_W,
        H,
        `
        <defs>
          <linearGradient id="axion-inductor-body" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#a7d3a0"/><stop offset="0.35" stop-color="#6fae6a"/><stop offset="1" stop-color="#2f6b3a"/>
          </linearGradient>
        </defs>
        <line x1="0.8" y1="${cy}" x2="${AXIAL_W - 0.8}" y2="${cy}" stroke="${LEAD}" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M${x0 + 2} ${cy - d / 2} H${x0 + len - 2} Q${x0 + len + 1} ${cy - d / 2} ${x0 + len + 1} ${cy} Q${x0 + len + 1} ${cy + d / 2} ${x0 + len - 2} ${cy + d / 2} H${x0 + 2} Q${x0 - 1} ${cy + d / 2} ${x0 - 1} ${cy} Q${x0 - 1} ${cy - d / 2} ${x0 + 2} ${cy - d / 2} Z" fill="url(#axion-inductor-body)" stroke="#1f4d29" stroke-width="0.5"/>
        <g class="bands"></g>
        <rect x="${x0 + 1}" y="${cy - d / 2 + 1}" width="${len - 2}" height="2" rx="1" fill="#fff" opacity="0.3"/>
        <text class="value" x="${AXIAL_W / 2}" y="${H - 1}" font-size="6.5" font-weight="600" fill="currentColor" text-anchor="middle"></text>`,
      );
      this.setProps!(el, props);
      return el;
    },
    setProps(el, props) {
      const henries = parseValue(props.inductance, 10e-3);
      const colors = [...inductorBands(henries), GOLD];
      const xs = [x0 + 3.5, x0 + 8, x0 + 12.5, x0 + 20];
      el.querySelector('.bands')!.innerHTML = colors.map((c, i) => `<rect x="${xs[i]}" y="${cy - d / 2}" width="2.6" height="${d}" fill="${c}"/>`).join('');
      el.querySelector('.value')!.textContent = String(props.inductance ?? '10mH');
    },
    pins: () => [
      { name: '1', x: 0, y: cy },
      { name: '2', x: AXIAL_W, y: cy },
    ],
  };
}
