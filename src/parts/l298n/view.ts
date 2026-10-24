// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';
import { svgRoot, terminal } from '../../physics/motor-view';

const W = 150;
const H = 150;
const HEADER = ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'];
const POWER = ['12V', 'GND', '5V'];
const headerX = (i: number) => 74 + i * 12;
const powerX = (i: number) => 18 + i * 16;

const screw = (x: number, y: number) =>
  `<rect x="${x}" y="${y - 8}" width="16" height="16" fill="#1d4ed8" stroke="#1e3a8a"/><circle cx="${x + 8}" cy="${y}" r="4.5" fill="#cbd5e1" stroke="#64748b"/><line x1="${x + 5}" y1="${y}" x2="${x + 11}" y2="${y}" stroke="#475569" stroke-width="1.4"/>`;

const fins = Array.from({ length: 9 }, (_, i) => `<rect x="${44 + i * 7}" y="8" width="4" height="46" fill="#111827"/>`).join('');

const view: PartView = {
  create: () =>
    svgRoot(
      W,
      H,
      `
      <rect x="0" y="0" width="${W}" height="${H - 8}" rx="6" fill="#b91c1c" stroke="#7f1d1d"/>
      <rect x="40" y="4" width="70" height="54" rx="3" fill="#1f2937"/>
      ${fins}
      <rect x="52" y="62" width="46" height="18" rx="2" fill="#111" />
      <text x="75" y="74" font-size="8" fill="#e5e7eb" text-anchor="middle">L298N</text>
      ${screw(0, 36)}${screw(0, 56)}
      ${screw(W - 16, 36)}${screw(W - 16, 56)}
      <text x="20" y="40" font-size="7" fill="#fee2e2">OUT1</text>
      <text x="20" y="60" font-size="7" fill="#fee2e2">OUT2</text>
      <text x="${W - 20}" y="40" font-size="7" fill="#fee2e2" text-anchor="end">OUT3</text>
      <text x="${W - 20}" y="60" font-size="7" fill="#fee2e2" text-anchor="end">OUT4</text>
      <circle class="pwr" cx="20" cy="94" r="3.5" fill="#450a0a"/>
      <text x="28" y="97" font-size="7" fill="#fee2e2">PWR</text>
      ${POWER.map((p, i) => terminal(powerX(i), H, p)).join('')}
      ${HEADER.map((p, i) => terminal(headerX(i), H, p)).join('')}`,
    ),
  update(el, s) {
    el.querySelector('.pwr')!.setAttribute('fill', s.powered ? '#ef4444' : '#450a0a');
  },
  reset(el) {
    el.querySelector('.pwr')!.setAttribute('fill', '#450a0a');
  },
  pins: () => [
    { name: 'OUT1', x: 0, y: 36 },
    { name: 'OUT2', x: 0, y: 56 },
    { name: 'OUT3', x: W, y: 36 },
    { name: 'OUT4', x: W, y: 56 },
    ...POWER.map((name, i) => ({ name, x: powerX(i), y: H })),
    ...HEADER.map((name, i) => ({ name, x: headerX(i), y: H })),
  ],
};

export default view;
