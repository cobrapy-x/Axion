// SPDX-License-Identifier: Apache-2.0
/**
 * Drawing of a single logic gate: an ANSI (distinctive-shape) symbol on a light body
 * that reads well on both light and dark canvases. Pins sit on the edges, on the
 * 0.1" (9.6 px) grid: inputs left, output right, VCC on top, GND at the bottom.
 * While running, each lead shows its level: red = HIGH, blue = LOW, amber = floating.
 */
import type { PartView, PinPosition } from '../core/types';
import type { GateKind } from './logic-gate';

const NS = 'http://www.w3.org/2000/svg';
const W = 96;
const H = 76.8;
const MID = 38.4;
const TOP = 16;
const BOT = 60.8;

const LEAD = '#9ca3af';
const HIGH = '#ef4444';
const LOW = '#3b82f6';
const FLOAT = '#f59e0b';

interface Shape {
  body: string;
  /** Where the input leads meet the body. */
  inX: number;
  /** Where the output lead (or bubble) starts. */
  outX: number;
  bubble: boolean;
  /** Where the VCC / GND leads (at x = 48) meet the body. */
  railY?: [number, number];
  /** Centre of the gate name. */
  labelX: number;
}

const andBody = `M22 ${TOP} H46 A22.4 22.4 0 0 1 46 ${BOT} H22 Z`;
const orBody = (dx: number) =>
  `M${20 + dx} ${TOP} Q${31 + dx} ${MID} ${20 + dx} ${BOT} Q${52 + dx} ${BOT} ${70 + dx} ${MID} Q${52 + dx} ${TOP} ${20 + dx} ${TOP} Z`;
const xorBack = `<path d="M15 ${TOP} Q26 ${MID} 15 ${BOT}" fill="none" style="stroke:var(--text-2,#334155)" stroke-width="1.6" stroke-linecap="round"/>`;

const SHAPES: Record<GateKind, Shape> = {
  and: { body: andBody, inX: 23, outX: 68.4, bubble: false, labelX: 41 },
  nand: { body: andBody, inX: 23, outX: 68.4, bubble: true, labelX: 41 },
  or: { body: orBody(0), inX: 25, outX: 70, bubble: false, labelX: 44 },
  nor: { body: orBody(0), inX: 25, outX: 70, bubble: true, labelX: 44 },
  xor: { body: orBody(5), inX: 20, outX: 75, bubble: false, labelX: 49 },
  xnor: { body: orBody(5), inX: 20, outX: 75, bubble: true, labelX: 50 },
  not: { body: `M24 ${TOP} L62 ${MID} L24 ${BOT} Z`, inX: 25, outX: 62, bubble: true, railY: [30.6, 46.2], labelX: 36 },
};

function pinList(kind: GateKind): PinPosition[] {
  const inputs = kind === 'not' ? [{ name: 'A', x: 0, y: MID }] : [{ name: 'A', x: 0, y: 28.8 }, { name: 'B', x: 0, y: 48 }];
  return [...inputs, { name: 'Y', x: W, y: MID }, { name: 'VCC', x: 48, y: 0 }, { name: 'GND', x: 48, y: H }];
}

export function gateView(kind: GateKind, label: string): PartView {
  const s = SHAPES[kind];
  const pins = pinList(kind);
  const inputs = pins.filter((p) => p.name === 'A' || p.name === 'B');
  const leadEnd = s.bubble ? s.outX + 8 : s.outX;
  const text = (x: number, y: number, t: string, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-size="7.5" text-anchor="${anchor}" style="fill:var(--muted,#6b7280)">${t}</text>`;
  const body = `
    <g class="leads" stroke-width="2" stroke-linecap="round">
      ${inputs.map((p) => `<line class="lead-${p.name}" x1="1" y1="${p.y}" x2="${s.inX}" y2="${p.y}" stroke="${LEAD}"/>`).join('')}
      <line class="lead-Y" x1="${leadEnd - 1}" y1="${MID}" x2="${W - 1}" y2="${MID}" stroke="${LEAD}"/>
      <line x1="48" y1="1" x2="48" y2="${s.railY?.[0] ?? TOP + 2}" stroke="${LEAD}"/>
      <line x1="48" y1="${s.railY?.[1] ?? BOT - 2}" x2="48" y2="${H - 1}" stroke="${LEAD}"/>
    </g>
    ${kind === 'xor' || kind === 'xnor' ? xorBack : ''}
    <path class="gate-body" d="${s.body}" fill="#f8fafc" stroke="#334155" stroke-width="1.6" stroke-linejoin="round"/>
    ${s.bubble ? `<circle cx="${s.outX + 4}" cy="${MID}" r="3.6" fill="#f8fafc" stroke="#334155" stroke-width="1.6"/>` : ''}
    <text x="${s.labelX}" y="${MID + 3}" font-size="${kind === 'not' ? 7 : label.length > 3 ? 8 : 9}" font-weight="700" fill="#334155" text-anchor="middle" letter-spacing="0.3">${label}</text>
    ${inputs.map((p) => text(4, p.y - 3.5, p.name)).join('')}
    ${text(W - 4, MID - 3.5, 'Y', 'end')}
    ${text(52, 9, 'VCC')}
    ${text(52, H - 3, 'GND')}
    ${inputs.map((p) => `<text class="float-${p.name}" x="${s.inX - 8}" y="${p.y + 10}" font-size="8" font-weight="700" fill="${FLOAT}" text-anchor="middle" visibility="hidden">?</text>`).join('')}`;

  const paint = (el: HTMLElement, pin: string, color: string) => el.querySelector(`.lead-${pin}`)?.setAttribute('stroke', color);
  const levelColor = (v: unknown) => (v === 1 ? HIGH : v === 0 ? LOW : FLOAT);

  const view: PartView = {
    create() {
      const el = document.createElement('div');
      el.innerHTML = `<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif">${body}</svg>`;
      return el;
    },
    update(el, st) {
      const powered = !!st.powered;
      const levels = Array.isArray(st.inputs) ? st.inputs : [];
      el.querySelector('svg')!.style.opacity = powered ? '' : '0.6';
      inputs.forEach((p, i) => {
        paint(el, p.name, powered ? levelColor(levels[i]) : LEAD);
        el.querySelector(`.float-${p.name}`)?.setAttribute('visibility', powered && levels[i] === null ? 'visible' : 'hidden');
      });
      paint(el, 'Y', powered && st.y !== null ? levelColor(st.y) : LEAD);
      el.title = st.hint ? `${label} gate: ${st.hint}` : '';
    },
    reset(el) {
      el.querySelector('svg')!.style.opacity = '';
      for (const p of pins) paint(el, p.name, LEAD);
      for (const p of inputs) el.querySelector(`.float-${p.name}`)?.setAttribute('visibility', 'hidden');
      el.title = '';
    },
    pins: () => pins,
  };
  return view;
}
