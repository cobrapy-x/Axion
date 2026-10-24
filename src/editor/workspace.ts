// SPDX-License-Identifier: Apache-2.0
/**
 * The circuit canvas: places parts, draws wires, handles pan / zoom / drag /
 * rotate / delete, and forwards part interactions (button presses…) to the
 * simulation while it runs.
 *
 * Coordinates: "world" units are CSS pixels at zoom 1, identical to the
 * `top` / `left` values stored in diagram.json.
 */
import type { Diagram, DiagramConnection, DiagramPart, Point } from '../core/diagram';
import { pointsToRoute, routeToPoints, splitEndpoint } from '../core/diagram';
import { partUIs, pinsOf, type PartUI } from '../core/parts-views';
import type { PinPosition, Props } from '../core/types';

export type Selection = { kind: 'part'; id: string } | { kind: 'wire'; index: number } | null;

export interface WorkspaceEvents {
  /** The diagram was edited (persist it). */
  change(): void;
  /** Selection changed (update the inspector). */
  select(sel: Selection): void;
  /** A part was interacted with while the simulation runs. */
  input(partId: string, event: string, data?: unknown): void;
}

interface PartNode {
  part: DiagramPart;
  ui?: PartUI;
  wrap: HTMLDivElement;
  el: HTMLElement;
  pins: PinPosition[];
  w: number;
  h: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HINT_IDLE = 'Drag parts in from the left · click a pin to start a wire · R rotate · Del delete · scroll to zoom · drag background to pan';
const HINT_DRAW = 'Click empty space to add a bend · click another pin to finish · Esc to cancel';
const HINT_RUN = 'Simulation running: press buttons and turn knobs to interact. Stop to edit the circuit.';

export function propsOf(part: DiagramPart, ui?: PartUI): Props {
  const props: Props = {};
  for (const [k, spec] of Object.entries(ui?.manifest.props ?? {})) props[k] = spec.default;
  for (const [k, v] of Object.entries(part.attrs ?? {})) {
    const spec = ui?.manifest.props?.[k];
    props[k] = spec?.type === 'number' ? Number(v) : spec?.type === 'boolean' ? v === 'true' : v;
  }
  return props;
}

function defaultWireColor(a: string, b: string): string {
  const pins = [splitEndpoint(a).pin, splitEndpoint(b).pin].map((p) => p.toUpperCase());
  if (pins.some((p) => p.startsWith('GND'))) return 'black';
  if (pins.some((p) => ['5V', '3.3V', 'VCC', 'VIN'].includes(p))) return 'red';
  return 'green';
}

export class Workspace {
  diagram: Diagram = { version: 1, parts: [], connections: [] };
  selection: Selection = null;
  running = false;

  private world: HTMLDivElement;
  private partsLayer: HTMLDivElement;
  private svg: SVGSVGElement;
  private pinsLayer: HTMLDivElement;
  private hint: HTMLElement | null;
  private nodes = new Map<string, PartNode>();
  private view = { x: 40, y: 40, z: 1 };
  private drawing: null | { from: string; fromPos: Point; points: Point[]; cursor: Point } = null;
  private drag: null | { node: PartNode; sx: number; sy: number; left: number; top: number; moved: boolean } = null;
  private pan: null | { sx: number; sy: number; x: number; y: number; moved: boolean } = null;

  constructor(private root: HTMLElement, private ev: WorkspaceEvents) {
    this.world = document.createElement('div');
    this.world.className = 'world';
    this.partsLayer = document.createElement('div');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('wires');
    this.pinsLayer = document.createElement('div');
    this.world.append(this.partsLayer, this.svg, this.pinsLayer);
    root.prepend(this.world);
    this.hint = root.querySelector('#hint');
    this.bindEvents();
    this.applyView();
    this.updateHint();
  }

  // ───────────────────────────── public API ─────────────────────────────

  async load(diagram: Diagram, fit = true): Promise<void> {
    this.diagram = diagram;
    this.cancelDrawing();
    this.nodes.clear();
    this.partsLayer.replaceChildren();
    const nodes = diagram.parts.map((p) => this.createNode(p));
    await Promise.all(nodes.map((n) => this.measure(n)));
    this.select(null);
    this.render();
    if (fit) this.fit();
  }

  async addPart(type: string, at?: Point): Promise<string> {
    const ui = partUIs.get(type);
    const prefix = ui?.manifest.idPrefix ?? type.replace(/^wokwi-/, '');
    let n = 1;
    while (this.diagram.parts.some((p) => p.id === `${prefix}${n}`)) n++;
    const center = at ?? this.toWorldFromRoot(this.root.clientWidth / 2, this.root.clientHeight / 2);
    const part: DiagramPart = { type, id: `${prefix}${n}`, top: center.y, left: center.x, rotate: 0, attrs: {} };
    this.diagram.parts.push(part);
    const node = this.createNode(part);
    await this.measure(node);
    part.left = Math.round(center.x - node.w / 2);
    part.top = Math.round(center.y - node.h / 2);
    if (!at) {
      // Clicked in the palette: cascade so repeated adds don't stack exactly on top of each other.
      const taken = (x: number, y: number) =>
        this.diagram.parts.some((p) => p !== part && Math.abs(p.left - x) < 20 && Math.abs(p.top - y) < 20);
      while (taken(part.left, part.top)) {
        part.left += 30;
        part.top += 30;
      }
    }
    this.placeNode(node);
    this.render();
    this.select({ kind: 'part', id: part.id });
    this.ev.change();
    return part.id;
  }

  deleteSelection(): void {
    const sel = this.selection;
    if (!sel || this.running) return;
    if (sel.kind === 'part') {
      const node = this.nodes.get(sel.id);
      node?.wrap.remove();
      this.nodes.delete(sel.id);
      this.diagram.parts = this.diagram.parts.filter((p) => p.id !== sel.id);
      this.diagram.connections = this.diagram.connections.filter(
        ([a, b]) => splitEndpoint(a).part !== sel.id && splitEndpoint(b).part !== sel.id,
      );
    } else {
      this.diagram.connections.splice(sel.index, 1);
    }
    this.select(null);
    this.render();
    this.ev.change();
  }

  rotateSelection(): void {
    const sel = this.selection;
    if (sel?.kind !== 'part') return;
    const node = this.nodes.get(sel.id);
    if (!node) return;
    node.part.rotate = ((node.part.rotate ?? 0) + 90) % 360;
    this.placeNode(node);
    this.render();
    this.ev.change();
  }

  setPartAttr(id: string, key: string, value: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.part.attrs = { ...node.part.attrs, [key]: value };
    node.ui?.view.setProps?.(node.el, propsOf(node.part, node.ui));
    this.ev.change();
  }

  setWireColor(index: number, color: string): void {
    const c = this.diagram.connections[index];
    if (!c) return;
    c[2] = color;
    this.render();
    this.ev.change();
  }

  setRunning(on: boolean): void {
    this.running = on;
    this.root.classList.toggle('running', on);
    if (on) this.cancelDrawing();
    else for (const n of this.nodes.values()) n.ui?.view.reset?.(n.el);
    this.updateHint();
  }

  applyStates(states: Record<string, Record<string, unknown>>): void {
    for (const [id, s] of Object.entries(states)) {
      const n = this.nodes.get(id);
      if (n?.ui?.view.update) n.ui.view.update(n.el, s);
    }
  }

  fit(): void {
    if (!this.nodes.size) {
      this.view = { x: 40, y: 40, z: 1 };
      this.applyView();
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.nodes.values()) {
      for (const c of this.corners(n)) {
        x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
        x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
      }
    }
    const pad = 50;
    const W = this.root.clientWidth || 800;
    const H = this.root.clientHeight || 600;
    const z = Math.min(1.6, Math.max(0.25, Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1))));
    this.view = { z, x: (W - (x1 - x0) * z) / 2 - x0 * z, y: (H - (y1 - y0) * z) / 2 - y0 * z };
    this.applyView();
  }

  zoomBy(factor: number, cx = this.root.clientWidth / 2, cy = this.root.clientHeight / 2): void {
    const z = Math.min(4, Math.max(0.2, this.view.z * factor));
    const wx = (cx - this.view.x) / this.view.z;
    const wy = (cy - this.view.y) / this.view.z;
    this.view = { z, x: cx - wx * z, y: cy - wy * z };
    this.applyView();
  }

  /** Convert a mouse position to world coordinates. */
  toWorld(clientX: number, clientY: number): Point {
    const r = this.root.getBoundingClientRect();
    return this.toWorldFromRoot(clientX - r.left, clientY - r.top);
  }

  // ───────────────────────────── parts ─────────────────────────────

  private createNode(part: DiagramPart): PartNode {
    const ui = partUIs.get(part.type);
    const wrap = document.createElement('div');
    wrap.className = 'part';
    wrap.dataset.id = part.id;
    let el: HTMLElement;
    if (ui) {
      el = ui.view.create(propsOf(part, ui));
      if (ui.manifest.interactive) wrap.classList.add('interactive');
      ui.view.attach?.(el, (event, data) => {
        if (this.running) this.ev.input(part.id, event, data);
        // While editing, a control's 'value' (e.g. a potentiometer knob) becomes its starting value.
        else if (event === 'value') this.setPartAttr(part.id, 'value', String(data));
      });
    } else {
      el = document.createElement('div');
      el.textContent = `Unsupported part: ${part.type}`;
      el.style.cssText = 'padding:8px;border:1px dashed currentColor;font-size:11px;line-height:1.2;width:140px;opacity:.7';
    }
    const label = document.createElement('div');
    label.className = 'part-label';
    label.textContent = part.id;
    wrap.append(el, label);
    this.partsLayer.append(wrap);
    const node: PartNode = { part, ui, wrap, el, pins: [], w: 0, h: 0 };
    this.nodes.set(part.id, node);
    wrap.addEventListener('pointerdown', (e) => this.onPartDown(e, node));
    this.placeNode(node);
    return node;
  }

  private async measure(node: PartNode): Promise<void> {
    const lit = node.el as HTMLElement & { updateComplete?: Promise<unknown> };
    if (lit.updateComplete) await lit.updateComplete;
    // Measure the wrapper: custom elements default to display:inline, whose own
    // offsetHeight is just the line box, not the drawing.
    node.w = node.wrap.offsetWidth;
    node.h = node.wrap.offsetHeight;
    node.pins = pinsOf(node.ui, node.el);
    this.placeNode(node);
  }

  private placeNode(node: PartNode): void {
    const { wrap, part } = node;
    wrap.style.left = `${part.left}px`;
    wrap.style.top = `${part.top}px`;
    wrap.style.transformOrigin = `${node.w / 2}px ${node.h / 2}px`;
    wrap.style.transform = part.rotate ? `rotate(${part.rotate}deg)` : '';
  }

  private corners(n: PartNode): Point[] {
    const local = [{ x: 0, y: -14 }, { x: n.w, y: -14 }, { x: 0, y: n.h }, { x: n.w, y: n.h }];
    return local.map((p) => this.localToWorld(n, p));
  }

  private localToWorld(n: PartNode, p: Point): Point {
    const a = ((n.part.rotate ?? 0) * Math.PI) / 180;
    const cx = n.w / 2, cy = n.h / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const cos = Math.cos(a), sin = Math.sin(a);
    return { x: n.part.left + cx + dx * cos - dy * sin, y: n.part.top + cy + dx * sin + dy * cos };
  }

  private pinPos(endpoint: string): Point | null {
    const { part, pin } = splitEndpoint(endpoint);
    const n = this.nodes.get(part);
    const p = n?.pins.find((q) => q.name === pin);
    return n && p ? this.localToWorld(n, p) : null;
  }

  // ───────────────────────────── rendering ─────────────────────────────

  private render(): void {
    this.renderWires();
    this.renderPins();
    for (const n of this.nodes.values()) {
      n.wrap.classList.toggle('selected', this.selection?.kind === 'part' && this.selection.id === n.part.id);
    }
  }

  private renderPins(): void {
    const frag = document.createDocumentFragment();
    for (const n of this.nodes.values()) {
      for (const pin of n.pins) {
        const pos = this.localToWorld(n, pin);
        const d = document.createElement('div');
        d.className = 'pin';
        d.style.left = `${pos.x}px`;
        d.style.top = `${pos.y}px`;
        d.title = `${n.part.id}:${pin.name}`;
        d.dataset.endpoint = `${n.part.id}:${pin.name}`;
        d.addEventListener('pointerdown', (e) => this.onPinDown(e, d.dataset.endpoint!));
        frag.append(d);
      }
    }
    this.pinsLayer.replaceChildren(frag);
  }

  private renderWires(): void {
    const svg = this.svg;
    svg.replaceChildren();
    const path = (d: string, cls: string, stroke?: string) => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', cls);
      if (stroke) p.setAttribute('stroke', stroke);
      svg.append(p);
      return p;
    };
    const toD = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

    this.diagram.connections.forEach((c: DiagramConnection, i) => {
      const a = this.pinPos(c[0]);
      const b = this.pinPos(c[1]);
      if (!a || !b) return;
      const d = toD(routeToPoints(a, b, c[3]));
      if (this.selection?.kind === 'wire' && this.selection.index === i) path(d, 'selected');
      path(d, 'wire-outline');
      path(d, 'wire', c[2]);
      const hit = path(d, 'hit');
      hit.addEventListener('pointerdown', (e) => this.onWireDown(e, i));
    });

    if (this.drawing) {
      const { fromPos, points, cursor } = this.drawing;
      const pts = [fromPos, ...points];
      const last = pts[pts.length - 1];
      if (cursor.x !== last.x && cursor.y !== last.y) pts.push({ x: cursor.x, y: last.y });
      pts.push(cursor);
      path(toD(pts), 'preview', '#38bdf8');
    }
  }

  // ───────────────────────────── interaction ─────────────────────────────

  private select(sel: Selection): void {
    this.selection = sel;
    this.render();
    this.ev.select(sel);
  }

  private updateHint(): void {
    if (!this.hint) return;
    this.hint.textContent = this.running ? HINT_RUN : this.drawing ? HINT_DRAW : HINT_IDLE;
    this.root.classList.toggle('drawing', !!this.drawing);
  }

  private cancelDrawing(): void {
    if (!this.drawing) return;
    this.drawing = null;
    this.renderWires();
    this.updateHint();
  }

  private onPinDown(e: PointerEvent, endpoint: string): void {
    e.stopPropagation();
    e.preventDefault();
    if (this.running || e.button !== 0) return;
    const pos = this.pinPos(endpoint);
    if (!pos) return;
    if (!this.drawing) {
      this.drawing = { from: endpoint, fromPos: pos, points: [], cursor: pos };
      this.select(null);
      this.updateHint();
      return;
    }
    if (endpoint === this.drawing.from) return this.cancelDrawing();
    const { from, fromPos, points } = this.drawing;
    this.diagram.connections.push([from, endpoint, defaultWireColor(from, endpoint), pointsToRoute(fromPos, points)]);
    this.drawing = null;
    this.updateHint();
    this.select({ kind: 'wire', index: this.diagram.connections.length - 1 });
    this.ev.change();
  }

  private onWireDown(e: PointerEvent, index: number): void {
    if (this.drawing || e.button !== 0) return; // let the background handler add a bend
    e.stopPropagation();
    if (!this.running) this.select({ kind: 'wire', index });
  }

  private onPartDown(e: PointerEvent, node: PartNode): void {
    if (e.button !== 0 || this.drawing) return; // background handler adds a bend
    e.stopPropagation();
    if (this.running && node.ui?.manifest.interactive) return; // let the part handle the click
    this.root.focus({ preventScroll: true });
    this.drag = { node, sx: e.clientX, sy: e.clientY, left: node.part.left, top: node.part.top, moved: false };
    if (!this.running) this.select({ kind: 'part', id: node.part.id });
  }

  private bindEvents(): void {
    const root = this.root;

    root.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('.inspector, .zoom-controls')) return;
      if (e.button === 2 && this.drawing) return this.cancelDrawing();
      if (e.button !== 0) return;
      root.focus({ preventScroll: true });
      if (this.drawing) {
        const p = this.toWorld(e.clientX, e.clientY);
        const last = this.drawing.points[this.drawing.points.length - 1] ?? this.drawing.fromPos;
        // Keep bends orthogonal: first horizontal, then vertical.
        if (p.x !== last.x && p.y !== last.y) this.drawing.points.push({ x: Math.round(p.x), y: last.y });
        this.drawing.points.push({ x: Math.round(p.x), y: Math.round(p.y) });
        this.renderWires();
        return;
      }
      this.pan = { sx: e.clientX, sy: e.clientY, x: this.view.x, y: this.view.y, moved: false };
    });
    root.addEventListener('contextmenu', (e) => {
      if (this.drawing) e.preventDefault();
    });

    window.addEventListener('pointermove', (e) => {
      if (this.drawing) {
        const p = this.toWorld(e.clientX, e.clientY);
        this.drawing.cursor = { x: Math.round(p.x), y: Math.round(p.y) };
        this.renderWires();
      }
      if (this.drag) {
        const dx = (e.clientX - this.drag.sx) / this.view.z;
        const dy = (e.clientY - this.drag.sy) / this.view.z;
        if (!this.drag.moved && Math.hypot(dx, dy) < 3) return;
        this.drag.moved = true;
        this.drag.node.part.left = Math.round(this.drag.left + dx);
        this.drag.node.part.top = Math.round(this.drag.top + dy);
        this.placeNode(this.drag.node);
        this.render();
      } else if (this.pan) {
        const dx = e.clientX - this.pan.sx;
        const dy = e.clientY - this.pan.sy;
        if (!this.pan.moved && Math.hypot(dx, dy) < 3) return;
        this.pan.moved = true;
        root.classList.add('panning');
        this.view.x = this.pan.x + dx;
        this.view.y = this.pan.y + dy;
        this.applyView();
      }
    });

    window.addEventListener('pointerup', () => {
      if (this.drag?.moved) this.ev.change();
      if (this.pan && !this.pan.moved && !this.running) this.select(null);
      this.drag = null;
      this.pan = null;
      root.classList.remove('panning');
    });

    root.addEventListener(
      'wheel',
      (e) => {
        if ((e.target as Element).closest('.inspector')) return;
        e.preventDefault();
        const r = root.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        this.zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'Escape') {
        if (this.drawing) this.cancelDrawing();
        else this.select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection) {
        e.preventDefault();
        this.deleteSelection();
      } else if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !this.running) {
        this.rotateSelection();
      }
    });

    // Drop parts dragged from the palette.
    root.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('application/x-axion-part') && !this.running) e.preventDefault();
    });
    root.addEventListener('drop', (e) => {
      const type = e.dataTransfer?.getData('application/x-axion-part');
      if (!type || this.running) return;
      e.preventDefault();
      void this.addPart(type, this.toWorld(e.clientX, e.clientY));
    });
  }

  private toWorldFromRoot(x: number, y: number): Point {
    return { x: (x - this.view.x) / this.view.z, y: (y - this.view.y) / this.view.z };
  }

  private applyView(): void {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.root.style.backgroundSize = `${20 * z}px ${20 * z}px`;
    this.root.style.backgroundPosition = `${x}px ${y}px`;
  }
}
