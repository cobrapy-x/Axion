// SPDX-License-Identifier: Apache-2.0
/**
 * The simulation engine. It has no DOM dependencies, so it runs inside a
 * Web Worker in the app and directly inside Node for tests.
 *
 * Electrical model (deliberately simple and fast — "voltages with drive strengths"):
 *  1. Wires, internal part connections and closed switches join pins into *nets*
 *     (union-find).
 *  2. Each pin applies a Drive: a strong voltage ('high' = 5 V, 'low' = 0 V, or any
 *     number), a weak pull-up / pull-down, or nothing ('z'). Per net, strong beats
 *     weak; two strong drives with different voltages are a short circuit.
 *  3. Resistors link nets weakly: a net with no strong drive takes the voltage of a
 *     strongly driven neighbour through a resistor, which in turn beats an MCU's
 *     internal pull-up (matching how a real 10k pull-down beats a ~35k pull-up).
 *  4. Event-driven: the circuit is re-solved only when a part reports a change
 *     (`invalidate`). Parts whose pin level/voltage changed are notified, and the
 *     solve repeats until nothing changes, so signals ripple through behavioural
 *     parts (e.g. MCU pin → motor driver input → motor driver output → motor).
 *
 * Multiple MCUs are advanced in small time quanta (default 50 µs of simulated
 * time) so they stay in lock-step with each other.
 */
import type { Diagram } from './diagram';
import { splitEndpoint } from './diagram';
import { VCC, levelOf } from './types';
import type { Level, ModelFactory, PartContext, PartManifest, PartModel, Props } from './types';

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
  /** No model hooks at all (breadboards, unknown parts): its pins never drive or listen. */
  passive: boolean;
}

/** A pin whose part has a model: its voltage is tracked and reported on change. */
interface ActivePin {
  key: string;
  net: number;
  inst: Instance;
  pin: string;
}

const key = (part: string, pin: string) => `${part}:${pin}`;

const MODEL_HOOKS: Array<keyof PartModel> = ['drive', 'switches', 'resistors', 'onPinChange', 'onData', 'step', 'input', 'state'];

const PRIO_STRONG = 4;
const PRIO_RES_STRONG = 3;
const PRIO_PULL = 2;
const PRIO_RES_WEAK = 1;
/** Voltage differences below this are considered equal. */
const EPS = 0.01;
const MAX_ROUNDS = 50;

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
  private activePins: ActivePin[] = [];
  private resEdges: Array<[number, number]> = [];

  // Solved state
  private netVolts: Array<number | null> = [];
  private pinVolts = new Map<string, number | null>();
  private shorts = new Set<string>();
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
    this.pinVolts.clear();

    for (const p of diagram.parts) {
      const type = this.types.get(p.type);
      if (!type) this.warnings.add(`Part type "${p.type}" (${p.id}) is not supported yet; treated as passive.`);
      const props: Props = {};
      for (const [k, spec] of Object.entries(type?.manifest.props ?? {})) props[k] = spec.default;
      for (const [k, v] of Object.entries(p.attrs ?? {})) {
        const spec = type?.manifest.props?.[k];
        props[k] = spec?.type === 'number' ? Number(v) : spec?.type === 'boolean' ? v === 'true' || v === '1' : v;
      }
      const inst: Instance = { id: p.id, manifest: type?.manifest, model: {}, passive: true };
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
    return levelOf(this.voltage(partId, pin));
  }

  /** Voltage seen on a part's pin (used by tests and tools). */
  voltage(partId: string, pin: string): number | null {
    const k = key(partId, pin);
    if (this.pinVolts.has(k)) return this.pinVolts.get(k)!;
    // Pins of passive parts (e.g. breadboard holes) are not tracked individually.
    const n = this.parts.get(partId)?.passive ? this.pinNet.get(k) : undefined;
    return n === undefined ? null : this.netVolts[n] ?? null;
  }

  // ───────────────────────────── internals ─────────────────────────────

  private makeContext(inst: Instance, props: Props, firmware?: string): PartContext {
    return {
      id: inst.id,
      props,
      firmware,
      now: () => this.timeNs,
      level: (pin) => levelOf(this.pinVolts.get(key(inst.id, pin)) ?? null),
      voltage: (pin) => this.pinVolts.get(key(inst.id, pin)) ?? null,
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
    this.activePins = [];
    for (const list of byRoot.values()) {
      if (list.every((p) => p.inst.passive)) continue;
      const n = this.netPins.length;
      this.netPins.push(list.map(({ inst, pin }) => ({ inst, pin })));
      this.netDrivers.push(list.filter((p) => p.inst.model.drive).map((p) => ({ model: p.inst.model, pin: p.pin })));
      for (const p of list) this.pinNet.set(p.k, n);
    }
    // Same order as the pins were first seen, so parts are notified in a stable order.
    for (const k of parent.keys()) {
      const n = this.pinNet.get(k);
      if (n === undefined) continue;
      const { part, pin } = splitEndpoint(k);
      const inst = this.parts.get(part)!;
      if (!inst.passive) this.activePins.push({ key: k, net: n, inst, pin });
    }
    this.resEdges = resPairs
      .map(([a, b]) => [this.pinNet.get(a)!, this.pinNet.get(b)!] as [number, number])
      .filter(([a, b]) => a !== b);
    this.topoDirty = false;
  }

  private computeVoltages(): void {
    const nNets = this.netPins.length;
    const volts: Array<number | null> = new Array(nNets).fill(null);
    const prio: number[] = new Array(nNets).fill(0);
    const conflict: boolean[] = new Array(nNets).fill(false);
    this.shorts.clear();

    for (let n = 0; n < nNets; n++) {
      let strong: number | null = null;
      let shorted = false;
      let wH = false;
      let wL = false;
      for (const { model, pin } of this.netDrivers[n]) {
        const d = model.drive!(pin);
        const v = d === 'high' ? VCC : d === 'low' ? 0 : typeof d === 'number' ? d : null;
        if (v !== null) {
          if (strong === null) strong = v;
          else if (Math.abs(strong - v) > 0.05) shorted = true;
        } else if (d === 'pullup') wH = true;
        else if (d === 'pulldown') wL = true;
      }
      if (shorted) {
        conflict[n] = true;
        prio[n] = PRIO_STRONG;
        const names = this.netPins[n].map((p) => `${p.inst.id}:${p.pin}`).join(', ');
        this.shorts.add(`Short circuit: different voltages driven together on net [${names}]`);
      } else if (strong !== null) {
        volts[n] = strong;
        prio[n] = PRIO_STRONG;
      } else if (wH !== wL) {
        volts[n] = wH ? VCC : 0;
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
            volts[to] = volts[from];
            conflict[to] = false;
            changed = true;
          } else if (p === prio[to] && !conflict[to] && volts[to] !== null && Math.abs(volts[to]! - volts[from]!) > EPS) {
            // Two sources through resistors (a voltage divider): we don't model the ratio yet.
            conflict[to] = true;
            volts[to] = null;
            changed = true;
          }
        }
      }
    }
    this.netVolts = volts;
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
        if (this.topoDirty) this.rebuildTopology();
        this.computeVoltages();
        const changes: Array<{ inst: Instance; pin: string; level: Level }> = [];
        for (const p of this.activePins) {
          const v = this.netVolts[p.net];
          const old = this.pinVolts.get(p.key);
          const same = old === undefined ? false : old === null || v === null ? old === v : Math.abs(old - v) <= EPS;
          if (!same) {
            this.pinVolts.set(p.key, v);
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
      for (const s of this.shorts) this.warnings.add(s);
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
