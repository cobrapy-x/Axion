// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/servo-element.js';
import type { PartView } from '../../core/types';

type ServoElement = HTMLElement & { angle: number };

const view: PartView = {
  create: () => {
    const el = document.createElement('wokwi-servo') as ServoElement;
    el.angle = 90;
    return el;
  },
  update(el, s) {
    const a = Number(s.angle);
    if ((el as ServoElement).angle !== a) (el as ServoElement).angle = a;
  },
  reset(el) {
    (el as ServoElement).angle = 90;
  },
};

export default view;
