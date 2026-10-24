// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/potentiometer-element.js';
import type { PartView } from '../../core/types';

type PotElement = HTMLElement & { value: number };

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-potentiometer') as PotElement;
    el.value = Number(props.value) || 0;
    return el;
  },
  setProps(el, props) {
    (el as PotElement).value = Number(props.value) || 0;
  },
  attach(el, send) {
    el.addEventListener('input', () => send('value', (el as PotElement).value));
  },
};

export default view;
