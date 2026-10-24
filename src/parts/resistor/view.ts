// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/resistor-element.js';
import type { PartView } from '../../core/types';

type ResistorElement = HTMLElement & { value: string };

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-resistor') as ResistorElement;
    el.value = String(props.value ?? 220);
    return el;
  },
  setProps(el, props) {
    (el as ResistorElement).value = String(props.value ?? 220);
  },
};

export default view;
