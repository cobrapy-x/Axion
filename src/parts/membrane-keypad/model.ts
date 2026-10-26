// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

const LABELS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];

interface KeyEvent {
  row?: number;
  column?: number;
  key?: string;
}

/**
 * Key matrix: each pressed key is a closed switch between its row pin and its column
 * pin. Several keys can be held at once (pressing two keys in one row also joins their
 * columns, exactly like the real membrane).
 */
const create: ModelFactory = (ctx) => {
  const columns = String(ctx.props.columns) === '3' ? 3 : 4;
  const pressed = new Set<number>(); // row * 4 + column

  const indexOf = (data: unknown): number => {
    const d = (data ?? {}) as KeyEvent;
    let row = Number(d.row);
    let column = Number(d.column);
    if (!(Number.isInteger(row) && Number.isInteger(column)) && typeof d.key === 'string') {
      const i = LABELS.indexOf(d.key.toUpperCase());
      row = Math.floor(i / 4);
      column = i % 4;
    }
    if (!(row >= 0 && row < 4 && column >= 0 && column < columns)) return -1;
    return row * 4 + column;
  };

  return {
    switches: () => [...pressed].map((i) => [`R${Math.floor(i / 4) + 1}`, `C${(i % 4) + 1}`] as [string, string]),
    input(event, data) {
      if (event === 'releaseAll') {
        if (!pressed.size) return;
        pressed.clear();
        ctx.invalidate(true);
        return;
      }
      const i = indexOf(data);
      if (i < 0) return;
      const had = pressed.has(i);
      if (event === 'press' && !had) pressed.add(i);
      else if (event === 'release' && had) pressed.delete(i);
      else return;
      ctx.invalidate(true); // connectivity changed
    },
    state: () => ({ pressed: [...pressed].sort((a, b) => a - b).map((i) => LABELS[i]) }),
  };
};

export default create;
