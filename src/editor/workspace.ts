// SPDX-License-Identifier: Apache-2.0
/**
 * The circuit canvas: places parts, draws wires, handles pan / zoom / drag /
 * rotate / delete, and forwards part interactions (button presses…) to the
 * simulation while it runs.
 *
 * Coordinates: "world" units are CSS pixels at zoom 1, identical to the
 * `top` / `left` values stored in diagram.json.
 *
 * Breadboards ("carrier" parts) are drawn beneath everything else. Parts dropped
 * on one snap to its holes, and every pin sitting in a hole is connected to it.
 * Like Wokwi, these connections are stored in diagram.json with the route
 * ["$bb"] and are not drawn as wires.
 */
import type { Diagram, DiagramConnection, DiagramPart, Point } from '../core/diagram';
import { pointsToRoute, routeToPoints, splitEndpoint } from '../core/diagram';
import { partUIs, pinsOf, type PartUI } from '../core/parts-views';
import type { PinPosition, Props } from '../core/types';
import {
  holeIndex,
  isImplicit,
  pairKey,
  pluggedPins,
  snapOffset,
  type HoleRef,
  type PlacedPart,
  type PointIndex,
} from './breadboard';
import './workspace.css';

export type Selection = { kind: 'part'; id: string } | { kind: 'wire'; index: number } | null;

export interface WorkspaceEvents {
  /** The diagram was edited (persist it). */
  change(): void;
  /** Selection changed (update the inspector). */
  select(sel: Selection): void;
  /** A part was interacted with while the simulation runs. */
  input(partId: string, event: string, data?: unknown): void;
  /** Undo / redo availability changed (update toolbar buttons). */
  history?(canUndo: boolean, canRedo: boolean): void;
}

const HISTORY_LIMIT = 100;

interface PartNode {
  part: DiagramPart;
  ui?: PartUI;
  wrap: HTMLDivElement;
  el: HTMLElement;
  pins: PinPosition[];
  pinMap: Map<string, PinPosition>;
  w: number;
  h: number;
  /** Breadboard-like part: its pins are holes that other parts plug into. */
  carrier: boolean;
  /** Pin hit-targets (non-carriers), in the pins layer, transformed like the part. */
  pinGroup?: HTMLDivElement;
  /** Hole highlights (carriers), drawn in the part's own coordinates. */
  overlay?: { plugged: SVGPathElement; preview: SVGPathElement; hover: SVGRectElement };
}

interface DragState {
  node: PartNode;
  sx: number;
  sy: number;
  left: number;
  top: number;
  moved: boolean;
  /** Parts plugged into a dragged carrier: they move with it. */
  riders: Array<{ node: PartNode; left: number; top: number }>;
}

/** Highlight rings are drawn this far around a hole centre. */
const RING = 3.4;
/** Clicks within this distance of a hole start / end a wire there. */
const HOLE_HIT = 4.8;

const SVG_NS = 'http://www.w3.org/2000/svg';
const HINT_IDLE = 'Drag parts in from the panel · click a pin to start a wire · R rotate · Del delete · scroll to zoom · drag background to pan';
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
  if (pins.some((p) => p.startsWith('GND') || /^[TB]N\./.test(p))) return 'black';
  if (pins.some((p) => ['5V', '3.3V', 'VCC', 'VIN'].includes(p) || /^[TB]P\./.test(p))) return 'red';
  return 'green';
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const partOf = (endpoint: string) => splitEndpoint(endpoint).part;

export class Workspace {
  diagram: Diagram = { version: 1, parts: [], connections: [] };
  selection: Selection = null;
  running = false;

  private world: HTMLDivElement;
  private carriersLayer: HTMLDivElement;
  private partsLayer: HTMLDivElement;
  private svg: SVGSVGElement;
  private pinsLayer: HTMLDivElement;
  private hint: HTMLElement | null;
  private nodes = new Map<string, PartNode>();
  private view = { x: 40, y: 40, z: 1 };
  private drawing: null | { from: string; fromPos: Point; points: Point[]; cursor: Point } = null;
  private drag: DragState | null = null;
  private pan: null | { sx: number; sy: number; x: number; y: number; moved: boolean } = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot = '';
  private clipboard: DiagramPart | null = null;
  /** World positions of all carrier holes; rebuilt lazily after a carrier moves. */
  private holes: PointIndex<HoleRef> | null = null;
  private hovered: { node: PartNode; pin: string } | null = null;
  /** Colour for new wires; null = pick automatically from the pin names. */
  wireColor: string | null = null;

  constructor(private root: HTMLElement, private ev: WorkspaceEvents) {
    this.world = document.createElement('div');
    this.world.className = 'world';
    this.carriersLayer = document.createElement('div');
    this.partsLayer = document.createElement('div');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('wires');
    this.pinsLayer = document.createElement('div');
    this.world.append(this.carriersLayer, this.partsLayer, this.svg, this.pinsLayer);
    root.prepend(this.world);
    this.hint = root.querySelector('#hint');
    this.bindEvents();
    this.applyView();
    this.updateHint();
  }

  // ───────────────────────────── public API ─────────────────────────────

  async load(diagram: Diagram, fit = true, resetHistory = true): Promise<void> {
    this.diagram = diagram;
    if (resetHistory) {
      this.undoStack = [];
      this.redoStack = [];
      this.lastSnapshot = JSON.stringify(diagram);
      this.emitHistory();
    }
    this.cancelDrawing();
    this.drag = null;
    this.hovered = null;
    this.nodes.clear();
    this.holes = null;
    this.carriersLayer.replaceChildren();
    this.partsLayer.replaceChildren();
    this.pinsLayer.replaceChildren();
    const nodes = diagram.parts.map((p) => this.createNode(p));
    await Promise.all(nodes.map((n) => this.measure(n)));
    this.select(null);
    this.render();
    if (fit) this.fit();
  }

  // ── history ──

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.running;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this.running;
  }

  async undo(): Promise<void> {
    if (!this.canUndo) return;
    this.redoStack.push(this.lastSnapshot);
    await this.restore(this.undoStack.pop()!);
  }

  async redo(): Promise<void> {
    if (!this.canRedo) return;
    this.undoStack.push(this.lastSnapshot);
    await this.restore(this.redoStack.pop()!);
  }

  private async restore(snapshot: string): Promise<void> {
    this.lastSnapshot = snapshot;
    // Restore into the same object: the app keeps a reference to the loaded diagram.
    const d = this.diagram as unknown as Record<string, unknown>;
    for (const k of Object.keys(d)) delete d[k];
    Object.assign(d, JSON.parse(snapshot));
    await this.load(this.diagram, false, false);
    this.emitHistory();
    this.ev.change();
  }

  /** Record the current diagram as an undo step (called after every edit). */
  private commit(): void {
    const snap = JSON.stringify(this.diagram);
    if (snap === this.lastSnapshot) return;
    this.undoStack.push(this.lastSnapshot);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnapshot = snap;
    this.emitHistory();
  }

  private emitHistory(): void {
    this.ev.history?.(this.canUndo, this.canRedo);
  }

  /** Notify the app of an edit and record it for undo. */
  private changed(): void {
    this.commit();
    this.ev.change();
  }

  // ── clipboard ──

  get canCopy(): boolean {
    return this.selection?.kind === 'part';
  }
  get canPaste(): boolean {
    return !!this.clipboard && !this.running;
  }

  copySelection(): void {
    const sel = this.selection;
    if (sel?.kind !== 'part') return;
    const part = this.diagram.parts.find((p) => p.id === sel.id);
    if (part) this.clipboard = structuredClone(part);
  }

  async paste(): Promise<void> {
    if (!this.clipboard || this.running) return;
    const src = this.clipboard;
    const left = src.left + 30;
    const top = src.top + 30;
    await this.addPart(src.type, undefined, { attrs: { ...src.attrs }, rotate: src.rotate ?? 0, left, top });
    this.clipboard = { ...src, left, top }; // the next paste lands a bit further along
  }

  async duplicateSelection(): Promise<void> {
    this.copySelection();
    await this.paste();
  }

  /** Connections to simulate: the drawn wires plus implicit ones (e.g. parts plugged into a breadboard). */
  connectionsForSimulation(): DiagramConnection[] {
    const out = this.diagram.connections.map((c) => [c[0], c[1], c[2], [...c[3]]] as DiagramConnection);
    const have = new Set(out.map((c) => pairKey(c[0], c[1])));
    for (const p of pluggedPins(this.placedParts(), this.holeIndex())) {
      const a = `${p.part}:${p.pin}`;
      const b = `${p.hole.part}:${p.hole.pin}`;
      if (!have.has(pairKey(a, b))) out.push([a, b, '', []]);
    }
    return out;
  }

  async addPart(
    type: string,
    at?: Point,
    init?: { attrs?: Record<string, string>; rotate?: number; left?: number; top?: number },
  ): Promise<string> {
    const ui = partUIs.get(type);
    const prefix = ui?.manifest.idPrefix ?? type.replace(/^wokwi-/, '');
    let n = 1;
    while (this.diagram.parts.some((p) => p.id === `${prefix}${n}`)) n++;
    const center = at ?? this.toWorldFromRoot(this.root.clientWidth / 2, this.root.clientHeight / 2);
    const part: DiagramPart = {
      type,
      id: `${prefix}${n}`,
      top: center.y,
      left: center.x,
      rotate: init?.rotate ?? 0,
      attrs: { ...(init?.attrs ?? {}) },
    };
    this.diagram.parts.push(part);
    const node = this.createNode(part);
    await this.measure(node);
    part.left = init?.left ?? Math.round(center.x - node.w / 2);
    part.top = init?.top ?? Math.round(center.y - node.h / 2);
    if (!at && init?.left === undefined) {
      // Clicked in the palette: put it in the nearest free space around the view centre.
      const free = this.findFreeSpot(node, part.left, part.top);
      part.left = free.x;
      part.top = free.y;
    }
    this.placeNode(node);
    this.snap(node);
    this.syncImplicit(new Set([part.id]));
    this.render();
    this.select({ kind: 'part', id: part.id });
    this.changed();
    return part.id;
  }

  deleteSelection(): void {
    const sel = this.selection;
    if (!sel || this.running) return;
    if (sel.kind === 'part') {
      const node = this.nodes.get(sel.id);
      node?.wrap.remove();
      node?.pinGroup?.remove();
      if (node?.carrier) this.holes = null;
      if (this.hovered?.node === node) this.hovered = null;
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
    this.changed();
  }

  rotateSelection(): void {
    const sel = this.selection;
    if (sel?.kind !== 'part') return;
    const node = this.nodes.get(sel.id);
    if (!node) return;
    if (node.carrier) {
      // Turn the plugged-in parts with the board, around the board's centre.
      const riders = this.ridersOf(node);
      const cx = node.part.left + node.w / 2;
      const cy = node.part.top + node.h / 2;
      for (const r of riders) {
        const px = r.part.left + r.w / 2 - cx;
        const py = r.part.top + r.h / 2 - cy;
        r.part.left = round2(cx - py - r.w / 2);
        r.part.top = round2(cy + px - r.h / 2);
        r.part.rotate = ((r.part.rotate ?? 0) + 90) % 360;
        this.placeNode(r);
      }
      node.part.rotate = ((node.part.rotate ?? 0) + 90) % 360;
      this.placeNode(node);
      this.syncImplicit(new Set([node.part.id, ...riders.map((r) => r.part.id)]));
    } else {
      node.part.rotate = ((node.part.rotate ?? 0) + 90) % 360;
      this.placeNode(node);
      this.snap(node);
      this.syncImplicit(new Set([node.part.id]));
    }
    this.render();
    this.changed();
  }

  setPartAttr(id: string, key: string, value: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.part.attrs = { ...node.part.attrs, [key]: value };
    node.ui?.view.setProps?.(node.el, propsOf(node.part, node.ui));
    // A property can change the part's size and pin positions (e.g. number of battery cells).
    void this.measure(node).then(() => this.render());
    this.changed();
  }

  setWireColor(index: number, color: string): void {
    const c = this.diagram.connections[index];
    if (!c) return;
    c[2] = color;
    this.render();
    this.changed();
  }

  setRunning(on: boolean): void {
    this.running = on;
    this.root.classList.toggle('running', on);
    if (on) this.cancelDrawing();
    else for (const n of this.nodes.values()) n.ui?.view.reset?.(n.el);
    this.setHover(null);
    this.updateHint();
    this.emitHistory();
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
    const carrier = !!ui?.manifest.carrier;
    const wrap = document.createElement('div');
    wrap.className = carrier ? 'part carrier' : 'part';
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
    // Labels stay visible for boards and breadboards; small parts show theirs on hover / selection.
    if (ui?.manifest.mcu) wrap.classList.add('mcu');
    const label = document.createElement('div');
    label.className = 'part-label';
    label.textContent = part.id;
    wrap.append(el, label);
    const node: PartNode = { part, ui, wrap, el, pins: [], pinMap: new Map(), w: 0, h: 0, carrier };
    if (carrier) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.classList.add('bb-overlay');
      const mk = <K extends 'path' | 'rect'>(tag: K, cls: string) => {
        const e = document.createElementNS(SVG_NS, tag);
        e.setAttribute('class', cls);
        svg.append(e);
        return e;
      };
      node.overlay = { plugged: mk('path', 'bb-plugged'), preview: mk('path', 'bb-preview'), hover: mk('rect', 'bb-hover') };
      wrap.append(svg);
      this.carriersLayer.append(wrap);
    } else {
      node.pinGroup = document.createElement('div');
      node.pinGroup.className = 'pin-group';
      this.partsLayer.append(wrap);
      this.pinsLayer.append(node.pinGroup);
    }
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
    node.pinMap = new Map(node.pins.map((p) => [p.name, p]));
    if (node.carrier) this.holes = null;
    if (node.pinGroup) {
      // Pin hit-targets live in the part's own coordinates, so moving or rotating
      // the part only changes one transform.
      const frag = document.createDocumentFragment();
      for (const pin of node.pins) {
        const d = document.createElement('div');
        const endpoint = `${node.part.id}:${pin.name}`;
        d.className = 'pin';
        d.style.left = `${pin.x}px`;
        d.style.top = `${pin.y}px`;
        d.title = endpoint;
        d.dataset.endpoint = endpoint;
        frag.append(d);
      }
      node.pinGroup.replaceChildren(frag);
    }
    this.placeNode(node);
  }

  private placeNode(node: PartNode): void {
    const { part } = node;
    const transform = part.rotate ? `rotate(${part.rotate}deg)` : '';
    for (const e of node.pinGroup ? [node.wrap, node.pinGroup] : [node.wrap]) {
      e.style.left = `${part.left}px`;
      e.style.top = `${part.top}px`;
      e.style.transformOrigin = `${node.w / 2}px ${node.h / 2}px`;
      e.style.transform = transform;
    }
    if (node.pinGroup) {
      node.pinGroup.style.width = `${node.w}px`;
      node.pinGroup.style.height = `${node.h}px`;
    }
    if (node.carrier) this.holes = null;
  }

  /** Nearest position to (x, y) where a part of this size overlaps no other part (spiral search). */
  private findFreeSpot(node: PartNode, x: number, y: number): Point {
    const MARGIN = 18;
    const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    for (const n of this.nodes.values()) {
      if (n === node) continue;
      const cs = this.corners(n);
      boxes.push({
        x0: Math.min(...cs.map((c) => c.x)) - MARGIN,
        y0: Math.min(...cs.map((c) => c.y)) - MARGIN,
        x1: Math.max(...cs.map((c) => c.x)) + MARGIN,
        y1: Math.max(...cs.map((c) => c.y)) + MARGIN,
      });
    }
    const fits = (px: number, py: number) =>
      !boxes.some((b) => px < b.x1 && px + node.w > b.x0 && py - 14 < b.y1 && py + node.h > b.y0);
    if (fits(x, y)) return { x, y };
    const STEP = 24;
    for (let r = 1; r <= 60; r++) {
      const ring: Point[] = [];
      for (let i = -r; i <= r; i++) {
        ring.push({ x: x + i * STEP, y: y - r * STEP }, { x: x + i * STEP, y: y + r * STEP });
        if (Math.abs(i) < r) ring.push({ x: x - r * STEP, y: y + i * STEP }, { x: x + r * STEP, y: y + i * STEP });
      }
      ring.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
      const spot = ring.find((c) => fits(c.x, c.y));
      if (spot) return { x: Math.round(spot.x), y: Math.round(spot.y) };
    }
    return { x, y };
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
    const p = n?.pinMap.get(pin);
    return n && p ? this.localToWorld(n, p) : null;
  }

  // ───────────────────────────── breadboards ─────────────────────────────

  /** A part's pins in world coordinates. */
  private placed(n: PartNode): PlacedPart {
    return {
      id: n.part.id,
      carrier: n.carrier,
      pins: n.pins.map((p) => ({ ...this.localToWorld(n, p), name: p.name, noBreadboard: (p as { noBreadboard?: boolean }).noBreadboard })),
    };
  }

  private placedParts(except?: PartNode): PlacedPart[] {
    const out: PlacedPart[] = [];
    for (const n of this.nodes.values()) if (n !== except && !n.carrier) out.push(this.placed(n));
    return out;
  }

  private holeIndex(): PointIndex<HoleRef> {
    if (!this.holes) {
      const carriers: PlacedPart[] = [];
      for (const n of this.nodes.values()) if (n.carrier) carriers.push(this.placed(n));
      this.holes = holeIndex(carriers);
    }
    return this.holes;
  }

  /** Shift a non-carrier part so its pin nearest to a hole sits exactly in it. */
  private snap(node: PartNode): void {
    if (node.carrier || !node.pins.length) return;
    const d = snapOffset(this.placed(node).pins, this.holeIndex());
    if (!d || (d.x === 0 && d.y === 0)) return;
    node.part.left = round2(node.part.left + d.x);
    node.part.top = round2(node.part.top + d.y);
    this.placeNode(node);
  }

  /** Parts plugged into a carrier (geometrically, or through a stored "$bb" connection). */
  private ridersOf(carrier: PartNode): PartNode[] {
    const ids = new Set<string>();
    for (const p of pluggedPins(this.placedParts(), this.holeIndex())) if (p.hole.part === carrier.part.id) ids.add(p.part);
    for (const c of this.diagram.connections) {
      if (!isImplicit(c)) continue;
      const a = partOf(c[0]);
      const b = partOf(c[1]);
      if (a === carrier.part.id) ids.add(b);
      else if (b === carrier.part.id) ids.add(a);
    }
    ids.delete(carrier.part.id);
    return [...ids].map((id) => this.nodes.get(id)).filter((n): n is PartNode => !!n && !n.carrier);
  }

  /**
   * Keep the stored breadboard connections ("$bb") in step with the geometry after
   * the parts in `moved` changed position: links between a moved and an unmoved part
   * are dropped, then every pin sitting in a hole gets one.
   */
  private syncImplicit(moved: Set<string>): void {
    const selected = this.selection?.kind === 'wire' ? this.diagram.connections[this.selection.index] : undefined;
    const keep = this.diagram.connections.filter(
      (c) => !isImplicit(c) || moved.has(partOf(c[0])) === moved.has(partOf(c[1])),
    );
    const have = new Set(keep.filter(isImplicit).map((c) => pairKey(c[0], c[1])));
    for (const p of pluggedPins(this.placedParts(), this.holeIndex())) {
      const a = `${p.part}:${p.pin}`;
      const b = `${p.hole.part}:${p.hole.pin}`;
      if (have.has(pairKey(a, b))) continue;
      have.add(pairKey(a, b));
      keep.push([a, b, '', ['$bb']]);
    }
    this.diagram.connections = keep;
    if (selected) this.selection = { kind: 'wire', index: keep.indexOf(selected) };
  }

  /** Holes (per carrier) that the dragged part would plug into if dropped now. */
  private dragPreview(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    const node = this.drag?.moved && !this.drag.node.carrier ? this.drag.node : null;
    if (!node) return out;
    const index = this.holeIndex();
    const placed = this.placed(node);
    const d = snapOffset(placed.pins, index) ?? { x: 0, y: 0 };
    for (const p of placed.pins) {
      p.x += d.x;
      p.y += d.y;
    }
    for (const p of pluggedPins([placed], index)) {
      if (!out.has(p.hole.part)) out.set(p.hole.part, new Set());
      out.get(p.hole.part)!.add(p.hole.pin);
    }
    return out;
  }

  /** Green rings on holes with a pin in them, and the drop preview while dragging. */
  private renderHoles(): void {
    let any = false;
    for (const n of this.nodes.values()) if (n.carrier) any = true;
    if (!any) return;
    const dragged = this.drag?.moved && !this.drag.node.carrier ? this.drag.node : undefined;
    const plugged = new Map<string, Set<string>>();
    const add = (carrier: string, hole: string) => {
      if (!plugged.has(carrier)) plugged.set(carrier, new Set());
      plugged.get(carrier)!.add(hole);
    };
    for (const p of pluggedPins(this.placedParts(dragged), this.holeIndex())) add(p.hole.part, p.hole.pin);
    for (const c of this.diagram.connections) {
      if (!isImplicit(c)) continue;
      const a = splitEndpoint(c[0]);
      const b = splitEndpoint(c[1]);
      if (a.part === dragged?.part.id || b.part === dragged?.part.id) continue;
      if (this.nodes.get(b.part)?.carrier) add(b.part, b.pin);
      else if (this.nodes.get(a.part)?.carrier) add(a.part, a.pin);
    }
    const preview = this.dragPreview();
    const rings = (n: PartNode, names?: Set<string>) => {
      let d = '';
      for (const name of names ?? []) {
        const p = n.pinMap.get(name);
        if (p) d += `M${(p.x - RING).toFixed(2)} ${p.y.toFixed(2)}a${RING} ${RING} 0 1 0 ${2 * RING} 0a${RING} ${RING} 0 1 0 ${-2 * RING} 0`;
      }
      return d;
    };
    for (const n of this.nodes.values()) {
      if (!n.overlay) continue;
      n.overlay.plugged.setAttribute('d', rings(n, plugged.get(n.part.id)));
      n.overlay.preview.setAttribute('d', rings(n, preview.get(n.part.id)));
    }
  }

  /** The hole of `node` (a carrier) under a world point, if any. */
  private holeAt(world: Point, node?: PartNode): HoleRef | null {
    const hole = this.holeIndex().nearest(world.x, world.y, HOLE_HIT);
    return hole && (!node || hole.part === node.part.id) ? hole : null;
  }

  private setHover(h: { node: PartNode; pin: string } | null): void {
    const old = this.hovered;
    if (old?.node === h?.node && old?.pin === h?.pin) return;
    if (old) {
      old.node.overlay!.hover.removeAttribute('width');
      old.node.wrap.removeAttribute('title');
      old.node.wrap.classList.remove('on-hole');
    }
    this.hovered = h;
    const p = h && h.node.pinMap.get(h.pin);
    if (!h || !p) return;
    const r = h.node.overlay!.hover;
    r.setAttribute('x', String(p.x - 4));
    r.setAttribute('y', String(p.y - 4));
    r.setAttribute('width', '8');
    r.setAttribute('height', '8');
    h.node.wrap.title = `${h.node.part.id}:${h.pin}`;
    h.node.wrap.classList.add('on-hole');
  }

  // ───────────────────────────── rendering ─────────────────────────────

  private render(): void {
    this.renderWires();
    this.renderHoles();
    for (const n of this.nodes.values()) {
      n.wrap.classList.toggle('selected', this.selection?.kind === 'part' && this.selection.id === n.part.id);
    }
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
      if (isImplicit(c)) return; // a part plugged into a breadboard: no wire
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
    this.diagram.connections.push([from, endpoint, this.wireColor ?? defaultWireColor(from, endpoint), pointsToRoute(fromPos, points)]);
    this.drawing = null;
    this.updateHint();
    this.select({ kind: 'wire', index: this.diagram.connections.length - 1 });
    this.changed();
  }

  private onWireDown(e: PointerEvent, index: number): void {
    if (this.drawing || e.button !== 0) return; // let the background handler add a bend (or end on a hole)
    e.stopPropagation();
    if (!this.running) this.select({ kind: 'wire', index });
  }

  private onPartDown(e: PointerEvent, node: PartNode): void {
    if (e.button !== 0) return;
    if (node.carrier && !this.running) {
      // Breadboard holes are hit-tested here instead of having one element each.
      const hole = this.holeAt(this.toWorld(e.clientX, e.clientY), node);
      if (hole) return this.onPinDown(e, `${hole.part}:${hole.pin}`);
    }
    if (this.drawing) return; // background handler adds a bend
    e.stopPropagation();
    if (this.running && node.ui?.manifest.interactive) return; // let the part handle the click
    this.root.focus({ preventScroll: true });
    this.drag = {
      node,
      sx: e.clientX,
      sy: e.clientY,
      left: node.part.left,
      top: node.part.top,
      moved: false,
      riders: node.carrier ? this.ridersOf(node).map((r) => ({ node: r, left: r.part.left, top: r.part.top })) : [],
    };
    if (!this.running) this.select({ kind: 'part', id: node.part.id });
  }

  private onDragMove(e: PointerEvent): void {
    const drag = this.drag!;
    const dx = (e.clientX - drag.sx) / this.view.z;
    const dy = (e.clientY - drag.sy) / this.view.z;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    const { node } = drag;
    node.part.left = Math.round(drag.left + dx);
    node.part.top = Math.round(drag.top + dy);
    this.placeNode(node);
    // Riders keep their exact offset to the board.
    const mx = node.part.left - drag.left;
    const my = node.part.top - drag.top;
    for (const r of drag.riders) {
      r.node.part.left = round2(r.left + mx);
      r.node.part.top = round2(r.top + my);
      this.placeNode(r.node);
    }
    this.render();
  }

  private onDragEnd(): void {
    const drag = this.drag!;
    this.drag = null;
    if (!drag.moved) return;
    if (drag.node.carrier) {
      this.syncImplicit(new Set([drag.node.part.id, ...drag.riders.map((r) => r.node.part.id)]));
    } else {
      this.snap(drag.node);
      this.syncImplicit(new Set([drag.node.part.id]));
    }
    this.render();
    this.changed();
  }

  private bindEvents(): void {
    const root = this.root;

    this.pinsLayer.addEventListener('pointerdown', (e) => {
      const pin = (e.target as Element).closest<HTMLElement>('.pin');
      if (pin?.dataset.endpoint) this.onPinDown(e, pin.dataset.endpoint);
    });

    root.addEventListener('pointerdown', (e) => {
      // Overlay controls on the canvas (inspector, zoom, fit, status bar) don't pan or clear the selection.
      if ((e.target as Element).closest('.inspector, .zoom-controls, .fab, .statusbar, [data-overlay]')) return;
      if (e.button === 2 && this.drawing) return this.cancelDrawing();
      if (e.button !== 0) return;
      root.focus({ preventScroll: true });
      if (this.drawing) {
        const p = this.toWorld(e.clientX, e.clientY);
        // A click on a wire lying over a breadboard hole ends the new wire in that hole.
        if ((e.target as Element).closest('svg.wires')) {
          const hole = this.holeAt(p);
          if (hole) return this.onPinDown(e, `${hole.part}:${hole.pin}`);
        }
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
        this.onDragMove(e);
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
      // Highlight the breadboard hole under the mouse.
      if (this.drag || this.pan || this.running) return this.setHover(null);
      const t = e.target as Element | null;
      const wrap = t?.closest?.<HTMLElement>('.part.carrier');
      const over = wrap ? this.nodes.get(wrap.dataset.id!) : this.drawing && t?.closest?.('svg.wires') ? undefined : null;
      if (over === null) return this.setHover(null);
      const hole = this.holeAt(this.toWorld(e.clientX, e.clientY), over);
      const node = hole && this.nodes.get(hole.part);
      this.setHover(hole && node ? { node, pin: hole.pin } : null);
    });

    window.addEventListener('pointerup', () => {
      if (this.drag) this.onDragEnd();
      if (this.pan && !this.pan.moved && !this.running) this.select(null);
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
      } else if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) void this.undo();
        else if ((k === 'z' && e.shiftKey) || k === 'y') void this.redo();
        else if (k === 'c') this.copySelection();
        else if (k === 'v') void this.paste();
        else if (k === 'd') void this.duplicateSelection();
        else return;
        e.preventDefault();
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
