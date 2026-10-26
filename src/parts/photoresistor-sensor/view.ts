// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/photoresistor-sensor-element.js';
import type { PartView } from '../../core/types';

type ModuleElement = HTMLElement & { ledPower: boolean; ledDO: boolean };

const view: PartView = {
  create: () => document.createElement('wokwi-photoresistor-sensor'),
  update(el, s) {
    const m = el as ModuleElement;
    m.ledPower = !!s.power;
    m.ledDO = !!s.bright; // the DO LED is on while DO is LOW (light detected)
  },
  reset(el) {
    const m = el as ModuleElement;
    m.ledPower = false;
    m.ledDO = false;
  },
};

export default view;
