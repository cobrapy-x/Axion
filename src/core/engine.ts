// SPDX-License-Identifier: Apache-2.0
/**
 * The simulation engine. It has no DOM dependencies, so it runs inside a
 * Web Worker in the app and directly inside Node for tests.
 *
 * Electrical model (see docs/SOLVER.md):
 *  1. Wires, internal part connections and closed `switches()` join pins into *nets*
 *     (union-find).
 *  2. Each pin applies a Drive. A number (power pin, battery) is a *stiff* source: the
 *     net is *fixed* at that voltage. 'high' / 'low' are sources behind a pin's output
 *     resistance (~25 Ω), 'pullup' / 'pulldown' behind ~35 kΩ, 'z' is nothing.
 *  3. Nets with no analog element on them take the fast path, as before: the strong
 *     drive wins, else the pulls; two strong drives with different voltages are a short.
 *  4. Nets linked by analog elements (`elements()`: resistors, capacitors, diodes,
 *     transistors…) form small *clusters*, split at fixed nets. Each cluster is solved
 *     with Modified Nodal Analysis (src/core/analog/solver.ts), and only when one of its
 *     inputs changed. Clusters with capacitors / inductors are advanced in time by
 *     scheduled steps until they settle, then cost nothing.
 *  5. Event-driven: the circuit is re-solved only when a part reports a change
 *     (`invalidate`). Parts whose pin level/voltage changed are notified, and the
 *     solve repeats until nothing changes, so signals ripple through behavioural
 *     parts (e.g. MCU pin → motor driver input → motor driver output → motor).
 *
 * Multiple MCUs are advanced in small time quanta (default 50 µs of simulated
 * time) so they stay in lock-step with each other. With an `McuOffload` (multi-core,
 * docs/MULTICORE.md) the MCUs of a quantum run in parallel on other threads and their
 * outputs are applied here, in time order, before the other parts step.
 */
import type { Diagram } from './diagram';
import { splitEndpoint } from './diagram';
import { VCC, levelOf } from './types';
import type { AnalogElement, Level, ModelFactory, PartContext, PartManifest, PartModel, Peer, Props } from './types';
import type { McuDescriptor, McuHost, McuRuntime } from '../mcu/runtime';
import * as K from './analog/constants';
import { C as KIND_C, Cluster, El, R as KIND_R, type Nets } from './analog/solver';

export interface PartType {
  manifest: PartManifest;
  model?: ModelFactory;
}

/**
 * Runs microcontrollers somewhere else (other threads), in lock-step with the engine.
 * Implemented by src/sim/mc-coordinator.ts. Set `engine.offload` before `load()`.
 */
export interface McuOffload {
  /** A board asks to run its MCU remotely: return its stand-in runtime, or undefined to run it in-process. */
  attach(partId: string, descriptor: McuDescriptor, firmware: string, host: McuHost): McuRuntime | undefined;
  /**
   * Run every attached MCU from `fromNs` to `toNs` (one quantum) and apply their outputs to
   * the circuit through their hosts, in time order. Synchronous: returns when all are done.
   */
  runQuantum(fromNs: number, toNs: number): void;
}

export interface SimEvent {
  part: string;
  event: string;
  data: unknown;
}

export interface Snapshot {
  timeNs: number;
  states: Record<string, Record<string, unknown>>;
  events: SimEvent[];
  warnings: string[];
}

interface Instance {
  id: string;
  manifest?: PartManifest;
  model: PartModel;
  /** No model hooks at all (breadboards, unknown parts): its pins never drive or listen. */
  passive: boolean;
  /** Analog elements (from `elements()` or the legacy `resistors()`). */
  els: El[];
  elById: Map<string, El> | null;
  /** Voltage of each of its pins that is on a net. */
  pins: Map<string, PinState>;
}

interface PinState {
  /** Latest solved voltage. */
  v: number | null;
  /** Voltage the part was last notified about (undefined = never). */
  told: number | null | undefined;
}

/** A pin whose part has a model: its voltage is tracked and reported on change. */
interface ActivePin {
  key: string;
  net: number;
  ps: PinState;
  inst: Instance;
  pin: string;
}

interface Timer {
  at: number;
  fn: () => void;
}

const key = (part: string, pin: string) => `${part}:${pin}`;

const MODEL_HOOKS: Array<keyof PartModel> = ['drive', 'switches', 'resistors', 'onPinChange', 'onData', 'step', 'input', 'state', 'elements', 'i2c', 'spi'];

/** Voltage differences below this are considered equal. */
const EPS = 0.01;
const MAX_ROUNDS = 50;

const same = (a: number, b: number) => a === b || (a !== a && b !== b);
const toNull = (v: number) => (v === v ? v : null);

function emptyNets(n: number): Nets {
  return {
    g: new Float64Array(n),
    i: new Float64Array(n),
    fixed: new Float64Array(n).fill(NaN),
    short: new Uint8Array(n),
    capOnly: new Uint8Array(n),
    local: new Int32Array(n).fill(-1),
    volts: new Float64Array(n).fill(NaN),
  };
}

export class Engine {
  private parts = new Map<string, Instance>();
  private wires: Array<[string, string]> = [];
  private timeNs = 0;

  // Topology (rebuilt when wires or switches change)
  private topoDirty = true;
  private pinNet = new Map<string, number>();
  private netPins: Array<Array<{ inst: Instance; pin: string }>> = [];
  /** Per net, only the pins whose part implements drive(). */
  private netDrivers: Array<Array<{ model: PartModel; pin: string }>> = [];
  /** Nets that have at least one driver. */
  private drvNets: number[] = [];
  private activePins: ActivePin[] = [];
  /** Net pairs linked by a resistor (for sendData). */
  private resEdges: Array<[number, number]> = [];

  // Analog state
  private nets: Nets = emptyNets(0);
  /** Strong (low-resistance) drive voltage per net, NaN = none. */
  private strong = new Float64Array(0);
  private netAnalog = new Uint8Array(0);
  private analogParts: Instance[] = [];
  private allEls: El[] = [];
  private clusters: Cluster[] = [];
  private netCluster: Array<Cluster | null> = [];
  /** Clusters next to each fixed net (they must be re-solved when its voltage changes). */
  private fixedAdj: Array<Cluster[] | undefined> = [];
  private clustersDirty = true;
  private dirtyNets: number[] = [];
  private netDirty = new Uint8Array(0);
  private dirtyClusters: Cluster[] = [];

  // Solved state
  private solving = false;
  private solveAgain = false;

  private events: SimEvent[] = [];
  private timers: Timer[] = [];
  private warnings = new Set<string>();

  /** Multi-core executor for the MCUs of the next `load()` (null: everything runs in this thread). */
  offload: McuOffload | null = null;

  constructor(private types: Map<string, PartType>) {}

  get time(): number {
    return this.timeNs;
  }

  load(diagram: Diagram, firmware: Record<string, string> = {}): void {
    this.killClusters();
    this.parts.clear();
    this.wires = [];
    this.timeNs = 0;
    this.events = [];
    this.timers = [];
    this.warnings.clear();

    for (const p of diagram.parts) {
      const type = this.types.get(p.type);
      if (!type) this.warnings.add(`Part type "${p.type}" (${p.id}) is not supported yet; treated as passive.`);
      const props: Props = {};
      for (const [k, spec] of Object.entries(type?.manifest.props ?? {})) props[k] = spec.default;
      for (const [k, v] of Object.entries(p.attrs ?? {})) {
        const spec = type?.manifest.props?.[k];
        props[k] = spec?.type === 'number' ? Number(v) : spec?.type === 'boolean' ? v === 'true' || v === '1' : v;
      }
      const inst: Instance = { id: p.id, manifest: type?.manifest, model: {}, passive: true, els: [], elById: null, pins: new Map() };
      this.parts.set(p.id, inst);
      const ctx = this.makeContext(inst, props, firmware[p.id]);
      inst.model = type?.model ? type.model(ctx) : {};
      inst.passive = !MODEL_HOOKS.some((h) => typeof inst.model[h] === 'function');
    }

    for (const [a, b] of diagram.connections) {
      const ea = splitEndpoint(a);
      const eb = splitEndpoint(b);
      if (!this.parts.has(ea.part) || !this.parts.has(eb.part)) {
        this.warnings.add(`Wire ${a} → ${b} references a missing part; ignored.`);
        continue;
      }
      this.wires.push([key(ea.part, ea.pin), key(eb.part, eb.pin)]);
    }
    this.topoDirty = true;
    this.solve();
  }

  /** Advance the simulation to `targetNs`. */
  stepTo(targetNs: number, quantumNs = 50_000): void {
    // Microcontrollers run first in each quantum, so other parts see their pin
    // changes with exact timestamps before advancing their own physics.
    const steppers = [...this.parts.values()]
      .filter((p) => p.model.step)
      .sort((a, b) => Number(!!b.manifest?.mcu) - Number(!!a.manifest?.mcu));
    while (this.timeNs < targetNs) {
      const start = this.timeNs;
      // A quantum ends early at the next scheduled part event, so that event
      // happens at exactly the right time for every microcontroller.
      const due = this.timers.length ? this.timers[0].at : Infinity;
      const next = Math.max(start, Math.min(targetNs, start + quantumNs, due));
      if (this.offload) {
        // Remote MCUs run this quantum in parallel; their outputs are applied in time order.
        // Their boards' own step() is then a no-op.
        this.offload.runQuantum(start, next);
      }
      for (const p of steppers) {
        this.timeNs = start;
        p.model.step!(next);
      }
      this.timeNs = next;
      this.runTimers(next);
      if (!steppers.length && !this.timers.length) {
        this.timeNs = Math.max(this.timeNs, targetNs);
        return;
      }
    }
  }

  /** Run scheduled callbacks that are due at or before `t`, in time order. */
  private runTimers(t: number): void {
    while (this.timers.length && this.timers[0].at <= t) {
      const timer = this.timers.shift()!;
      this.timeNs = Math.max(this.timeNs, timer.at);
      timer.fn();
    }
    this.timeNs = Math.max(this.timeNs, t);
  }

  private schedule(at: number, fn: () => void): Timer {
    const timer = { at: Math.max(at, this.timeNs), fn };
    // Keep the (usually tiny) list sorted; equal times run in the order scheduled.
    let i = this.timers.length;
    while (i > 0 && this.timers[i - 1].at > timer.at) i--;
    this.timers.splice(i, 0, timer);
    return timer;
  }

  input(partId: string, event: string, data?: unknown): void {
    this.parts.get(partId)?.model.input?.(event, data);
  }

  snapshot(): Snapshot {
    const states: Snapshot['states'] = {};
    for (const p of this.parts.values()) {
      const s = p.model.state?.();
      if (s) states[p.id] = s;
    }
    const events = this.events;
    this.events = [];
    return { timeNs: this.timeNs, states, events, warnings: [...this.warnings] };
  }

  /** Level seen on a part's pin (used by tests and tools). */
  level(partId: string, pin: string): Level {
    return levelOf(this.voltage(partId, pin));
  }

  /** Voltage seen on a part's pin (used by tests and tools). */
  voltage(partId: string, pin: string): number | null {
    const inst = this.parts.get(partId);
    const ps = inst?.pins.get(pin);
    if (ps) return ps.v;
    // Pins of passive parts (e.g. breadboard holes) are not tracked individually.
    const n = inst?.passive ? this.pinNet.get(key(partId, pin)) : undefined;
    return n === undefined ? null : toNull(this.nets.volts[n]);
  }

  // ───────────────────────────── internals ─────────────────────────────

  private makeContext(inst: Instance, props: Props, firmware?: string): PartContext {
    return {
      id: inst.id,
      props,
      firmware,
      now: () => this.timeNs,
      level: (pin) => levelOf(inst.pins.get(pin)?.v ?? null),
      voltage: (pin) => inst.pins.get(pin)?.v ?? null,
      invalidate: (topology = false) => {
        if (topology) this.topoDirty = true;
        this.solve();
      },
      advanceTime: (ns: number) => {
        this.timeNs = ns;
      },
      sendData: (pin, channel, value) => this.sendData(inst, pin, channel, value),
      emit: (event, data) => this.events.push({ part: inst.id, event, data }),
      peers: (pin) => this.peers(inst, pin),
      schedule: (atNs, fn) => {
        this.schedule(atNs, fn);
      },
      current: (id) => inst.elById?.get(id)?.amps ?? 0,
      warn: (message) => {
        this.warnings.add(message);
      },
      attachMcu: (descriptor, host) => (this.offload && firmware ? this.offload.attach(inst.id, descriptor, firmware, host) : undefined),
    };
  }

  /** Pins of other parts on the same net as `inst:pin` (transaction-level buses). */
  private peers(inst: Instance, pin: string): Peer[] {
    if (this.topoDirty) this.rebuildTopology();
    const n = this.pinNet.get(key(inst.id, pin));
    if (n === undefined) return [];
    return (this.netPins[n] ?? [])
      .filter((p) => !(p.inst === inst && p.pin === pin))
      .map((p) => ({ id: p.inst.id, pin: p.pin, model: p.inst.model }));
  }

  /** (Re)read a part's analog elements, reusing the records (and their state) when the structure is unchanged. */
  private readElements(inst: Instance): void {
    const m = inst.model;
    let list: AnalogElement[] | null = null;
    if (m.elements) list = m.elements() ?? [];
    else if (m.resistors) list = (m.resistors() ?? []).map(([a, b]) => ({ kind: 'R', a, b, ohms: K.LEGACY_OHMS }));
    if (!list) {
      inst.els = [];
      inst.elById = null;
      return;
    }
    const reuse = list.length === inst.els.length && list.every((e, i) => inst.els[i].matches(e));
    if (reuse) list.forEach((e, i) => inst.els[i].setValues(e));
    else inst.els = list.map((e) => new El(inst.id, e));
    inst.elById = null;
    for (const el of inst.els) if (el.id !== undefined) (inst.elById ??= new Map()).set(el.id, el);
  }

  private rebuildTopology(): void {
    // Bring every capacitor / inductor up to now under the old circuit first.
    this.touchAll();
    this.killClusters();

    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      // path compression
      for (let c = k; c !== r; ) {
        const n = parent.get(c)!;
        parent.set(c, r);
        c = n;
      }
      return r;
    };
    const add = (k: string) => {
      if (!parent.has(k)) parent.set(k, k);
    };
    const union = (a: string, b: string) => {
      add(a);
      add(b);
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const [a, b] of this.wires) union(a, b);
    this.analogParts = [];
    this.allEls = [];
    for (const inst of this.parts.values()) {
      for (const group of inst.manifest?.internal ?? []) {
        for (let i = 1; i < group.length; i++) union(key(inst.id, group[0]), key(inst.id, group[i]));
      }
      for (const [a, b] of inst.model.switches?.() ?? []) union(key(inst.id, a), key(inst.id, b));
      this.readElements(inst);
      if (inst.model.elements) this.analogParts.push(inst);
      for (const el of inst.els) {
        this.allEls.push(el);
        for (const pin of el.pins) add(key(inst.id, pin));
      }
    }

    // Group pins by net. Nets made only of passive pins (e.g. empty breadboard
    // columns) can never carry a voltage nor notify anyone: leave them out, so an
    // 830-hole breadboard costs nothing per solve.
    const byRoot = new Map<string, Array<{ k: string; inst: Instance; pin: string }>>();
    for (const k of parent.keys()) {
      const { part, pin } = splitEndpoint(k);
      const inst = this.parts.get(part);
      if (!inst) continue;
      const r = find(k);
      let list = byRoot.get(r);
      if (!list) byRoot.set(r, (list = []));
      list.push({ k, inst, pin });
    }
    this.pinNet.clear();
    this.netPins = [];
    this.netDrivers = [];
    this.drvNets = [];
    this.activePins = [];
    for (const list of byRoot.values()) {
      if (list.every((p) => p.inst.passive)) continue;
      const n = this.netPins.length;
      this.netPins.push(list.map(({ inst, pin }) => ({ inst, pin })));
      const drivers = list.filter((p) => p.inst.model.drive).map((p) => ({ model: p.inst.model, pin: p.pin }));
      this.netDrivers.push(drivers);
      if (drivers.length) this.drvNets.push(n);
      for (const p of list) this.pinNet.set(p.k, n);
    }
    // Same order as the pins were first seen, so parts are notified in a stable order.
    for (const k of parent.keys()) {
      const n = this.pinNet.get(k);
      if (n === undefined) continue;
      const { part, pin } = splitEndpoint(k);
      const inst = this.parts.get(part)!;
      if (inst.passive) continue;
      let ps = inst.pins.get(pin);
      if (!ps) inst.pins.set(pin, (ps = { v: null, told: undefined }));
      this.activePins.push({ key: k, net: n, ps, inst, pin });
    }

    const N = this.netPins.length;
    this.nets = emptyNets(N);
    this.strong = new Float64Array(N).fill(NaN);
    this.netAnalog = new Uint8Array(N);
    this.netDirty = new Uint8Array(N);
    this.netCluster = new Array(N).fill(null);
    this.fixedAdj = [];
    this.dirtyNets = [];
    this.dirtyClusters = [];

    // Element terminals → nets. A net whose only active pins are capacitor terminals is "cap only".
    const capPins = new Set<string>();
    this.resEdges = [];
    for (const inst of this.parts.values()) {
      for (const el of inst.els) {
        el.nets = el.pins.map((p) => this.pinNet.get(key(inst.id, p)) ?? -1);
        for (const n of el.nets) if (n >= 0) this.netAnalog[n] = 1;
        if (el.kind === KIND_C) for (const p of el.pins) capPins.add(key(inst.id, p));
        if (el.kind === KIND_R && el.nets[0] >= 0 && el.nets[1] >= 0 && el.nets[0] !== el.nets[1]) this.resEdges.push([el.nets[0], el.nets[1]]);
      }
    }
    if (capPins.size) {
      const other = new Uint8Array(N);
      for (const p of this.activePins) if (!capPins.has(p.key)) other[p.net] = 1;
      for (let n = 0; n < N; n++) {
        if (!other[n] && !this.netDrivers[n].length && this.netPins[n].some((p) => capPins.has(key(p.inst.id, p.pin)))) this.nets.capOnly[n] = 1;
      }
    }

    for (let n = 0; n < N; n++) this.markNet(n);
    this.clustersDirty = true;
    this.topoDirty = false;
  }

  // ───────────────────────────── analog ─────────────────────────────

  private markNet(n: number): void {
    if (this.netDirty[n]) return;
    this.netDirty[n] = 1;
    this.dirtyNets.push(n);
  }

  private markCluster(c: Cluster): void {
    if (c.dirty || c.dead) return;
    c.dirty = true;
    this.dirtyClusters.push(c);
  }

  /** Bring a reactive cluster's state up to now under its current (old) inputs, before they change. */
  private touch(c: Cluster): void {
    if (c.dead || !c.reactive) return;
    const now = this.timeNs;
    if (now <= c.t) return;
    if (!c.settled) c.integrate((now - c.t) * 1e-9);
    c.t = now;
  }

  private touchAll(): void {
    for (const c of this.clusters) this.touch(c);
  }

  private killClusters(): void {
    for (const c of this.clusters) {
      c.dead = true;
      this.cancelTick(c);
    }
    this.clusters = [];
    this.netCluster.fill(null);
    this.nets.local.fill(-1);
    this.fixedAdj = [];
    this.dirtyClusters = [];
  }

  private cancelTick(c: Cluster): void {
    if (!c.timer) return;
    const i = this.timers.indexOf(c.timer);
    if (i >= 0) this.timers.splice(i, 1);
    c.timer = null;
  }

  private scheduleTick(c: Cluster): void {
    this.cancelTick(c);
    const at = this.timeNs + Math.max(1, Math.round(c.hReport * 1e9));
    c.timer = this.schedule(at, () => this.tick(c));
  }

  /** Scheduled step of a reactive cluster: integrate to now, report, plan the next step. */
  private tick(c: Cluster): void {
    c.timer = null;
    if (c.dead) return;
    const now = this.timeNs;
    if (!c.settled && now > c.t) {
      const dt = (now - c.t) * 1e-9;
      c.integrate(dt);
      c.t = now;
      c.plan(dt);
    }
    if (!c.settled) this.scheduleTick(c);
    this.solve();
  }

  /** Read every net's drives into Norton sources / fixed voltages; mark what changed. */
  private pollDrives(): void {
    const nets = this.nets;
    for (const n of this.drvNets) {
      let stiff = NaN;
      let strong = NaN;
      let g = 0;
      let cur = 0;
      let short = 0;
      for (const d of this.netDrivers[n]) {
        const dr = d.model.drive!(d.pin);
        let v: number;
        let ohms: number;
        if (dr === 'z') continue;
        else if (dr === 'high') (v = VCC), (ohms = K.PIN_OHMS);
        else if (dr === 'low') (v = 0), (ohms = K.PIN_OHMS);
        else if (typeof dr === 'number') {
          if (dr !== dr) continue;
          (v = dr), (ohms = 0);
        } else if (dr === 'pullup') (v = VCC), (ohms = K.PULL_OHMS);
        else if (dr === 'pulldown') (v = 0), (ohms = K.PULL_OHMS);
        else if (dr && typeof dr === 'object' && Number.isFinite(dr.volts)) {
          v = dr.volts;
          ohms = dr.ohms !== undefined && dr.ohms > 0 ? dr.ohms : 0;
        } else continue;
        if (ohms < K.STRONG_OHMS) {
          if (strong !== strong) strong = v;
          else if (Math.abs(strong - v) > 0.05) short = 1;
        }
        if (ohms <= 0) {
          if (stiff !== stiff) stiff = v;
        } else {
          g += 1 / ohms;
          cur += v / ohms;
        }
      }
      const oldFixed = nets.fixed[n];
      if (same(oldFixed, stiff) && same(this.strong[n], strong) && nets.g[n] === g && nets.i[n] === cur && nets.short[n] === short) continue;
      if (this.netAnalog[n] && !this.clustersDirty) {
        if ((oldFixed !== oldFixed) !== (stiff !== stiff)) {
          // A net became fixed / stopped being fixed: the clusters split differently.
          this.touchAll();
          this.clustersDirty = true;
        } else if (stiff === stiff) {
          if (!same(oldFixed, stiff)) {
            for (const c of this.fixedAdj[n] ?? []) {
              this.touch(c);
              this.markCluster(c);
            }
          }
        } else {
          const c = this.netCluster[n];
          if (c) {
            this.touch(c);
            this.markCluster(c);
          }
        }
      }
      nets.fixed[n] = stiff;
      this.strong[n] = strong;
      nets.g[n] = g;
      nets.i[n] = cur;
      nets.short[n] = short;
      this.markNet(n);
    }
  }

  /** Re-read `elements()` of analog parts; touch and mark the clusters whose values changed. */
  private pollElements(): void {
    for (const inst of this.analogParts) {
      const list = inst.model.elements!() ?? [];
      const els = inst.els;
      if (list.length !== els.length) {
        this.topoDirty = true;
        return;
      }
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const el = els[i];
        if (!el.matches(e)) {
          this.topoDirty = true;
          return;
        }
        if (!el.setValues(e, false)) continue;
        const c = el.cluster;
        if (c && !this.clustersDirty) {
          this.touch(c);
          this.markCluster(c);
        }
        el.setValues(e);
      }
    }
  }

  /** Split the analog nets into clusters (connected through elements, cut at fixed nets). */
  private buildClusters(): void {
    this.killClusters();
    const nets = this.nets;
    const N = this.netPins.length;
    const parent = new Int32Array(N);
    for (let i = 0; i < N; i++) parent[i] = i;
    const find = (a: number): number => {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    };
    const isFixed = (n: number) => nets.fixed[n] === nets.fixed[n];
    const used: El[] = [];
    for (const el of this.allEls) {
      el.cluster = null;
      const ns = el.nets;
      if (ns.some((n) => n < 0) || ns.every((n) => n === ns[0])) continue;
      used.push(el);
      let first = -1;
      for (const n of ns) {
        if (isFixed(n)) continue;
        if (first < 0) first = n;
        else {
          const a = find(first);
          const b = find(n);
          if (a !== b) parent[a] = b;
        }
      }
    }
    const groups = new Map<number, { nodes: number[]; els: El[] }>();
    const solo: Array<{ nodes: number[]; els: El[] }> = [];
    const seen = new Uint8Array(N);
    for (const el of used) {
      const free = el.nets.filter((n) => !isFixed(n));
      if (!free.length) {
        solo.push({ nodes: [], els: [el] });
        continue;
      }
      const r = find(free[0]);
      let g = groups.get(r);
      if (!g) groups.set(r, (g = { nodes: [], els: [] }));
      g.els.push(el);
      for (const n of free) {
        if (seen[n]) continue;
        seen[n] = 1;
        g.nodes.push(n);
      }
    }
    const onShort = (el: El, amps: number) => this.shortWarning(el, amps);
    for (const g of [...groups.values(), ...solo]) {
      g.nodes.forEach((n, li) => (nets.local[n] = li));
      const c = new Cluster(nets, g.nodes, g.els, onShort);
      for (const el of g.els) {
        el.nets.forEach((n, k) => {
          if (!isFixed(n)) {
            el.lt[k] = nets.local[n];
            return;
          }
          el.lt[k] = -1;
          const adj = (this.fixedAdj[n] ??= []);
          if (adj[adj.length - 1] !== c) adj.push(c);
        });
      }
      c.t = this.timeNs;
      c.dirty = false;
      for (const n of g.nodes) this.netCluster[n] = c;
      this.clusters.push(c);
      this.markCluster(c);
      for (const n of g.nodes) this.markNet(n);
    }
    this.clustersDirty = false;
  }

  private shortWarning(el: El, amps: number): void {
    const where = `${el.owner} (${el.pins.join('–')})`;
    if (!Number.isFinite(amps)) this.warnings.add(`Short circuit: voltage sources fighting through ${where}`);
    else this.warnings.add(`Short circuit: ${Math.abs(amps) >= 10 ? Math.round(Math.abs(amps)) : Math.abs(amps).toFixed(1)} A through ${where}`);
  }

  private netShortWarning(n: number): void {
    const names = this.netPins[n].map((p) => `${p.inst.id}:${p.pin}`).join(', ');
    this.warnings.add(`Short circuit: different voltages driven together on net [${names}]`);
  }

  /** Voltage of a net that is not part of a cluster (fast path). */
  private fastVolts(n: number): number {
    const nets = this.nets;
    if (nets.short[n]) return NaN;
    const stiff = nets.fixed[n];
    if (stiff === stiff) return stiff;
    const strong = this.strong[n];
    if (strong === strong) return strong;
    return nets.g[n] > 0 ? nets.i[n] / nets.g[n] : NaN;
  }

  private solveDirty(): void {
    const nets = this.nets;
    for (const n of this.dirtyNets) {
      this.netDirty[n] = 0;
      if (nets.short[n]) this.netShortWarning(n);
      if (!this.netCluster[n]) nets.volts[n] = this.fastVolts(n);
    }
    this.dirtyNets.length = 0;
    for (let i = 0; i < this.dirtyClusters.length; i++) {
      const c = this.dirtyClusters[i];
      if (c.dead) continue;
      c.dirty = false;
      if (!c.reactive) c.solveStatic();
      else {
        this.touch(c);
        c.solveEvent();
        c.t = this.timeNs;
        if (c.settled) this.cancelTick(c);
        else this.scheduleTick(c);
      }
    }
    this.dirtyClusters.length = 0;
  }

  private solve(): void {
    if (this.solving) {
      this.solveAgain = true;
      return;
    }
    this.solving = true;
    try {
      for (let round = 0; ; round++) {
        this.solveAgain = false;
        for (let i = 0; i < 4; i++) {
          if (this.topoDirty) this.rebuildTopology();
          this.pollDrives();
          this.pollElements();
          if (!this.topoDirty) break;
        }
        if (this.clustersDirty) this.buildClusters();
        this.solveDirty();
        const volts = this.nets.volts;
        const changes: Array<{ inst: Instance; pin: string; level: Level }> = [];
        for (const p of this.activePins) {
          // Parts always read the latest voltage, but are only notified of changes above EPS.
          const v = toNull(volts[p.net]);
          const ps = p.ps;
          ps.v = v;
          const old = ps.told;
          const same = old === undefined ? false : old === null || v === null ? old === v : Math.abs(old - v) <= EPS;
          if (!same) {
            ps.told = v;
            changes.push({ inst: p.inst, pin: p.pin, level: levelOf(v) });
          }
        }
        for (const c of changes) c.inst.model.onPinChange?.(c.pin, c.level);
        // Stable: nothing changed and no part asked for another pass.
        if (!changes.length && !this.solveAgain && !this.topoDirty) break;
        if (round >= MAX_ROUNDS) {
          this.warnings.add('Circuit is oscillating (did not settle after 50 iterations).');
          break;
        }
      }
    } finally {
      this.solving = false;
    }
  }

  private sendData(from: Instance, pin: string, channel: string, value: number): void {
    const start = this.pinNet.get(key(from.id, pin));
    if (start === undefined) return;
    // Breadth-first over the net and anything linked to it through resistors.
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift()!;
      for (const p of this.netPins[n]) {
        if (p.inst === from && p.pin === pin) continue;
        p.inst.model.onData?.(p.pin, channel, value);
      }
      for (const [a, b] of this.resEdges) {
        const o = a === n ? b : b === n ? a : -1;
        if (o >= 0 && !seen.has(o)) {
          seen.add(o);
          queue.push(o);
        }
      }
    }
  }
}
