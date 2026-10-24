// SPDX-License-Identifier: Apache-2.0
/**
 * The simulation engine. It has no DOM dependencies, so it runs inside a
 * Web Worker in the app and directly inside Node for tests.
 *
 * Electrical model (deliberately simple and fast — "digital with strengths"):
 *  1. Wires, internal part connections and closed switches join pins into *nets*
 *     (union-find).
 *  2. Each pin applies a Drive. Per net: strong drives win; a strong HIGH and a
 *     strong LOW on the same net is a short circuit.
 *  3. Resistors link nets weakly: a net with no strong drive takes the value of a
 *     strongly driven neighbour through a resistor, which in turn beats an MCU's
 *     internal pull-up (matching how a real 10k pull-down beats a ~35k pull-up).
 *  4. Whenever a part reports a change (`invalidate`) the circuit is re-solved
 *     immediately and parts whose pin levels changed are notified. This is
 *     event-driven: nothing is computed while no pin changes.
 *
 * Multiple MCUs are advanced in small time quanta (default 50 µs of simulated
 * time) so they stay in lock-step with each other.
 */
import type { Diagram } from './diagram';
import { splitEndpoint } from './diagram';
import type { Drive, Level, ModelFactory, PartContext, PartManifest, PartModel, Props } from './types';

export interface PartType {
  manifest: PartManifest;
  model?: ModelFactory;
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
  pins: Set<string>;
}

const key = (part: string, pin: string) => `${part}:${pin}`;

const PRIO_STRONG = 4;
const PRIO_RES_STRONG = 3;
const PRIO_PULL = 2;
const PRIO_RES_WEAK = 1;

export class Engine {
  private parts = new Map<string, Instance>();
  private wires: Array<[string, string]> = [];
  private timeNs = 0;

  // Topology (rebuilt when wires or switches change)
  private topoDirty = true;
  private pinNet = new Map<string, number>();
  private netPins: Array<Array<{ inst: Instance; pin: string }>> = [];
  private resEdges: Array<[number, number]> = [];

  // Solved state
  private netLevel: Level[] = [];
  private pinLevel = new Map<string, Level>();
  private solving = false;
  private solveAgain = false;

  private events: SimEvent[] = [];
  private warnings = new Set<string>();

  constructor(private types: Map<string, PartType>) {}

  get time(): number {
    return this.timeNs;
  }

  load(diagram: Diagram, firmware: Record<string, string> = {}): void {
    this.parts.clear();
    this.wires = [];
    this.timeNs = 0;
    this.events = [];
    this.warnings.clear();
    this.pinLevel.clear();

    for (const p of diagram.parts) {
      const type = this.types.get(p.type);
      if (!type) this.warnings.add(`Part type "${p.type}" (${p.id}) is not supported yet; treated as passive.`);
      const props: Props = {};
      for (const [k, spec] of Object.entries(type?.manifest.props ?? {})) props[k] = spec.default;
      for (const [k, v] of Object.entries(p.attrs ?? {})) {
        const spec = type?.manifest.props?.[k];
        props[k] = spec?.type === 'number' ? Number(v) : spec?.type === 'boolean' ? v === 'true' || v === '1' : v;
      }
      const inst: Instance = { id: p.id, manifest: type?.manifest, model: {}, pins: new Set() };
      this.parts.set(p.id, inst);
      const ctx = this.makeContext(inst, props, firmware[p.id]);
      inst.model = type?.model ? type.model(ctx) : {};
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
    const steppers = [...this.parts.values()].filter((p) => p.model.step);
    if (steppers.length === 0) {
      this.timeNs = Math.max(this.timeNs, targetNs);
      return;
    }
    while (this.timeNs < targetNs) {
      const start = this.timeNs;
      const next = Math.min(targetNs, start + quantumNs);
      for (const p of steppers) {
        this.timeNs = start;
        p.model.step!(next);
      }
      this.timeNs = next;
    }
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
    return this.pinLevel.get(key(partId, pin)) ?? null;
  }

  // ───────────────────────────── internals ─────────────────────────────

  private makeContext(inst: Instance, props: Props, firmware?: string): PartContext {
    return {
      id: inst.id,
      props,
      firmware,
      now: () => this.timeNs,
      level: (pin) => this.pinLevel.get(key(inst.id, pin)) ?? null,
      invalidate: (topology = false) => {
        if (topology) this.topoDirty = true;
        this.solve();
      },
      advanceTime: (ns: number) => {
        this.timeNs = ns;
      },
      sendData: (pin, channel, value) => this.sendData(inst, pin, channel, value),
      emit: (event, data) => this.events.push({ part: inst.id, event, data }),
    };
  }

  private rebuildTopology(): void {
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
    const resPairs: Array<[string, string]> = [];
    for (const inst of this.parts.values()) {
      for (const group of inst.manifest?.internal ?? []) {
        for (let i = 1; i < group.length; i++) union(key(inst.id, group[0]), key(inst.id, group[i]));
      }
      for (const [a, b] of inst.model.switches?.() ?? []) union(key(inst.id, a), key(inst.id, b));
      for (const [a, b] of inst.model.resistors?.() ?? []) {
        add(key(inst.id, a));
        add(key(inst.id, b));
        resPairs.push([key(inst.id, a), key(inst.id, b)]);
      }
    }

    const rootIndex = new Map<string, number>();
    this.pinNet.clear();
    this.netPins = [];
    for (const k of parent.keys()) {
      const r = find(k);
      let n = rootIndex.get(r);
      if (n === undefined) {
        n = this.netPins.length;
        rootIndex.set(r, n);
        this.netPins.push([]);
      }
      this.pinNet.set(k, n);
      const { part, pin } = splitEndpoint(k);
      const inst = this.parts.get(part);
      if (inst) {
        inst.pins.add(pin);
        this.netPins[n].push({ inst, pin });
      }
    }
    this.resEdges = resPairs
      .map(([a, b]) => [this.pinNet.get(a)!, this.pinNet.get(b)!] as [number, number])
      .filter(([a, b]) => a !== b);
    this.topoDirty = false;
  }

  private computeLevels(): void {
    const nNets = this.netPins.length;
    const value: Level[] = new Array(nNets).fill(null);
    const prio: number[] = new Array(nNets).fill(0);
    const conflict: boolean[] = new Array(nNets).fill(false);

    for (let n = 0; n < nNets; n++) {
      let sH = false, sL = false, wH = false, wL = false;
      for (const { inst, pin } of this.netPins[n]) {
        const d: Drive = inst.model.drive?.(pin) ?? 'z';
        if (d === 'high') sH = true;
        else if (d === 'low') sL = true;
        else if (d === 'pullup') wH = true;
        else if (d === 'pulldown') wL = true;
      }
      if (sH && sL) {
        conflict[n] = true;
        prio[n] = PRIO_STRONG;
        const names = this.netPins[n].map((p) => `${p.inst.id}:${p.pin}`).join(', ');
        this.warnings.add(`Short circuit: HIGH and LOW driven together on net [${names}]`);
      } else if (sH || sL) {
        value[n] = sH ? 1 : 0;
        prio[n] = PRIO_STRONG;
      } else if (wH !== wL) {
        value[n] = wH ? 1 : 0;
        prio[n] = PRIO_PULL;
      }
    }

    // Propagate through resistors until stable.
    for (let iter = 0, changed = true; changed && iter <= nNets; iter++) {
      changed = false;
      for (const [a, b] of this.resEdges) {
        for (const [from, to] of [[a, b], [b, a]] as const) {
          if (prio[from] === 0 || conflict[from] || prio[to] === PRIO_STRONG) continue;
          const p = prio[from] === PRIO_STRONG ? PRIO_RES_STRONG : PRIO_RES_WEAK;
          if (p > prio[to]) {
            prio[to] = p;
            value[to] = value[from];
            conflict[to] = false;
            changed = true;
          } else if (p === prio[to] && value[to] !== value[from] && !conflict[to]) {
            conflict[to] = true; // e.g. a voltage divider: undefined logic level
            value[to] = null;
            changed = true;
          }
        }
      }
    }
    this.netLevel = value;
  }

  private solve(): void {
    if (this.solving) {
      this.solveAgain = true;
      return;
    }
    this.solving = true;
    try {
      let rounds = 0;
      do {
        this.solveAgain = false;
        if (this.topoDirty) this.rebuildTopology();
        this.computeLevels();
        const changes: Array<{ inst: Instance; pin: string; level: Level }> = [];
        for (const [k, n] of this.pinNet) {
          const lvl = this.netLevel[n];
          if (this.pinLevel.get(k) !== lvl) {
            this.pinLevel.set(k, lvl);
            const { part, pin } = splitEndpoint(k);
            const inst = this.parts.get(part);
            if (inst) changes.push({ inst, pin, level: lvl });
          }
        }
        for (const c of changes) c.inst.model.onPinChange?.(c.pin, c.level);
        if (++rounds > 50) {
          this.warnings.add('Circuit is oscillating (did not settle after 50 iterations).');
          break;
        }
      } while (this.solveAgain || this.topoDirty);
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
