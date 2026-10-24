// SPDX-License-Identifier: Apache-2.0
/** View shared by Arduino boards drawn with wokwi-elements (Uno, Nano, Mega). */
import type { PartView } from '../core/types';

type BoardElement = HTMLElement & { led13: boolean; ledTX: boolean; ledRX: boolean; ledPower: boolean };

export function boardView(tag: string): PartView {
  return {
    create: () => document.createElement(tag),
    update(el, s) {
      const b = el as BoardElement;
      b.ledPower = !!s.ledPower;
      b.led13 = !!s.led13;
      b.ledTX = !!s.ledTX;
      b.ledRX = !!s.ledRX;
    },
    reset(el) {
      Object.assign(el as BoardElement, { led13: false, ledTX: false, ledRX: false, ledPower: false });
    },
  };
}
