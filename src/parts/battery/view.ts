// SPDX-License-Identifier: Apache-2.0
import type { PartView } from '../../core/types';

const W = 64;
const H = 104;

const view: PartView = {
  create(props) {
    const el = document.createElement('div');
    el.innerHTML = `
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <rect x="14" y="0" width="12" height="8" rx="2" fill="#c9cdd2" stroke="#7a8087"/>
        <rect x="38" y="0" width="12" height="8" rx="2" fill="#c9cdd2" stroke="#7a8087"/>
        <rect x="4" y="6" width="56" height="96" rx="5" fill="#1f2937"/>
        <rect x="4" y="6" width="56" height="30" rx="5" fill="#2563eb"/>
        <rect x="4" y="30" width="56" height="6" fill="#2563eb"/>
        <text x="20" y="25" fill="#fff" font-family="system-ui,sans-serif" font-size="13" font-weight="700" text-anchor="middle">+</text>
        <text x="44" y="25" fill="#fff" font-family="system-ui,sans-serif" font-size="13" font-weight="700" text-anchor="middle">−</text>
        <text class="volts" x="32" y="70" fill="#f9fafb" font-family="system-ui,sans-serif" font-size="16" font-weight="700" text-anchor="middle"></text>
        <text x="32" y="88" fill="#9ca3af" font-family="system-ui,sans-serif" font-size="9" text-anchor="middle">BATTERY</text>
      </svg>`;
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    el.querySelector('.volts')!.textContent = `${Number(props.voltage) || 0} V`;
  },
  pins: () => [
    { name: '+', x: 20, y: 0 },
    { name: '-', x: 44, y: 0 },
  ],
};

export default view;
