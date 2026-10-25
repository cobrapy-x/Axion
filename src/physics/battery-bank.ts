// SPDX-License-Identifier: Apache-2.0
/**
 * Batteries that can be stacked in series: the part's `count` prop draws that many
 * cells side by side, links each cell's − to the next cell's + with a short strap,
 * and sets the voltage to count × cell voltage.
 *
 * The '+' pin always stays at the same spot, so wires attached to it don't move when
 * cells are added; the '−' pin moves right with the last cell.
 */
import type { ModelFactory, PartView, Props } from '../core/types';

const PITCH = 9.6; // 0.1" breadboard grid
const LEAD = 14; // space for leads and series straps
const BAND = 16; // space for the "3 × 1.5 V = 4.5 V" label

export interface CellDesign {
  /** Width and height of one cell's drawing (without leads). */
  w: number;
  h: number;
  /** x of the + and − terminals inside one cell (+ must be left of −). */
  plusX: number;
  minusX: number;
  /** Edge of the cell the terminals come out of. */
  side: 'top' | 'bottom';
  /** Volts per cell. */
  volts: number;
  maxCount: number;
  /** Shared <defs> (gradients). Use ids unique to the part. */
  defs: string;
  /** One cell's SVG markup in its own coordinates (0..w, 0..h). */
  cell: string;
}

export function cellCount(props: Props, max: number): number {
  const n = Math.round(Number(props.count) || 1);
  return Math.min(max, Math.max(1, n));
}

/** Model: an ideal source of count × cell volts between '+' and '−' (all grounds share 0 V). */
export function bankSource(volts: number, maxCount: number): ModelFactory {
  return (ctx) => {
    const total = volts * cellCount(ctx.props, maxCount);
    return { drive: (pin) => (pin === '+' ? total : pin === '-' ? 0 : 'z') };
  };
}

function layout(d: CellDesign, count: number) {
  const pitch = Math.ceil((d.w + 6) / PITCH) * PITCH;
  const width = pitch * (count - 1) + d.w;
  const height = d.h + LEAD + BAND;
  // Bottom terminals: label band on top. Top terminals: label band underneath.
  const bodyY = d.side === 'bottom' ? BAND : LEAD;
  const edgeY = d.side === 'bottom' ? bodyY + d.h : bodyY; // where terminals leave the cells
  const pinY = d.side === 'bottom' ? height : 0;
  const bandY = d.side === 'bottom' ? 0 : LEAD + d.h;
  return { pitch, width, height, bodyY, edgeY, pinY, bandY };
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

function svg(d: CellDesign, count: number): string {
  const L = layout(d, count);
  const dir = d.side === 'bottom' ? 1 : -1;
  let body = '';
  for (let i = 0; i < count; i++) body += `<g transform="translate(${i * L.pitch} ${L.bodyY})">${d.cell}</g>`;

  // Series straps: cell i '−' → cell i+1 '+'
  let straps = '';
  const strapY = L.edgeY + dir * LEAD * 0.55;
  for (let i = 0; i < count - 1; i++) {
    const x1 = i * L.pitch + d.minusX;
    const x2 = (i + 1) * L.pitch + d.plusX;
    straps += `<path d="M${x1} ${L.edgeY} V${strapY} H${x2} V${L.edgeY}" fill="none" stroke="#475569" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const plusX = d.plusX;
  const minusX = (count - 1) * L.pitch + d.minusX;
  const leads = `
    <path d="M${plusX} ${L.edgeY} V${L.pinY}" stroke="#dc2626" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M${minusX} ${L.edgeY} V${L.pinY}" stroke="#111827" stroke-width="2.4" stroke-linecap="round"/>`;

  const total = d.volts * count;
  const text = count > 1 ? `${count} × ${fmt(d.volts)} V = ${fmt(total)} V` : `${fmt(total)} V`;
  const labelW = Math.min(L.width, 12 + text.length * 5.6);
  const band = `
    <rect x="${(L.width - labelW) / 2}" y="${L.bandY + 2}" width="${labelW}" height="${BAND - 4}" rx="6" fill="#0f172a" opacity="0.85"/>
    <text x="${L.width / 2}" y="${L.bandY + BAND / 2 + 3.5}" font-size="9.5" font-weight="700" fill="#f8fafc" text-anchor="middle">${text}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" font-family="system-ui,sans-serif">
    <defs>${d.defs}</defs>${straps}${leads}${body}${band}</svg>`;
}

/** View for a stackable battery. Reads `count` from the part's props. */
export function batteryBankView(d: CellDesign): PartView {
  const draw = (el: HTMLElement, props: Props) => {
    const count = cellCount(props, d.maxCount);
    el.dataset.count = String(count);
    el.innerHTML = svg(d, count);
  };
  return {
    create(props) {
      const el = document.createElement('div');
      draw(el, props);
      return el;
    },
    setProps: draw,
    pins(el) {
      const count = Number(el.dataset.count) || 1;
      const L = layout(d, count);
      return [
        { name: '+', x: d.plusX, y: L.pinY },
        { name: '-', x: (count - 1) * L.pitch + d.minusX, y: L.pinY },
      ];
    },
  };
}
