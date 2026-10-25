// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/slide-switch-element.js';
import type { PartView, Props } from '../../core/types';

type SwitchElement = HTMLElement & { value: number };

const startValue = (props: Props) => (Number(props.value) === 1 ? 1 : 0);

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-slide-switch') as SwitchElement;
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    const v = startValue(props);
    el.dataset.start = String(v); // restored when the simulation stops
    (el as SwitchElement).value = v;
  },
  update(el, s) {
    const v = Number(s.value) === 1 ? 1 : 0;
    if ((el as SwitchElement).value !== v) (el as SwitchElement).value = v;
  },
  reset(el) {
    (el as SwitchElement).value = Number(el.dataset.start) === 1 ? 1 : 0;
  },
  attach(el, send) {
    // Dragging the part in the editor should not flip it: swallow the click
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
    el.addEventListener('input', () => send('value', (el as SwitchElement).value ? 1 : 0));
  },
};

export default view;
