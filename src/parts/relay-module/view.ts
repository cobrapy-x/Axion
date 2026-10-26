// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';

const NS = 'http://www.w3.org/2000/svg';
const W = 168;
const H = 86.4;
const HEADER = [
  { name: 'VCC', y: 33.6 },
  { name: 'GND', y: 43.2 },
  { name: 'IN', y: 52.8 },
];
const TERMINALS = [
  { name: 'NO', y: 24 },
  { name: 'COM', y: 43.2 },
  { name: 'NC', y: 62.4 },
];

/** Relay case top: a printed contact diagram whose blade follows the armature. */
const RX = 54;
const RW = 66;
const pivot = { x: RX + 20, y: 62 };
const bladeAngle = (closed: boolean) => (closed ? -21 : 21);

const header = HEADER.map(
  (p) => `
    <rect x="0" y="${p.y - 1.2}" width="9" height="2.4" fill="#d4af37"/>
    <text x="19" y="${p.y + 2.3}" font-size="6.5" fill="#e0ecff">${p.name}</text>`,
).join('');

const terminals = TERMINALS.map(
  (p) => `
    <rect x="${W - 22}" y="${p.y - 8.6}" width="22" height="17.2" fill="#1f6fd1" stroke="#0f3f80" stroke-width="0.8"/>
    <circle cx="${W - 11}" cy="${p.y}" r="5.8" fill="#d6dbe2" stroke="#6b7280" stroke-width="0.8"/>
    <line x1="${W - 15}" y1="${p.y - 2.4}" x2="${W - 7}" y2="${p.y + 2.4}" stroke="#4b5563" stroke-width="1.6"/>
    <text x="${W - 26}" y="${p.y + 2.3}" font-size="6.5" fill="#e0ecff" text-anchor="end">${p.name}</text>`,
).join('');

const svg = `
  <svg xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif">
    <rect x="5" y="2" width="${W - 7}" height="${H - 4}" rx="4" fill="#1d5fc4" stroke="#123f86" stroke-width="1"/>
    <circle cx="12" cy="9" r="3.2" fill="#123f86" stroke="#c9d6ea" stroke-width="1"/>
    <circle cx="12" cy="${H - 9}" r="3.2" fill="#123f86" stroke="#c9d6ea" stroke-width="1"/>
    <rect x="6" y="26" width="10" height="34" rx="1" fill="#111827"/>
    ${header}
    <!-- driver: base resistor and transistor -->
    <rect x="21" y="11" width="11" height="4.4" rx="1" fill="#1f2937"/><rect x="20" y="11.6" width="2" height="3.2" fill="#cbd5e1"/><rect x="31" y="11.6" width="2" height="3.2" fill="#cbd5e1"/>
    <rect x="21" y="68" width="8" height="5" rx="0.8" fill="#111827"/><rect x="22" y="73" width="1.4" height="2.4" fill="#cbd5e1"/><rect x="26.2" y="73" width="1.4" height="2.4" fill="#cbd5e1"/><rect x="24.1" y="65.6" width="1.4" height="2.4" fill="#cbd5e1"/>
    <!-- LEDs -->
    <circle class="pwr-led" cx="44" cy="18" r="3.2" fill="#5b1a1a" stroke="#0f2f63" stroke-width="0.8"/>
    <circle class="on-led" cx="44" cy="64" r="3.2" fill="#163b23" stroke="#0f2f63" stroke-width="0.8"/>
    <text x="44" y="27" font-size="4.8" fill="#c9d6ea" text-anchor="middle">PWR</text>
    <text x="44" y="73" font-size="4.8" fill="#c9d6ea" text-anchor="middle">ON</text>
    <!-- relay -->
    <g class="relay">
      <rect x="${RX}" y="7" width="${RW}" height="72" rx="2.5" fill="#2f7fe0" stroke="#1557ad" stroke-width="1"/>
      <rect x="${RX + 3}" y="10" width="${RW - 6}" height="66" rx="1.5" fill="none" stroke="#5b9cf0" stroke-width="0.6"/>
      <text x="${RX + RW / 2}" y="21" font-size="7" font-weight="700" fill="#eaf2ff" text-anchor="middle">RELAY</text>
      <text x="${RX + RW / 2}" y="30" font-size="5.3" fill="#d7e6ff" text-anchor="middle">05VDC-SL-C</text>
      <text x="${RX + RW / 2}" y="38" font-size="4.4" fill="#cfe0fb" text-anchor="middle">10A 250VAC 10A 30VDC</text>
      <!-- printed contact diagram -->
      <g stroke="#eaf2ff" stroke-width="1" fill="none" stroke-linecap="round">
        <line x1="${pivot.x}" y1="${pivot.y}" x2="${pivot.x}" y2="${pivot.y + 8}"/>
        <line x1="${pivot.x + 22}" y1="${pivot.y - 9}" x2="${pivot.x + 30}" y2="${pivot.y - 9}"/>
        <line x1="${pivot.x + 22}" y1="${pivot.y + 9}" x2="${pivot.x + 30}" y2="${pivot.y + 9}"/>
        <line class="blade" x1="${pivot.x}" y1="${pivot.y}" x2="${pivot.x + 23}" y2="${pivot.y}" transform="rotate(${bladeAngle(false)} ${pivot.x} ${pivot.y})" stroke-width="1.4"/>
      </g>
      <circle cx="${pivot.x}" cy="${pivot.y}" r="1.6" fill="#eaf2ff"/>
      <text x="${pivot.x + 33}" y="${pivot.y - 7}" font-size="4.6" fill="#eaf2ff">NO</text>
      <text x="${pivot.x + 33}" y="${pivot.y + 11}" font-size="4.6" fill="#eaf2ff">NC</text>
      <text x="${pivot.x - 3}" y="${pivot.y + 13}" font-size="4.6" fill="#eaf2ff" text-anchor="end">COM</text>
    </g>
    <text class="click" x="${RX + RW / 2}" y="51" font-size="8" font-weight="800" fill="#fef08a" text-anchor="middle" opacity="0">click</text>
    ${terminals}
  </svg>`;

const view: PartView = {
  create() {
    const el = document.createElement('div');
    el.innerHTML = svg;
    return el;
  },
  update(el, s) {
    el.querySelector('.pwr-led')!.setAttribute('fill', s.powered ? '#ff3b30' : '#5b1a1a');
    el.querySelector('.on-led')!.setAttribute('fill', s.coil ? '#34f07a' : '#163b23');
    el.querySelector('.blade')!.setAttribute('transform', `rotate(${bladeAngle(!!s.closed)} ${pivot.x} ${pivot.y})`);
    const clicks = Number(s.clicks) || 0;
    if (el.dataset.clicks !== undefined && Number(el.dataset.clicks) !== clicks) {
      // The armature just moved: a tiny shake and a "click" that fades out.
      el.querySelector('.relay')?.animate?.(
        [{ transform: 'translate(0,0)' }, { transform: 'translate(0.8px,-0.6px)' }, { transform: 'translate(-0.6px,0.5px)' }, { transform: 'translate(0,0)' }],
        { duration: 90 },
      );
      el.querySelector('.click')?.animate?.(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-10px)' },
        ],
        { duration: 450, easing: 'ease-out' },
      );
    }
    el.dataset.clicks = String(clicks);
  },
  reset(el) {
    el.querySelector('.pwr-led')!.setAttribute('fill', '#5b1a1a');
    el.querySelector('.on-led')!.setAttribute('fill', '#163b23');
    el.querySelector('.blade')!.setAttribute('transform', `rotate(${bladeAngle(false)} ${pivot.x} ${pivot.y})`);
    delete el.dataset.clicks;
  },
  pins: () => [...HEADER.map((p) => ({ name: p.name, x: 0, y: p.y })), ...TERMINALS.map((p) => ({ name: p.name, x: W, y: p.y }))],
};

export default view;
