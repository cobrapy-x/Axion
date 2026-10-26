// SPDX-License-Identifier: Apache-2.0
import '@wokwi/elements/dist/esm/membrane-keypad-element.js';
import type { PartView, Props } from '../../core/types';

interface KeyInfo {
  key: string;
  row: number;
  column: number;
}
type KeypadElement = HTMLElement & {
  columns: string;
  connector: boolean;
  pressedKeys: Set<string>;
  down(key: string, element?: Element): void;
  up(key: string, element?: Element): void;
};

const columnsOf = (props: Props) => (String(props.columns) === '3' ? '3' : '4');

/** The key group (`<g data-key-name>`) under a pointer event, if any. */
function keyTarget(e: Event): SVGGElement | null {
  for (const t of e.composedPath()) {
    if (t instanceof Element && t.hasAttribute('data-key-name')) return t as SVGGElement;
  }
  return null;
}

function keyGroups(el: HTMLElement): Element[] {
  return [...(el.shadowRoot?.querySelectorAll('[data-key-name]') ?? [])];
}

const view: PartView = {
  create(props) {
    const el = document.createElement('wokwi-membrane-keypad') as KeypadElement;
    el.connector = true; // the header pins (R1…C4) sit on the connector tail
    view.setProps!(el, props);
    return el;
  },
  setProps(el, props) {
    (el as KeypadElement).columns = columnsOf(props);
  },
  update(el, s) {
    // Show every key the model holds down (also latched ones) as pressed.
    const held = new Set(Array.isArray(s.pressed) ? s.pressed.map(String) : []);
    for (const g of keyGroups(el)) g.classList.toggle('pressed', held.has(g.getAttribute('data-key-name') ?? ''));
  },
  reset(el) {
    const kp = el as KeypadElement;
    for (const key of [...(kp.pressedKeys ?? [])]) kp.up(key);
    for (const g of keyGroups(el)) g.classList.remove('pressed');
  },
  attach(el, send) {
    const kp = el as KeypadElement;
    const info = (e: Event) => (e as CustomEvent<KeyInfo>).detail;
    el.addEventListener('button-press', (e) => send('press', info(e)));
    el.addEventListener('button-release', (e) => send('release', info(e)));
    // Ctrl/Cmd+click latches a key (click again to let go), so several keys can be held.
    el.addEventListener(
      'mousedown',
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const g = keyTarget(e);
        const key = g?.getAttribute('data-key-name');
        if (!g || !key) return;
        e.preventDefault(); // keep focus where it is: a blur would release the key
        e.stopPropagation();
        if (kp.pressedKeys.has(key)) kp.up(key, g);
        else kp.down(key, g);
      },
      true,
    );
    el.addEventListener(
      'mouseup',
      (e) => {
        if ((e.ctrlKey || e.metaKey) && keyTarget(e)) e.stopPropagation();
      },
      true,
    );
  },
};

export default view;
