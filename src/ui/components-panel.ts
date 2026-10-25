// SPDX-License-Identifier: Apache-2.0
/**
 * The "Components" side panel: a filter dropdown (Basic / All / categories),
 * a search box and a grid or list of parts with live thumbnails.
 * Click a tile to add the part; drag it onto the canvas to place it.
 */
import { partUIs } from '../core/parts-views';
import { propsOf } from '../editor/workspace';
import { icon } from './icons';

export const DRAG_TYPE = 'application/x-axion-part';
const PREFS_KEY = 'axion.ui.components';

type View = 'grid' | 'list';

interface Thumb {
  /** Wrapper holding the rendered part at its natural size. */
  el: HTMLElement;
  w: number;
  h: number;
}

// ───────────────────────────── thumbnails ─────────────────────────────

const thumbs = new Map<string, Promise<Thumb | null>>();
let host: HTMLElement | null = null;

/** Off-screen container where thumbnails are laid out and measured. */
function thumbHost(): HTMLElement {
  if (!host) {
    host = document.createElement('div');
    host.className = 'thumb-host';
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    document.body.append(host);
  }
  return host;
}

/**
 * Render a part with its default props, purely for display: the view's
 * `attach` is never called, and the element is inert, so it takes no input.
 */
function thumbnail(type: string): Promise<Thumb | null> {
  let p = thumbs.get(type);
  if (!p) {
    p = (async () => {
      const ui = partUIs.get(type);
      if (!ui) return null;
      try {
        const wrap = document.createElement('div');
        wrap.className = 'thumb-part';
        const el = ui.view.create(propsOf({ type, id: `thumb-${type}`, top: 0, left: 0, attrs: {} }, ui));
        wrap.append(el);
        thumbHost().append(wrap);
        const lit = el as HTMLElement & { updateComplete?: Promise<unknown> };
        if (lit.updateComplete) await lit.updateComplete;
        const w = wrap.offsetWidth;
        const h = wrap.offsetHeight;
        return w && h ? { el: wrap, w, h } : null;
      } catch (err) {
        console.warn(`[axion] could not render a thumbnail for ${type}`, err);
        return null;
      }
    })();
    thumbs.set(type, p);
  }
  return p;
}

/** Put a part's thumbnail into `box`, scaled to fit (moves the cached element). */
async function fillThumb(box: HTMLElement, type: string, maxW: number, maxH: number): Promise<void> {
  const t = await thumbnail(type);
  if (!box.isConnected) return;
  if (!t) {
    box.textContent = partUIs.get(type)?.manifest.name.slice(0, 1) ?? '?';
    box.classList.add('fallback');
    return;
  }
  const s = Math.min(maxW / t.w, maxH / t.h, 1.6);
  t.el.style.transform = `translate(-50%, -50%) scale(${s.toFixed(3)})`;
  box.replaceChildren(t.el);
}

// ───────────────────────────── panel ─────────────────────────────

export interface ComponentsPanelOptions {
  /** Called when a tile is clicked (or activated with the keyboard). */
  add(type: string): void;
}

export class ComponentsPanel {
  private filter = 'basic';
  private view: View = 'grid';
  private query = '';
  private disabled = false;
  private list: HTMLElement;
  private select: HTMLSelectElement;
  private search: HTMLInputElement;
  private viewBtn: HTMLButtonElement;

  constructor(root: HTMLElement, private opts: ComponentsPanelOptions) {
    this.list = root.querySelector('.tiles')!;
    this.select = root.querySelector('select')!;
    this.search = root.querySelector('input[type="search"]')!;
    this.viewBtn = root.querySelector('.view-toggle')!;
    this.loadPrefs();

    // Filter options: Basic, All, then each category.
    const cats = [...new Set([...partUIs.values()].filter((u) => !u.manifest.hidden).map((u) => u.manifest.category))].sort();
    const opt = (value: string, label: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      return o;
    };
    this.select.append(opt('basic', 'Basic'), opt('all', 'All'));
    for (const c of cats) this.select.append(opt(`cat:${c}`, c));
    if (![...this.select.options].some((o) => o.value === this.filter)) this.filter = 'basic';
    this.select.value = this.filter;

    this.select.onchange = () => {
      this.filter = this.select.value;
      this.savePrefs();
      this.render();
    };
    this.search.oninput = () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    };
    this.search.onkeydown = (e) => {
      if (e.key === 'Escape' && this.search.value) {
        e.stopPropagation();
        this.search.value = '';
        this.query = '';
        this.render();
      }
    };
    this.viewBtn.onclick = () => {
      this.view = this.view === 'grid' ? 'list' : 'grid';
      this.savePrefs();
      this.render();
    };
    this.render();
  }

  setDisabled(on: boolean): void {
    if (on === this.disabled) return;
    this.disabled = on;
    this.list.classList.toggle('disabled', on);
    for (const t of this.list.querySelectorAll<HTMLElement>('.tile')) {
      t.setAttribute('aria-disabled', String(on));
      t.draggable = !on;
    }
  }

  private loadPrefs(): void {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { filter?: string; view?: View };
      if (p.filter) this.filter = p.filter;
      if (p.view === 'list' || p.view === 'grid') this.view = p.view;
    } catch {
      /* preferences are optional */
    }
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: this.filter, view: this.view }));
    } catch {
      /* preferences are optional */
    }
  }

  private matches(type: string, filter: string): boolean {
    const m = partUIs.get(type)!.manifest;
    if (m.hidden) return false;
    if (filter === 'basic' && !m.tags?.includes('basic')) return false;
    if (filter.startsWith('cat:') && m.category !== filter.slice(4)) return false;
    if (!this.query) return true;
    const hay = [m.name, m.type, m.description ?? '', m.category, ...(m.tags ?? [])].join(' ').toLowerCase();
    return this.query.split(/\s+/).every((w) => hay.includes(w));
  }

  private types(filter: string): string[] {
    return [...partUIs.keys()]
      .filter((t) => this.matches(t, filter))
      .sort((a, b) => {
        const ma = partUIs.get(a)!.manifest;
        const mb = partUIs.get(b)!.manifest;
        return ma.category.localeCompare(mb.category) || ma.name.localeCompare(mb.name);
      });
  }

  render(): void {
    const grid = this.view === 'grid';
    this.viewBtn.innerHTML = icon(grid ? 'list' : 'grid');
    const label = grid ? 'Show as list' : 'Show as grid';
    this.viewBtn.title = label;
    this.viewBtn.setAttribute('aria-label', label);
    this.list.className = `tiles ${this.view}${this.disabled ? ' disabled' : ''}`;
    this.list.setAttribute('role', 'list');

    const types = this.types(this.filter);
    const frag = document.createDocumentFragment();
    for (const type of types) frag.append(this.tile(type, grid));
    this.list.replaceChildren(frag);

    if (!types.length) {
      const empty = document.createElement('div');
      empty.className = 'tiles-empty';
      const p = document.createElement('p');
      p.textContent = this.query ? `No components match “${this.search.value.trim()}”.` : 'No components in this group yet.';
      empty.append(p);
      if (this.filter !== 'all' && this.types('all').length) {
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = 'Search all components';
        b.onclick = () => {
          this.filter = this.select.value = 'all';
          this.render();
        };
        empty.append(b);
      }
      this.list.append(empty);
    }
  }

  private tile(type: string, grid: boolean): HTMLElement {
    const m = partUIs.get(type)!.manifest;
    const t = document.createElement('div');
    t.className = 'tile';
    t.setAttribute('role', 'button');
    t.tabIndex = 0;
    t.draggable = !this.disabled;
    t.setAttribute('aria-disabled', String(this.disabled));
    t.dataset.type = type;
    t.title = `${m.name}${m.description ? ` – ${m.description}` : ''}\nClick to add, or drag onto the canvas`;
    t.setAttribute('aria-label', `Add ${m.name}`);

    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = m.name;
    t.append(thumb);
    if (grid) t.append(name);
    else {
      const text = document.createElement('span');
      text.className = 'tile-text';
      const desc = document.createElement('span');
      desc.className = 'tile-desc';
      desc.textContent = m.description ?? m.category;
      text.append(name, desc);
      t.append(text);
    }
    void fillThumb(thumb, type, grid ? 92 : 52, grid ? 64 : 40);

    const activate = () => {
      if (!this.disabled) this.opts.add(type);
    };
    t.onclick = activate;
    t.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    };
    t.ondragstart = (e) => {
      if (this.disabled || !e.dataTransfer) return e.preventDefault();
      e.dataTransfer.setData(DRAG_TYPE, type);
      e.dataTransfer.effectAllowed = 'copy';
      const img = thumb.firstElementChild as HTMLElement | null;
      if (img) e.dataTransfer.setDragImage(thumb, thumb.offsetWidth / 2, thumb.offsetHeight / 2);
    };
    return t;
  }
}
