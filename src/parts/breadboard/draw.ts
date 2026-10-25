// SPDX-License-Identifier: Apache-2.0
/**
 * Breadboard view shared by the full, half and mini breadboards. The whole board
 * is a single SVG: every hole is drawn by one <path>, so even the 830-hole board
 * costs only a handful of DOM nodes.
 */
import type { PartView } from '../../core/types';
import { BREADBOARDS, PITCH, ROWS, colX, holes, railY, rowY, type BreadboardSpec } from './layout';

const HOLE = 3.2;
const LABEL = 'font-family="system-ui,sans-serif" font-size="6.5" fill="#a39b8a" text-anchor="middle"';

function svgFor(spec: BreadboardSpec): string {
  const { width: w, height: h } = spec;
  const all = holes(spec);
  const half = HOLE / 2;
  const holePath = all.map((p) => `M${(p.x - half).toFixed(2)} ${(p.y - half).toFixed(2)}h${HOLE}v${HOLE}h-${HOLE}z`).join('');
  const socketPath = all.map((p) => `M${(p.x - 2.6).toFixed(2)} ${(p.y - 2.6).toFixed(2)}h5.2v5.2h-5.2z`).join('');

  const eY = rowY(spec, 4);
  const fY = rowY(spec, 5);
  const parts: string[] = [];
  // Centre channel
  parts.push(`<rect x="3" y="${eY + 7}" width="${w - 6}" height="${fY - eY - 14}" rx="1.5" fill="#e3ded1"/>`);
  parts.push(`<line x1="3" x2="${w - 3}" y1="${(eY + fY) / 2}" y2="${(eY + fY) / 2}" stroke="#d2ccbd" stroke-width="1"/>`);

  // Power rails: red (+) above tp and above bp, blue (−) below tn and below bn.
  if (spec.railHoles) {
    const x1 = colX(spec, spec.railStart) - 6;
    const x2 = w - x1;
    const stripe = (y: number, color: string) =>
      `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>`;
    const sign = (y: number, plus: boolean) => {
      const color = plus ? '#d33' : '#2f6fd6';
      const at = (x: number) =>
        `<path d="M${x - 2.4} ${y}h4.8${plus ? `M${x} ${y - 2.4}v4.8` : ''}" stroke="${color}" stroke-width="1.1"/>`;
      return at(x1 - 7) + at(x2 + 7);
    };
    for (const [rail, plus, dy] of [['tp', true, -6.6], ['tn', false, 6.6], ['bp', true, -6.6], ['bn', false, 6.6]] as const) {
      const y = railY(spec, rail) + dy;
      parts.push(stripe(y, plus ? '#e0474c' : '#3b7be0'), sign(railY(spec, rail), plus));
    }
    // Grooves between the rails and the terminal strips
    const g1 = (railY(spec, 'tn') + rowY(spec, 0)) / 2 + 3;
    const g2 = (rowY(spec, 9) + railY(spec, 'bp')) / 2 - 3;
    for (const y of [g1, g2]) parts.push(`<line x1="3" x2="${w - 3}" y1="${y}" y2="${y}" stroke="#e6e1d5" stroke-width="2"/>`);
  }

  // Row letters on both sides, column numbers every 5 above and below the strips.
  const lx = spec.x0 - PITCH * 1.25;
  ROWS.forEach((r, i) => {
    const y = rowY(spec, i) + 2.3;
    parts.push(`<text x="${lx}" y="${y}" ${LABEL}>${r}</text><text x="${w - lx}" y="${y}" ${LABEL}>${r}</text>`);
  });
  for (let c = 1; c <= spec.columns; c++) {
    if (c !== 1 && c % 5) continue;
    const x = colX(spec, c);
    parts.push(`<text x="${x}" y="${rowY(spec, 0) - 7}" ${LABEL}>${c}</text><text x="${x}" y="${rowY(spec, 9) + 11.5}" ${LABEL}>${c}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;overflow:visible;filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,.28))">
    <rect x="0" y="0" width="${w}" height="${h}" rx="5" fill="#f4f1e9" stroke="#d9d2c2" stroke-width="1"/>
    ${parts.join('')}
    <path d="${socketPath}" fill="#e9e4d8"/>
    <path d="${holePath}" fill="#34312c"/>
  </svg>`;
}

export function breadboardView(type: keyof typeof BREADBOARDS): PartView {
  const spec = BREADBOARDS[type];
  const pins = holes(spec);
  let markup: string | null = null;
  return {
    create() {
      const el = document.createElement('div');
      el.className = 'breadboard';
      el.style.cssText = `width:${spec.width}px;height:${spec.height}px`;
      el.innerHTML = markup ??= svgFor(spec);
      return el;
    },
    pins: () => pins,
  };
}
