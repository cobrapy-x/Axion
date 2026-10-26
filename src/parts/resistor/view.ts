// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/resistor-element.js';
import { parseValue } from '../../core/analog/units';
import type { PartView } from '../../core/types';

type ResistorElement = HTMLElement & { value: string };

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-resistor') as ResistorElement;
    el.value = String(parseValue(props.value, 220)); // the colour bands need plain ohms
    return el;
  },
  setProps(el, props) {
    (el as ResistorElement).value = String(parseValue(props.value, 220));
  },
};

export default view;
