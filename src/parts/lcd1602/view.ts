// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/lcd1602-element.js';
import { fontA00 } from '@wokwi/elements/dist/esm/lcd1602-font-a00.js';
import { fontA02 } from '@wokwi/elements/dist/esm/lcd1602-font-a02.js';
import type { PartView, Props } from '../../core/types';
import { cgramGlyphs } from './hd44780';

type LcdElement = HTMLElement & {
  pins: 'full' | 'i2c' | 'none';
  characters: Uint8Array;
  font: Uint8Array;
  background: string;
  color: string;
  backlight: boolean;
  cursor: boolean;
  blink: boolean;
  cursorX: number;
  cursorY: number;
  /** Our cache keys, so unchanged frames don't re-render the element. */
  _chars?: string;
  _cgram?: string;
  _base?: Uint8Array;
};

const BLANK = () => new Uint8Array(32).fill(0x20);

/** Base font with the 8 CGRAM characters at codes 0-7 (mirrored at 8-15). */
function fontWith(base: Uint8Array, cgram: number[]): Uint8Array {
  const font = new Uint8Array(base);
  const glyphs = cgramGlyphs(cgram);
  for (let code = 0; code < 16; code++) font.set(glyphs.slice((code & 7) * 8, (code & 7) * 8 + 8), code * 8);
  return font;
}

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-lcd1602') as LcdElement;
    el.characters = BLANK();
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props: Props) {
    const lcd = el as LcdElement;
    lcd.pins = props.pins === 'i2c' ? 'i2c' : 'full';
    lcd.background = props.background === 'blue' ? 'blue' : 'green';
    lcd.color = props.color === 'white' ? 'white' : 'black';
    lcd._base = props.variant === 'A02' ? fontA02 : fontA00;
    lcd.font = lcd._base;
    lcd._cgram = undefined;
  },
  update(el, s) {
    const lcd = el as LcdElement;
    const chars = Array.isArray(s.chars) && s.chars.length ? (s.chars as number[]) : null;
    const key = chars ? chars.join(',') : '';
    if (key !== lcd._chars) {
      lcd._chars = key;
      lcd.characters = chars ? Uint8Array.from(chars) : BLANK();
    }
    const cgram = Array.isArray(s.cgram) ? (s.cgram as number[]) : [];
    const cgKey = cgram.join(',');
    if (cgKey !== lcd._cgram) {
      lcd._cgram = cgKey;
      lcd.font = cgram.length === 64 ? fontWith(lcd._base ?? fontA00, cgram) : (lcd._base ?? fontA00);
    }
    const backlight = !!s.backlight;
    if (lcd.backlight !== backlight) lcd.backlight = backlight;
    const cursor = !!s.cursor;
    const blink = !!s.blink;
    if (lcd.cursor !== cursor) lcd.cursor = cursor;
    if (lcd.blink !== blink) lcd.blink = blink;
    const cx = Number(s.cx ?? -1);
    const cy = Number(s.cy ?? -1);
    if (lcd.cursorX !== cx) lcd.cursorX = cx;
    if (lcd.cursorY !== cy) lcd.cursorY = cy;
  },
  reset(el) {
    const lcd = el as LcdElement;
    lcd.characters = BLANK();
    lcd._chars = undefined;
    lcd.font = lcd._base ?? fontA00;
    lcd._cgram = undefined;
    lcd.cursor = false;
    lcd.blink = false;
    lcd.backlight = true;
  },
};

export default view;
