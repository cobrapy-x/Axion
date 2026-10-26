// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/hc-sr04-element.js';
import type { PartView, PinPosition, Props } from '../../core/types';

const NS = 'http://www.w3.org/2000/svg';
const MM = 3.7795; // px per mm (CSS)
const BOARD_W = 45 * MM;
const BOARD_H = 25 * MM;
/** Room above the board for the distance read-out and the sound waves. */
const TOP = 30;
const LEFT_CX = 8.98 * MM;
const RIGHT_CX = (8.98 + 27.12) * MM;

const arcs = (cx: number, cls: string) =>
  [0, 1, 2]
    .map((i) => {
      const y = TOP - 2 - i * 8;
      const hw = 9 + i * 3.5;
      return `<path class="${cls} ${cls}-${i}" d="M${cx - hw} ${y} Q${cx} ${y - 7} ${cx + hw} ${y}" fill="none" stroke="var(--accent,#0d9488)" stroke-width="1.6" stroke-linecap="round" opacity="0"/>`;
    })
    .join('');

type SonarElement = HTMLElement & { pinInfo: PinPosition[] };

const label = (el: HTMLElement, cm: number) => {
  const t = el.querySelector('.dist-text');
  const txt = `${Math.round(cm)} cm`;
  if (t && t.textContent !== txt) t.textContent = txt;
};

const view: PartView = {
  create(props) {
    const el = document.createElement('div');
    el.style.cssText = `position:relative;width:${BOARD_W}px;height:${BOARD_H + TOP}px`;
    el.innerHTML = `
      <svg xmlns="${NS}" width="${BOARD_W}" height="${TOP}" viewBox="0 0 ${BOARD_W} ${TOP}" style="position:absolute;left:0;top:0;overflow:visible" font-family="system-ui,sans-serif">
        <rect x="${BOARD_W / 2 - 27}" y="3" width="54" height="17" rx="8.5" style="fill:var(--panel,#fff);stroke:var(--border-strong,#cfd4da)" stroke-width="1"/>
        <path d="M${BOARD_W / 2 - 19} 8 v7 M${BOARD_W / 2 - 21.5} 10 l2.5 -2.5 l2.5 2.5 M${BOARD_W / 2 - 21.5} 13 l2.5 2.5 l2.5 -2.5" fill="none" style="stroke:var(--muted,#6b7280)" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
        <text class="dist-text" x="${BOARD_W / 2 + 4}" y="15.2" font-size="10" font-weight="600" text-anchor="middle" style="fill:var(--text,#1f2328)"></text>
        ${arcs(LEFT_CX, 'ping')}${arcs(RIGHT_CX, 'pong')}
      </svg>`;
    const sensor = document.createElement('wokwi-hc-sr04');
    sensor.style.cssText = `position:absolute;left:0;top:${TOP}px;display:block`;
    el.append(sensor);
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props: Props) {
    el.dataset.distance = String(props.distance);
    label(el, Number(props.distance) || 0);
  },
  update(el, s) {
    label(el, Number(s.distance) || 0);
    const pings = Number(s.pings) || 0;
    const last = Number(el.dataset.pings ?? pings);
    el.dataset.pings = String(pings);
    const now = performance.now();
    // One wave animation at a time, even if the sketch pings every few ms.
    if (pings === last || now - Number(el.dataset.waveAt ?? 0) < 520) return;
    el.dataset.waveAt = String(now);
    const flash = (sel: string, delay: number) =>
      el.querySelector(sel)?.animate?.([{ opacity: 0 }, { opacity: 0.95 }, { opacity: 0 }], { duration: 260, delay, easing: 'ease-out' });
    for (let i = 0; i < 3; i++) flash(`.ping-${i}`, i * 70); // outgoing burst
    for (let i = 0; i < 3; i++) flash(`.pong-${2 - i}`, 230 + i * 70); // returning echo
  },
  reset(el) {
    delete el.dataset.pings;
    label(el, Number(el.dataset.distance) || 0);
  },
  pins(el) {
    const sensor = el.querySelector('wokwi-hc-sr04') as SonarElement | null;
    return (sensor?.pinInfo ?? []).map((p) => ({ name: p.name, x: p.x, y: p.y + TOP }));
  },
};

export default view;
