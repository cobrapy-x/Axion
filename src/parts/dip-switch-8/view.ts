// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/dip-switch-8-element.js';
import type { PartView } from '../../core/types';

type DipElement = HTMLElement & { values: number[] };

const toValues = (v: unknown): number[] => {
  const s = String(v ?? '');
  return Array.from({ length: 8 }, (_, i) => (s[i] === '1' ? 1 : 0));
};
const toText = (values: number[]) => values.map((v) => (v ? '1' : '0')).join('');

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-dip-switch-8') as DipElement;
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    const values = toValues(props.value);
    el.dataset.start = toText(values); // restored when the simulation stops
    (el as DipElement).values = values; // a fresh array: the element toggles it in place
  },
  update(el, s) {
    const dip = el as DipElement;
    if (typeof s.value === 'string' && s.value !== toText(dip.values)) dip.values = toValues(s.value);
  },
  reset(el) {
    (el as DipElement).values = toValues(el.dataset.start);
  },
  attach(el, send) {
    // Dragging the part in the editor should not flip a switch: swallow that click
    // (in the capture phase, before the element's own handler sees it).
    let downX = 0;
    let downY = 0;
    el.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    el.addEventListener(
      'click',
      (e) => {
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) e.stopPropagation();
      },
      true,
    );
    // Sent as one 'value' string: while stopped it becomes the saved start positions.
    el.addEventListener('switch-change', () => send('value', toText((el as DipElement).values)));
  },
};

export default view;
