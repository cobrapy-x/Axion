// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/rgb-led-element.js';
import type { PartView } from '../../core/types';

type RgbElement = HTMLElement & { ledRed: number; ledGreen: number; ledBlue: number };

// Perceived brightness is not linear; a square root makes low PWM visible.
const level = (v: unknown) => Math.sqrt(Math.min(1, Math.max(0, Number(v) || 0)));

const view: PartView = {
  create: () => document.createElement('wokwi-rgb-led'),
  update(el, s) {
    const led = el as RgbElement;
    const [r, g, b] = [level(s.r), level(s.g), level(s.b)];
    if (led.ledRed !== r) led.ledRed = r;
    if (led.ledGreen !== g) led.ledGreen = g;
    if (led.ledBlue !== b) led.ledBlue = b;
  },
  reset(el) {
    const led = el as RgbElement;
    led.ledRed = led.ledGreen = led.ledBlue = 0;
  },
};

export default view;
