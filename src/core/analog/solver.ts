// SPDX-License-Identifier: Apache-2.0
/**
 * Modified Nodal Analysis for one *cluster*: a group of nets linked by analog
 * elements (see docs/SOLVER.md). Nets driven by a stiff source (a battery, a 5V pin,
 * GND) are *fixed*: they are known voltages at the edge of a cluster, not unknowns,
 * so a circuit splits into many tiny clusters (an LED + resistor on a pin is 2 nodes).
 *
 * - Linear elements are stamped directly; digital drives are Norton sources.
 * - Diodes, BJTs and FETs are piecewise linear. Their state (off / on / …) is
 *   iterated until consistent, starting from the previous solution.
 * - Capacitors and inductors use backward-Euler companion models. A reactive cluster
 *   integrates itself between reports with an adaptive internal step (local
 *   truncation error control); the engine only decides *when* to report.
 * - Everything is preallocated per cluster: a solve allocates nothing.
 */
import type { AnalogElement } from '../types';
import * as K from './constants';

export const R = 0;
export const C = 1;
export const L = 2;
export const V = 3;
export const D = 4;
export const SW = 5;
export const BJT = 6;
export const FET = 7;

const KIND: Record<AnalogElement['kind'], number> = { R, C, L, V, D, SW, BJT, FET };

/** Engine-wide per-net arrays shared with the clusters. */
export interface Nets {
  /** Norton conductance / current of the digital drives on each net. */
  g: Float64Array;
  i: Float64Array;
  /** Voltage of a stiff source on the net (fixed net), or NaN. */
  fixed: Float64Array;
  /** Two strong drives disagree on this net (reported as null). */
  short: Uint8Array;
  /** Only capacitor terminals on this net: a capacitor alone does not hold it. */
  capOnly: Uint8Array;
  /** Index of the net inside its cluster, or -1. */
  local: Int32Array;
  /** Solved voltage, NaN = floating. */
  volts: Float64Array;
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Terminal pin names of an element in the solver's order (R/C/L/SW: a b · V: p n · D: anode cathode · BJT: b c e · FET: g d s). */
export function terminals(e: AnalogElement): string[] {
  switch (e.kind) {
    case 'V':
      return [e.p, e.n];
    case 'D':
      return [e.anode, e.cathode];
    case 'BJT':
      return [e.b, e.c, e.e];
    case 'FET':
      return [e.g, e.d, e.s];
    default:
      return [e.a, e.b];
  }
}

/** One analog element, with its parameters, nonlinear state and results. */
export class El {
  readonly kind: number;
  readonly pins: string[];
  id: string | undefined;
  /** Net of each terminal (set by the engine). */
  nets: number[] = [];
  /** Local node index of each terminal in its cluster; -1 = fixed net. */
  lt = new Int32Array(3);
  /** Per solve: matrix index of each terminal (-1 = known voltage `tv`, NaN = floating). */
  ti = new Int32Array(3);
  tv = new Float64Array(3);
  skip = false;

  // Parameters (meaning depends on the kind)
  g = 0;
  p1 = 0;
  p2 = 0;
  ideal = false;
  closed = true;

  /** Nonlinear state: D 0 off / 1 on / 2 reverse breakdown · BJT 0 cutoff / 1 active / 2 saturated · FET 0 / 1. */
  state = 0;
  /** Reactive state: C voltage a→b, L current a→b; and its time derivative. */
  x = 0;
  d = 0;
  xs = 0;
  ds = 0;
  dRep = 0;
  /** MNA row of an ideal voltage source. */
  row = -1;

  /** Results: current (see AnalogElement), BJT base current. */
  amps = 0;
  /** Above this current the element is reported (see AnalogElement.maxAmps). */
  readonly maxAmps: number;
  /** maxAmps is a rating given by the part (report "overcurrent", not "short circuit"). */
  readonly rated: boolean;
  ib = 0;
  cluster: Cluster | null = null;

  constructor(
    readonly owner: string,
    e: AnalogElement,
  ) {
    this.kind = KIND[e.kind];
    this.pins = terminals(e);
    this.id = e.id;
    const max = e.maxAmps;
    this.rated = typeof max === 'number' && max > 0;
    this.maxAmps = this.rated ? max! : K.SHORT_AMPS;
    this.setValues(e);
  }

  /** Same kind and pins as `e` (so this record can be reused). */
  matches(e: AnalogElement): boolean {
    if (KIND[e.kind] !== this.kind) return false;
    const p = this.pins;
    switch (e.kind) {
      case 'V':
        return e.p === p[0] && e.n === p[1];
      case 'D':
        return e.anode === p[0] && e.cathode === p[1];
      case 'BJT':
        return e.b === p[0] && e.c === p[1] && e.e === p[2];
      case 'FET':
        return e.g === p[0] && e.d === p[1] && e.s === p[2];
      default:
        return e.a === p[0] && e.b === p[1];
    }
  }

  /** Read parameter values (only compare them when `apply` is false). Returns true if any changed. */
  setValues(e: AnalogElement, apply = true): boolean {
    let g = this.g;
    let p1 = this.p1;
    let p2 = this.p2;
    let ideal = this.ideal;
    let closed = this.closed;
    switch (e.kind) {
      case 'R': {
        const ohms = num(e.ohms, NaN);
        g = ohms > 0 ? 1 / Math.max(ohms, 1e-4) : ohms === 0 ? 1e4 : 0;
        break;
      }
      case 'C':
        p1 = Math.max(0, num(e.farads));
        break;
      case 'L':
        p1 = Math.max(1e-12, num(e.henries, 1e-12));
        break;
      case 'V': {
        p1 = num(e.volts);
        const ohms = num(e.ohms);
        ideal = !(ohms > 0);
        g = ideal ? 0 : 1 / Math.max(ohms, 1e-6);
        break;
      }
      case 'D':
        p1 = num(e.vf, 0.7);
        g = 1 / Math.max(1e-3, num(e.ohms, K.DIODE_OHMS));
        p2 = num(e.zener) > 0 ? num(e.zener) : 0;
        break;
      case 'SW':
        closed = !!e.closed;
        g = 1 / Math.max(1e-6, num(e.ohms, K.SW_OHMS));
        break;
      case 'BJT':
        p1 = Math.max(1, num(e.beta, K.BJT_BETA));
        p2 = e.type === 'pnp' ? -1 : 1;
        break;
      case 'FET':
        p1 = Math.abs(num(e.vth, 2));
        g = 1 / Math.max(1e-6, num(e.rdsOn, K.FET_OHMS));
        p2 = e.type === 'p' ? -1 : 1;
        break;
    }
    if (g === this.g && p1 === this.p1 && p2 === this.p2 && ideal === this.ideal && closed === this.closed) return false;
    if (!apply) return true;
    this.g = g;
    this.p1 = p1;
    this.p2 = p2;
    this.ideal = ideal;
    this.closed = closed;
    return true;
  }
}

/** Terminal index pairs that form an edge between nets (for connectivity). */
const EDGES: number[][] = [];
EDGES[R] = EDGES[C] = EDGES[L] = EDGES[V] = EDGES[D] = EDGES[SW] = [0, 1];
EDGES[BJT] = [0, 2, 1, 2];
EDGES[FET] = [1, 2];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export type ShortHandler = (el: El, amps: number) => void;

export class Cluster {
  readonly reactive: boolean;
  readonly nonlinear: boolean;
  /** Inputs changed: needs a solve. */
  dirty = true;
  /** Replaced by a rebuild. */
  dead = false;

  // Time stepping (reactive clusters)
  /** Time (ns) of the stored reactive state. */
  t = 0;
  settled = true;
  /** Planned internal step and report interval (s). */
  hStep = K.H_MIN;
  hReport = K.REPORT_MIN;
  timer: { at: number; fn: () => void } | null = null;

  private readonly n: number;
  private readonly cap: number;
  private m = 0;
  private readonly mIdx: Int32Array;
  private readonly flag: Uint8Array;
  private readonly A: Float64Array;
  private readonly b: Float64Array;
  private readonly x: Float64Array;
  private readonly vNode: Float64Array;
  private readonly vPrev: Float64Array;
  private readonly react: El[];
  private readonly nl: El[];
  private singular = false;
  /** Largest node voltage rate in the last integration (V/s). */
  private rate = 0;

  constructor(
    private readonly nets: Nets,
    readonly nodes: number[],
    readonly els: El[],
    private readonly onShort: ShortHandler,
  ) {
    this.n = nodes.length;
    let nV = 0;
    for (const el of els) if (el.kind === V && el.ideal) nV++;
    // Room for ideal sources that become non-ideal / ideal later: count all V elements.
    for (const el of els) if (el.kind === V && !el.ideal) nV++;
    this.cap = this.n + nV;
    this.mIdx = new Int32Array(this.n);
    this.flag = new Uint8Array(this.n);
    this.A = new Float64Array(this.cap * this.cap);
    this.b = new Float64Array(this.cap);
    this.x = new Float64Array(this.cap);
    this.vNode = new Float64Array(this.n).fill(NaN);
    this.vPrev = new Float64Array(this.n).fill(NaN);
    this.react = els.filter((e) => e.kind === C || e.kind === L);
    this.nl = els.filter((e) => e.kind === D || e.kind === BJT || e.kind === FET);
    this.reactive = this.react.length > 0;
    this.nonlinear = this.nl.length > 0;
    for (const el of els) el.cluster = this;
  }

  // ─────────────────────────────── public ───────────────────────────────

  /** Solve a cluster without capacitors / inductors. */
  solveStatic(): void {
    this.prepare();
    this.iterate(0);
    this.finish();
  }

  /**
   * Solve right after an input changed, holding capacitor voltages and inductor
   * currents (a tiny backward-Euler step), and plan the first integration step.
   */
  solveEvent(): void {
    this.prepare();
    this.save();
    this.iterate(K.H_EVENT);
    this.commit(K.H_EVENT);
    this.finish();
    let h = K.H_MAX;
    for (const el of this.react) {
      if (el.skip) continue;
      const rate = Math.abs(el.d);
      const tol = el.kind === C ? 0.02 : 2e-4 + 0.01 * Math.abs(el.x);
      if (rate > 0) h = Math.min(h, tol / rate);
      el.dRep = el.d;
    }
    this.hStep = clamp(h, K.H_MIN, K.H_MAX);
    this.hReport = clamp(h, K.REPORT_MIN, K.REPORT_MAX);
    this.settled = this.quiet(0);
  }

  /** Advance the reactive state by `seconds` with the current inputs (adaptive sub-steps). */
  integrate(seconds: number): void {
    if (!(seconds > 0)) return;
    this.prepare();
    let remaining = seconds;
    let rate = 0;
    for (let guard = 0; remaining > 0 && guard < 50_000; guard++) {
      let h = Math.min(this.hStep, remaining);
      if (remaining - h < 0.2 * h) h = remaining;
      this.save();
      this.iterate(h);
      const r = this.commit(h);
      if (r > 4 && h > K.H_MIN * 1.01) {
        this.restore();
        this.hStep = Math.max(K.H_MIN, h * Math.max(0.2, 0.9 / Math.sqrt(r)));
        continue;
      }
      remaining -= h;
      const f = Math.min(2, 0.9 / Math.sqrt(Math.max(r, 1e-8)));
      if (h >= this.hStep * 0.999) this.hStep = clamp(h * f, K.H_MIN, K.H_MAX);
      else if (f < 1) this.hStep = clamp(Math.min(this.hStep, h * f), K.H_MIN, K.H_MAX);
      rate = this.nodeRate(h);
    }
    this.finish();
    this.rate = rate;
  }

  /** After a report interval `seconds`: plan the next report and decide whether the cluster has settled. */
  plan(seconds: number): void {
    this.hReport = clamp(this.rate > 0 ? K.REPORT_VOLTS / this.rate : K.REPORT_MAX, K.REPORT_MIN, K.REPORT_MAX);
    this.settled = this.quiet(seconds);
  }

  // ─────────────────────────────── internals ────────────────────────────

  /** Which nodes have a path to a source at all (others are floating and left out), terminal lookup. */
  private prepare(): void {
    const { nets, n, flag, mIdx, els, nodes } = this;
    flag.fill(0);
    for (let li = 0; li < n; li++) if (nets.g[nodes[li]] > 0) flag[li] = 1;
    this.spread(false);
    let m = 0;
    for (let li = 0; li < n; li++) mIdx[li] = flag[li] ? m++ : -1;
    for (const el of els) {
      const nt = el.kind >= BJT ? 3 : 2;
      let floating = false;
      for (let k = 0; k < nt; k++) {
        const li = el.lt[k];
        if (li >= 0) {
          const mi = mIdx[li];
          el.ti[k] = mi;
          el.tv[k] = mi >= 0 ? 0 : NaN;
          if (mi < 0 && !(el.kind === FET && k === 0)) floating = true;
        } else {
          el.ti[k] = -1;
          el.tv[k] = nets.fixed[el.nets[k]];
        }
      }
      el.skip = floating || (el.kind === C && this.capOnlyEdge(el));
      el.row = -1;
      if (el.kind === V && el.ideal && !el.skip) {
        if (el.ti[0] >= 0 || el.ti[1] >= 0) el.row = m++;
        else if (Math.abs(el.tv[0] - el.tv[1] - el.p1) > 0.05) this.onShort(el, Infinity);
      }
    }
    this.m = m;
  }

  private capOnlyEdge(el: El): boolean {
    const c = this.nets.capOnly;
    return c[el.nets[0]] === 1 || c[el.nets[1]] === 1;
  }

  /**
   * Flood-fill `flag` from the seeded nodes and from fixed nets. With `live` only
   * elements that actually conduct count (after a solve); otherwise every element does.
   */
  private spread(live: boolean): void {
    const { els, flag } = this;
    for (let changed = true; changed; ) {
      changed = false;
      for (const el of els) {
        const pairs = EDGES[el.kind];
        for (let k = 0; k < pairs.length; k += 2) {
          const p = pairs[k];
          const q = pairs[k + 1];
          if (live ? !this.conducts(el, k) : el.kind === C && this.capOnlyEdge(el)) continue;
          const a = el.lt[p];
          const b = el.lt[q];
          const ra = a < 0 || flag[a] === 1;
          const rb = b < 0 || flag[b] === 1;
          if (ra && !rb) {
            flag[b] = 1;
            changed = true;
          } else if (rb && !ra) {
            flag[a] = 1;
            changed = true;
          }
        }
      }
    }
  }

  private conducts(el: El, pair: number): boolean {
    if (el.skip) return false;
    switch (el.kind) {
      case R:
        return el.g > 0;
      case C:
        return el.p1 > 0;
      case L:
      case V:
        return true;
      case SW:
        return el.closed;
      case D:
        return el.state !== 0 && Math.abs(el.amps) > K.I_FLOAT;
      case BJT:
        return el.state !== 0 && Math.abs(pair === 0 ? el.ib : el.amps) > K.I_FLOAT;
      case FET:
        return el.state === 1;
    }
    return false;
  }

  private vt(el: El, k: number): number {
    const i = el.ti[k];
    return i >= 0 ? this.x[i] : el.tv[k];
  }

  /** Conductance `g` between terminals p and q. */
  private G(el: El, p: number, q: number, g: number): void {
    const { A, b, m } = this;
    const i = el.ti[p];
    const j = el.ti[q];
    if (i >= 0) {
      A[i * m + i] += g;
      if (j >= 0) A[i * m + j] -= g;
      else b[i] += g * el.tv[q];
    }
    if (j >= 0) {
      A[j * m + j] += g;
      if (i >= 0) A[j * m + i] -= g;
      else b[j] += g * el.tv[p];
    }
  }

  /** Constant current `cur` flowing from terminal p to terminal q through the element. */
  private I(el: El, p: number, q: number, cur: number): void {
    const i = el.ti[p];
    const j = el.ti[q];
    if (i >= 0) this.b[i] -= cur;
    if (j >= 0) this.b[j] += cur;
  }

  /** Current gm·(V(a) − V(c)) flowing from terminal f to terminal t. */
  private T(el: El, f: number, t: number, a: number, c: number, gm: number): void {
    const { A, b, m } = this;
    const ia = el.ti[a];
    const ic = el.ti[c];
    for (let s = 0; s < 2; s++) {
      const row = el.ti[s === 0 ? f : t];
      if (row < 0) continue;
      const g = s === 0 ? gm : -gm;
      if (ia >= 0) A[row * m + ia] += g;
      else b[row] -= g * el.tv[a];
      if (ic >= 0) A[row * m + ic] -= g;
      else b[row] += g * el.tv[c];
    }
  }

  private assemble(h: number): void {
    const { A, b, m, n, nets, nodes, mIdx } = this;
    A.fill(0, 0, m * m);
    b.fill(0, 0, m);
    for (let li = 0; li < n; li++) {
      const mi = mIdx[li];
      if (mi < 0) continue;
      A[mi * m + mi] += K.G_MIN + nets.g[nodes[li]];
      b[mi] += nets.i[nodes[li]];
    }
    for (const el of this.els) {
      if (el.skip) continue;
      switch (el.kind) {
        case R:
          this.G(el, 0, 1, el.g);
          break;
        case SW:
          this.G(el, 0, 1, el.closed ? el.g : K.G_LEAK);
          break;
        case C: {
          const geq = el.p1 / h;
          this.G(el, 0, 1, geq + K.G_LEAK);
          this.I(el, 0, 1, -geq * el.x);
          break;
        }
        case L:
          this.G(el, 0, 1, h / el.p1);
          this.I(el, 0, 1, el.x);
          break;
        case V:
          if (el.row >= 0) {
            const r = el.row;
            const i = el.ti[0];
            const j = el.ti[1];
            if (i >= 0) {
              A[i * m + r] += 1;
              A[r * m + i] += 1;
            } else b[r] -= el.tv[0];
            if (j >= 0) {
              A[j * m + r] -= 1;
              A[r * m + j] -= 1;
            } else b[r] += el.tv[1];
            b[r] += el.p1;
          } else if (!el.ideal) {
            this.G(el, 0, 1, el.g);
            this.I(el, 0, 1, -el.g * el.p1);
          }
          break;
        case D:
          if (el.state === 0) this.G(el, 0, 1, K.G_LEAK);
          else {
            this.G(el, 0, 1, el.g);
            this.I(el, 0, 1, el.state === 1 ? -el.g * el.p1 : el.g * el.p2);
          }
          break;
        case BJT: {
          // Oriented terminals: junction anode/cathode, main path from/to.
          const npn = el.p2 > 0;
          const ja = npn ? 0 : 2;
          const jk = npn ? 2 : 0;
          const f = npn ? 1 : 2;
          const t = npn ? 2 : 1;
          if (el.state === 0) {
            this.G(el, ja, jk, K.G_LEAK);
            this.G(el, f, t, K.G_LEAK);
            break;
          }
          const gbe = 1 / K.BE_OHMS;
          this.G(el, ja, jk, gbe);
          this.I(el, ja, jk, -gbe * K.VBE);
          if (el.state === 1) {
            const gm = el.p1 * gbe;
            this.T(el, f, t, ja, jk, gm);
            this.I(el, f, t, -gm * K.VBE);
            this.G(el, f, t, K.G_LEAK);
          } else {
            const gs = 1 / K.SAT_OHMS;
            this.G(el, f, t, gs);
            this.I(el, f, t, -gs * K.VCE_SAT);
          }
          break;
        }
        case FET:
          this.G(el, 1, 2, el.state === 1 ? el.g : K.G_LEAK);
          break;
      }
    }
  }

  /** Solve, iterating the piecewise-linear states until they are consistent. */
  private iterate(h: number): void {
    for (let iter = 0; iter < K.MAX_ITER; iter++) {
      this.assemble(h);
      this.singular = !solveDense(this.A, this.b, this.x, this.m);
      if (this.singular || !this.nonlinear || !this.updateStates(iter)) return;
    }
  }

  /** Flip inconsistent nonlinear states. After a few rounds only the worst one flips (no flip-flopping). */
  private updateStates(iter: number): boolean {
    const all = iter < 6;
    let worst: El | null = null;
    let worstState = 0;
    let worstViol = 0;
    let flipped = false;
    const E = 1e-9;
    for (const el of this.nl) {
      if (el.skip) continue;
      let next = el.state;
      let viol = 0;
      if (el.kind === D) {
        const vak = this.vt(el, 0) - this.vt(el, 1);
        const vf = el.p1;
        const z = el.p2;
        if (el.state === 0) {
          if (vak > vf + E) (next = 1), (viol = vak - vf);
          else if (z > 0 && -vak > z + E) (next = 2), (viol = -vak - z);
        } else if (el.state === 1) {
          if (vak < vf - E) (next = 0), (viol = vf - vak);
        } else if (-vak < z - E) (next = 0), (viol = z + vak);
      } else if (el.kind === BJT) {
        const npn = el.p2 > 0;
        const vj = npn ? this.vt(el, 0) - this.vt(el, 2) : this.vt(el, 2) - this.vt(el, 0);
        const vm = npn ? this.vt(el, 1) - this.vt(el, 2) : this.vt(el, 2) - this.vt(el, 1);
        if (el.state === 0) {
          if (vj > K.VBE + E) (next = 1), (viol = vj - K.VBE);
        } else if (vj < K.VBE - E) (next = 0), (viol = K.VBE - vj);
        else if (el.state === 1) {
          if (vm < K.VCE_SAT - E) (next = 2), (viol = K.VCE_SAT - vm);
        } else {
          const ib = (vj - K.VBE) / K.BE_OHMS;
          const ic = (vm - K.VCE_SAT) / K.SAT_OHMS;
          if (ic > el.p1 * ib + 1e-12) (next = 1), (viol = (ic - el.p1 * ib) * K.SAT_OHMS);
        }
      } else {
        const vg = el.ti[0] < 0 && Number.isNaN(el.tv[0]) ? NaN : el.p2 * (this.vt(el, 0) - this.vt(el, 2));
        const on = vg > el.p1 + (el.state === 1 ? -E : E);
        next = on ? 1 : 0;
        viol = Number.isNaN(vg) ? 1 : Math.abs(vg - el.p1);
      }
      if (next === el.state) continue;
      if (all) {
        el.state = next;
        flipped = true;
      } else if (viol > worstViol || !worst) {
        worst = el;
        worstState = next;
        worstViol = viol;
      }
    }
    if (worst) {
      worst.state = worstState;
      flipped = true;
    }
    return flipped;
  }

  private save(): void {
    for (const el of this.react) {
      el.xs = el.x;
      el.ds = el.d;
    }
  }

  private restore(): void {
    for (const el of this.react) {
      el.x = el.xs;
      el.d = el.ds;
    }
  }

  /** Take the new reactive state from the solution. Returns the local error ratio (≤ 1 is within tolerance). */
  private commit(h: number): number {
    let r = 0;
    for (const el of this.react) {
      if (el.skip || this.singular) {
        el.d = 0;
        continue;
      }
      const vab = this.vt(el, 0) - this.vt(el, 1);
      const x = el.kind === C ? vab : el.x + (h / el.p1) * vab;
      const d = (x - el.x) / h;
      const lte = 0.5 * h * Math.abs(d - el.d);
      const tol = el.kind === C ? 1e-3 + 1e-3 * Math.abs(x) : 1e-5 + 1e-3 * Math.abs(x);
      r = Math.max(r, lte / tol);
      el.x = x;
      el.d = d;
    }
    return r;
  }

  /** Largest node voltage change rate over the last step, and remember the node voltages. */
  private nodeRate(h: number): number {
    const { n, mIdx, x, vNode, vPrev } = this;
    let rate = 0;
    for (let li = 0; li < n; li++) {
      const mi = mIdx[li];
      vPrev[li] = vNode[li];
      vNode[li] = mi >= 0 ? x[mi] : NaN;
      const dv = Math.abs(vNode[li] - vPrev[li]);
      if (dv > 0) rate = Math.max(rate, dv / h);
    }
    return rate;
  }

  /** True when every capacitor / inductor has (practically) stopped changing. */
  private quiet(seconds: number): boolean {
    let quiet = true;
    for (const el of this.react) {
      if (el.skip) continue;
      const d = el.d;
      const ad = Math.abs(d);
      const tol = el.kind === C ? 2e-4 : 1e-6;
      let ok: boolean;
      if (ad === 0) ok = true;
      else {
        const dp = el.dRep;
        const tau = seconds > 0 && d * dp > 0 && ad < Math.abs(dp) ? seconds / Math.log(Math.abs(dp) / ad) : Infinity;
        ok = tau < 1000 ? ad * tau < tol : ad < (el.kind === C ? 1e-4 : 1e-7);
      }
      el.dRep = d;
      if (!ok) quiet = false;
    }
    return quiet;
  }

  /** Currents, live nodes (connected to a source by conducting elements) and node voltages. */
  private finish(): void {
    const { nets, n, nodes, flag, mIdx, x } = this;
    for (const el of this.els) this.current(el);
    if (this.singular) {
      for (let li = 0; li < n; li++) nets.volts[nodes[li]] = NaN;
      for (const el of this.els) if (el.kind === V) this.onShort(el, Infinity);
      return;
    }
    flag.fill(0);
    for (let li = 0; li < n; li++) if (mIdx[li] >= 0 && nets.g[nodes[li]] > 0) flag[li] = 1;
    this.spread(true);
    for (let li = 0; li < n; li++) {
      const net = nodes[li];
      const mi = mIdx[li];
      const v = flag[li] && mi >= 0 ? x[mi] : NaN;
      this.vNode[li] = mi >= 0 ? x[mi] : NaN;
      nets.volts[net] = nets.short[net] ? NaN : v;
    }
    for (const el of this.els) {
      if (el.kind !== C && Math.abs(el.amps) > el.maxAmps) this.onShort(el, el.amps);
    }
  }

  private current(el: El): void {
    el.ib = 0;
    if (el.skip || this.singular) {
      el.amps = 0;
      return;
    }
    const v01 = this.vt(el, 0) - this.vt(el, 1);
    switch (el.kind) {
      case R:
        el.amps = el.g * v01;
        break;
      case SW:
        el.amps = el.closed ? el.g * v01 : 0;
        break;
      case C:
        el.amps = el.p1 * el.d;
        break;
      case L:
        el.amps = el.x;
        break;
      case V:
        el.amps = el.row >= 0 ? this.x[el.row] : el.ideal ? 0 : el.g * (v01 - el.p1);
        break;
      case D:
        el.amps = el.state === 0 ? 0 : el.state === 1 ? el.g * (v01 - el.p1) : el.g * (v01 + el.p2);
        break;
      case BJT: {
        if (el.state === 0) {
          el.amps = 0;
          break;
        }
        const npn = el.p2 > 0;
        const vj = npn ? this.vt(el, 0) - this.vt(el, 2) : this.vt(el, 2) - this.vt(el, 0);
        const vm = npn ? this.vt(el, 1) - this.vt(el, 2) : this.vt(el, 2) - this.vt(el, 1);
        const ib = (vj - K.VBE) / K.BE_OHMS;
        const ic = el.state === 1 ? el.p1 * ib : (vm - K.VCE_SAT) / K.SAT_OHMS;
        el.ib = ib;
        el.amps = npn ? ic : -ic;
        break;
      }
      case FET:
        el.amps = el.state === 1 ? el.g * (this.vt(el, 1) - this.vt(el, 2)) : 0;
        break;
    }
  }
}

/**
 * Dense Gaussian elimination with partial pivoting: solves A·x = b in place
 * (A and b are destroyed). Returns false if the matrix is singular.
 */
export function solveDense(A: Float64Array, b: Float64Array, x: Float64Array, m: number): boolean {
  for (let k = 0; k < m; k++) {
    let p = k;
    let best = Math.abs(A[k * m + k]);
    for (let i = k + 1; i < m; i++) {
      const v = Math.abs(A[i * m + k]);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    if (!(best > 1e-300)) return false;
    if (p !== k) {
      for (let j = k; j < m; j++) {
        const t = A[k * m + j];
        A[k * m + j] = A[p * m + j];
        A[p * m + j] = t;
      }
      const t = b[k];
      b[k] = b[p];
      b[p] = t;
    }
    const piv = A[k * m + k];
    for (let i = k + 1; i < m; i++) {
      const f = A[i * m + k] / piv;
      if (f === 0) continue;
      for (let j = k + 1; j < m; j++) A[i * m + j] -= f * A[k * m + j];
      b[i] -= f * b[k];
    }
  }
  for (let i = m - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < m; j++) s -= A[i * m + j] * x[j];
    x[i] = s / A[i * m + i];
  }
  return true;
}
