// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/arduino-uno-element.js';
import type { PartView } from '../../core/types';

type UnoElement = HTMLElement & { led13: boolean; ledTX: boolean; ledRX: boolean; ledPower: boolean };

const view: PartView = {
  create: () => document.createElement('wokwi-arduino-uno'),
  update(el, s) {
    const uno = el as UnoElement;
    uno.ledPower = !!s.ledPower;
    uno.led13 = !!s.led13;
    uno.ledTX = !!s.ledTX;
    uno.ledRX = !!s.ledRX;
  },
  reset(el) {
    Object.assign(el as UnoElement, { led13: false, ledTX: false, ledRX: false, ledPower: false });
  },
};

export default view;
