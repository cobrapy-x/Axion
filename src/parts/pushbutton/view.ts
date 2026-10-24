// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/pushbutton-element.js';
import type { PartView } from '../../core/types';

type ButtonElement = HTMLElement & { color: string; pressed: boolean };

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-pushbutton') as ButtonElement;
    el.color = String(props.color ?? 'red');
    return el;
  },
  setProps(el, props) {
    (el as ButtonElement).color = String(props.color ?? 'red');
  },
  attach(el, send) {
    el.addEventListener('button-press', () => send('press'));
    el.addEventListener('button-release', () => send('release'));
  },
};

export default view;
