// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/slide-potentiometer-element.js';
import type { PartView } from '../../core/types';

type SlideElement = HTMLElement & { value: number; travelLength: number };

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-slide-potentiometer') as SlideElement;
    if (Number(props.travelLength) > 0) el.travelLength = Number(props.travelLength);
    el.value = Number(props.value) || 0;
    return el;
  },
  setProps(el, props) {
    (el as SlideElement).value = Number(props.value) || 0;
  },
  attach(el, send) {
    el.addEventListener('input', () => send('value', (el as SlideElement).value));
  },
};

export default view;
