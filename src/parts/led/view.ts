// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/led-element.js';
import type { PartView } from '../../core/types';

type LedElement = HTMLElement & { value: boolean; brightness: number; color: string };

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-led') as LedElement;
    el.color = String(props.color ?? 'red');
    return el;
  },
  setProps(el, props) {
    (el as LedElement).color = String(props.color ?? 'red');
  },
  update(el, s) {
    const led = el as LedElement;
    const b = Number(s.brightness) || 0;
    led.value = b > 0.01;
    // Perceived brightness is not linear; a square root makes low PWM visible.
    led.brightness = Math.sqrt(b);
  },
  reset(el) {
    (el as LedElement).value = false;
  },
};

export default view;
