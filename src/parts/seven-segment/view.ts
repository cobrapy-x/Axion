// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/7segment-element.js';
import type { PartView, Props } from '../../core/types';

type SevenSegElement = HTMLElement & {
  values: number[];
  digits: number;
  color: string;
  colon: boolean;
  colonValue: boolean;
};

/** A segment counts as lit above this duty, so a 4-digit multiplexed display stays visible. */
const ON = 0.05;

const digitsOf = (props: Props) => Math.min(4, Math.max(1, Math.round(Number(props.digits)) || 1));

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-7segment') as SevenSegElement;
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    const seg = el as SevenSegElement;
    const digits = digitsOf(props);
    seg.digits = digits;
    seg.colon = digits === 4;
    seg.color = String(props.color ?? 'red');
    seg.values = new Array(digits * 8).fill(0);
  },
  update(el, s) {
    const seg = el as SevenSegElement;
    const values = (Array.isArray(s.values) ? s.values : []).map((v) => (Number(v) > ON ? 1 : 0));
    if (values.join() !== seg.values.join()) seg.values = values;
    const colon = Number(s.colon) > ON;
    if (seg.colonValue !== colon) seg.colonValue = colon;
  },
  reset(el) {
    const seg = el as SevenSegElement;
    seg.values = new Array(seg.digits * 8).fill(0);
    seg.colonValue = false;
  },
};

export default view;
