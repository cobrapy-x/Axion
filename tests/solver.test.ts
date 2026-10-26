// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseValue } from '../src/core/analog/units';
import { parseDiagram, type Diagram } from '../src/core/diagram';
import { Engine, type PartType } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import type { AnalogElement, Drive, ModelFactory } from '../src/core/types';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const MS = 1e6;
const S = 1e9;

// A fake part: drives each pin as configured (attrs), changeable at runtime with input(pin, drive).
const driver: ModelFactory = (ctx) => {
  const drives: Record<string, Drive> = {};
  for (const [k, v] of Object.entries(ctx.props)) drives[k] = (typeof v === 'string' && /^-?[\d.]+$/.test(v) ? Number(v) : v) as Drive;
  return {
    drive: (pin) => drives[pin] ?? 'z',
    input(event, data) {
      drives[event] = data as Drive;
      ctx.invalidate();
    },
  };
};

// A fake part made of one analog element given as JSON in its `el` attribute; reports the element's current.
const element: ModelFactory = (ctx) => {
  const els = [JSON.parse(String(ctx.props.el)) as AnalogElement];
  return {
    elements: () => els,
    state: () => ({ amps: ctx.current('x') }),
    input(_event, data) {
      Object.assign(els[0], data);
      ctx.invalidate();
    },
  };
};

const manifest = (type: string) => ({ type, name: type, category: 'test', version: '1', license: 'Apache-2.0' });
const types = new Map<string, PartType>([
  ...loadPartTypes(),
  ['test-driver', { manifest: manifest('test-driver'), model: driver }],
  ['test-element', { manifest: manifest('test-element'), model: element }],
]);

type Part = { type: string; id: string; attrs?: Record<string, string> };
function load(parts: Part[], connections: Array<[string, string]>, firmware: Record<string, string> = {}): Engine {
  const e = new Engine(types);
  const diagram: Diagram = parseDiagram({
    version: 1,
    parts: parts.map((p) => ({ top: 0, left: 0, ...p })),
    connections: connections.map(([a, b]) => [a, b, '', []]),
  });
  e.load(diagram, firmware);
  return e;
}

const el = (id: string, e: AnalogElement): Part => ({ type: 'test-element', id, attrs: { el: JSON.stringify({ ...e, id: 'x' }) } });
const res = (id: string, value: string): Part => ({ type: 'wokwi-resistor', id, attrs: { value } });
const battery = (id: string, volts: number): Part => ({ type: 'axion-battery', id, attrs: { voltage: String(volts) } });
const states = (e: Engine) => e.snapshot().states;
const amps = (e: Engine, id: string) => states(e)[id].amps as number;

describe('component values', () => {
  it('parses resistor and capacitor notations', () => {
    expect(parseValue('220', 0)).toBe(220);
    expect(parseValue('4.7k', 0)).toBeCloseTo(4700);
    expect(parseValue('1M', 0)).toBe(1e6);
    expect(parseValue('2k2', 0)).toBeCloseTo(2200);
    expect(parseValue('10kΩ', 0)).toBe(10_000);
    expect(parseValue('100nF', 0)).toBeCloseTo(100e-9, 15);
    expect(parseValue('10µF', 0)).toBeCloseTo(10e-6, 12);
    expect(parseValue('4.7uF', 0)).toBeCloseTo(4.7e-6, 12);
    expect(parseValue('1mF', 0)).toBeCloseTo(1e-3, 9);
    expect(parseValue('banana', 7)).toBe(7);
  });
});

describe('voltage dividers', () => {
  it('10k / 10k from 5 V gives 2.5 V, and a load pulls it down', () => {
    const e = load(
      [battery('b', 5), res('r1', '10k'), res('r2', '10000'), { type: 'axion-voltmeter', id: 'vm' }],
      [
        ['b:+', 'r1:1'],
        ['r1:2', 'r2:1'],
        ['r2:2', 'b:-'],
        ['vm:V', 'r1:2'],
        ['vm:COM', 'b:-'],
      ],
    );
    expect(e.voltage('r1', '2')).toBeCloseTo(2.5, 6);
    expect(states(e).vm.volts).toBe(2.5);
    expect(e.level('r1', '2')).toBe(null); // between the logic thresholds

    const loaded = load(
      [battery('b', 5), res('r1', '10k'), res('r2', '10k'), res('rl', '10k')],
      [
        ['b:+', 'r1:1'],
        ['r1:2', 'r2:1'],
        ['r2:2', 'b:-'],
        ['r1:2', 'rl:1'],
        ['rl:2', 'b:-'],
      ],
    );
    expect(loaded.voltage('r1', '2')).toBeCloseTo(5 / 3, 6);
  });

  it('a 10k pull-down beats the ~35k internal pull-up, a 100k one does not', () => {
    const e = load(
      [{ type: 'test-driver', id: 'd', attrs: { in: 'pullup', gnd: '0' } }, res('r', '10k')],
      [
        ['d:in', 'r:1'],
        ['r:2', 'd:gnd'],
      ],
    );
    expect(e.voltage('d', 'in')).toBeCloseTo((5 * 10) / 45, 3);
    expect(e.level('d', 'in')).toBe(0);
    const weak = load(
      [{ type: 'test-driver', id: 'd', attrs: { in: 'pullup', gnd: '0' } }, res('r', '100k')],
      [
        ['d:in', 'r:1'],
        ['r:2', 'd:gnd'],
      ],
    );
    expect(weak.level('d', 'in')).toBe(1);
  });

  it('a 3.3 V logic source ({ volts, ohms }) drives a divider', () => {
    const e = load(
      [{ type: 'test-driver', id: 'd', attrs: { gnd: '0' } }, res('r1', '1k'), res('r2', '2k')],
      [
        ['d:out', 'r1:1'],
        ['r1:2', 'r2:1'],
        ['r2:2', 'd:gnd'],
      ],
    );
    e.input('d', 'out', { volts: 3.3, ohms: 30 });
    expect(e.voltage('r1', '2')).toBeCloseTo((3.3 * 2000) / 3030, 4);
  });
});

describe('LEDs', () => {
  const ledCircuit = (resistor: boolean) =>
    load(
      [{ type: 'test-driver', id: 'd', attrs: { pin: 'low', gnd: '0' } }, battery('b', 5), { type: 'wokwi-led', id: 'led1', attrs: { color: 'red' } }, res('r1', '220')],
      resistor
        ? [
            ['b:+', 'r1:1'],
            ['r1:2', 'led1:A'],
            ['led1:C', 'b:-'],
          ]
        : [
            ['d:pin', 'led1:A'],
            ['led1:C', 'd:gnd'],
          ],
    );

  it('220 Ω on 5 V: about 14 mA and 1.8–1.9 V across a red LED', () => {
    const e = ledCircuit(true);
    const vf = e.voltage('led1', 'A')! - e.voltage('led1', 'C')!;
    expect(vf).toBeGreaterThan(1.8);
    expect(vf).toBeLessThan(1.95);
    const ma = ((5 - e.voltage('led1', 'A')!) / 220) * 1000;
    expect(ma).toBeGreaterThan(13.5);
    expect(ma).toBeLessThan(14.8);
    e.stepTo(20 * MS);
    expect(states(e).led1.brightness).toBeCloseTo(ma / 20, 1); // full brightness at 20 mA
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('forward voltage depends on the colour', () => {
    const vfOf = (color: string) => {
      const e = load(
        [battery('b', 5), { type: 'wokwi-led', id: 'led1', attrs: { color } }, res('r1', '220')],
        [
          ['b:+', 'r1:1'],
          ['r1:2', 'led1:A'],
          ['led1:C', 'b:-'],
        ],
      );
      return e.voltage('led1', 'A')!;
    };
    expect(vfOf('red')).toBeLessThan(vfOf('green'));
    expect(vfOf('green')).toBeLessThan(vfOf('blue'));
    expect(vfOf('blue')).toBeCloseTo(3.05, 1);
  });

  it('warns about an LED with no current-limiting resistor on a pin', () => {
    const e = ledCircuit(false);
    e.input('d', 'pin', 'high');
    e.stepTo(10 * MS);
    const w = e.snapshot().warnings;
    expect(w.some((x) => /^LED led1 has no current-limiting resistor \(\d+ mA\)$/.test(x))).toBe(true);
    expect(w.some((x) => /Short circuit/.test(x))).toBe(false);
    expect(states(e).led1.brightness).toBe(1);
  });

  it('a reversed LED stays dark and its floating side reads null', () => {
    const e = load(
      [battery('b', 5), { type: 'wokwi-led', id: 'led1' }, res('r1', '220'), { type: 'wokwi-led', id: 'led2' }],
      [
        ['b:+', 'r1:1'],
        ['r1:2', 'led1:C'],
        ['led1:A', 'b:-'],
        ['b:+', 'led2:A'], // cathode not connected
      ],
    );
    expect(e.voltage('led1', 'C')).toBeCloseTo(5, 4); // no current through the resistor
    e.stepTo(10 * MS);
    expect(states(e).led1.brightness).toBe(0);
    expect(e.voltage('led2', 'C')).toBe(null);
  });

  it('two LEDs in series both light from 9 V', () => {
    const e = load(
      [battery('b', 9), { type: 'wokwi-led', id: 'l1' }, { type: 'wokwi-led', id: 'l2' }, res('r1', '330')],
      [
        ['b:+', 'r1:1'],
        ['r1:2', 'l1:A'],
        ['l1:C', 'l2:A'],
        ['l2:C', 'b:-'],
      ],
    );
    e.stepTo(10 * MS);
    const s = states(e);
    expect(s.l1.brightness).toBeGreaterThan(0.7);
    expect(s.l2.brightness).toBe(s.l1.brightness);
    expect(e.voltage('l1', 'C')).toBeCloseTo(1.88, 1);
  });
});

describe('diodes', () => {
  const diode = { kind: 'D', anode: 'A', cathode: 'K', vf: 0.7 } as const;

  it('conducts forward with ~0.7 V and blocks reverse', () => {
    const fwd = load(
      [battery('b', 5), res('r', '1k'), el('d1', diode)],
      [
        ['b:+', 'r:1'],
        ['r:2', 'd1:A'],
        ['d1:K', 'b:-'],
      ],
    );
    expect(fwd.voltage('d1', 'A')).toBeCloseTo(0.704, 2);
    expect(amps(fwd, 'd1')).toBeCloseTo(4.3e-3, 4);
    const rev = load(
      [battery('b', 5), res('r', '1k'), el('d1', diode)],
      [
        ['b:+', 'r:1'],
        ['r:2', 'd1:K'],
        ['d1:A', 'b:-'],
      ],
    );
    expect(rev.voltage('d1', 'K')).toBeCloseTo(5, 4);
    expect(amps(rev, 'd1')).toBe(0);
  });

  it('a zener clamps at its breakdown voltage', () => {
    const e = load(
      [battery('b', 9), res('r', '1k'), el('z', { ...diode, zener: 5.1 })],
      [
        ['b:+', 'r:1'],
        ['r:2', 'z:K'],
        ['z:A', 'b:-'],
      ],
    );
    expect(e.voltage('z', 'K')).toBeCloseTo(5.1, 1);
    expect(amps(e, 'z')).toBeCloseTo(-3.9e-3, 4); // flows cathode → anode
    // Below the breakdown voltage it blocks.
    const low = load(
      [battery('b', 3), res('r', '1k'), el('z', { ...diode, zener: 5.1 })],
      [
        ['b:+', 'r:1'],
        ['r:2', 'z:K'],
        ['z:A', 'b:-'],
      ],
    );
    expect(low.voltage('z', 'K')).toBeCloseTo(3, 4);
  });
});

describe('RC and RL timing', () => {
  const rc = () =>
    load(
      [{ type: 'test-driver', id: 'd', attrs: { pin: 'low', gnd: '0' } }, res('r', '10k'), { type: 'axion-capacitor-electrolytic', id: 'c', attrs: { capacitance: '100µF' } }],
      [
        ['d:pin', 'r:1'],
        ['r:2', 'c:+'],
        ['c:-', 'd:gnd'],
      ],
    );
  const tau = (10_000 + 25) * 100e-6; // the pin's ~25 Ω output resistance is in series

  it('charges to 63 % at τ and ~99 % at 5τ, then discharges', () => {
    const e = rc();
    expect(e.voltage('c', '+')).toBe(0);
    e.input('d', 'pin', 'high');
    const t0 = e.time;
    e.stepTo(t0 + tau * S);
    expect(e.voltage('c', '+')! / 5).toBeCloseTo(1 - Math.exp(-1), 2);
    e.stepTo(t0 + 0.5 * tau * S);
    e.stepTo(t0 + 5 * tau * S);
    expect(e.voltage('c', '+')! / 5).toBeGreaterThan(0.99);
    // The curve in between follows 1 − e^(−t/τ) within 2 % of full scale.
    const e2 = rc();
    e2.input('d', 'pin', 'high');
    for (const k of [0.1, 0.3, 0.7, 1.5, 2.5]) {
      e2.stepTo(t0 + k * tau * S);
      expect(Math.abs(e2.voltage('c', '+')! / 5 - (1 - Math.exp(-k)))).toBeLessThan(0.02);
    }
    // Discharge through the same resistor.
    e.stepTo(t0 + 10 * tau * S);
    const v0 = e.voltage('c', '+')!;
    e.input('d', 'pin', 'low');
    const t1 = e.time;
    expect(e.voltage('c', '+')).toBeCloseTo(v0, 2); // a capacitor's voltage can't jump
    e.stepTo(t1 + tau * S);
    expect(e.voltage('c', '+')! / v0).toBeCloseTo(Math.exp(-1), 2);
  });

  it('holds its charge while the pin is an input, and the input reads it', () => {
    const e = rc();
    e.input('d', 'pin', 'high');
    e.stepTo(e.time + 0.7 * S);
    const v = e.voltage('c', '+')!;
    e.input('d', 'pin', 'z');
    e.stepTo(e.time + 2 * S);
    expect(e.voltage('c', '+')).toBeCloseTo(v, 2);
    expect(e.voltage('d', 'pin')).toBeCloseTo(v, 2);
  });

  it('a settled RC circuit costs (almost) nothing', () => {
    const e = rc();
    e.input('d', 'pin', 'high');
    e.stepTo(e.time + 30 * S); // fully charged
    const t = performance.now();
    e.stepTo(e.time + 10_000 * S);
    expect(performance.now() - t).toBeLessThan(50);
    expect(e.voltage('c', '+')).toBeCloseTo(5, 3);
  });

  it('a 100 nF ceramic capacitor on a 1k resistor settles within milliseconds', () => {
    const e = load(
      [{ type: 'test-driver', id: 'd', attrs: { pin: 'low', gnd: '0' } }, res('r', '1k'), { type: 'axion-capacitor', id: 'c', attrs: { capacitance: '100nF' } }],
      [
        ['d:pin', 'r:1'],
        ['r:2', 'c:1'],
        ['c:2', 'd:gnd'],
      ],
    );
    e.input('d', 'pin', 'high');
    const t0 = e.time;
    e.stepTo(t0 + 100_000); // τ ≈ 0.1 ms
    expect(e.voltage('c', '1')! / 5).toBeCloseTo(1 - Math.exp(-1), 1);
    e.stepTo(t0 + 2 * MS);
    expect(e.voltage('c', '1')).toBeCloseTo(5, 2);
  });

  it('RL: current rises as 1 − e^(−t·R/L)', () => {
    const e = load(
      [{ type: 'test-driver', id: 'd', attrs: { v: '0', gnd: '0' } }, res('r', '100'), el('l', { kind: 'L', a: 'a', b: 'b', henries: 0.1 })],
      [
        ['d:v', 'r:1'],
        ['r:2', 'l:a'],
        ['l:b', 'd:gnd'],
      ],
    );
    expect(amps(e, 'l')).toBe(0);
    e.input('d', 'v', 5);
    const t0 = e.time;
    expect(e.voltage('l', 'a')).toBeCloseTo(5, 2); // all of the voltage is across the coil at first
    const tauL = 0.1 / 100;
    e.stepTo(t0 + tauL * S);
    expect(amps(e, 'l') / 0.05).toBeCloseTo(1 - Math.exp(-1), 2);
    e.stepTo(t0 + 8 * tauL * S);
    expect(amps(e, 'l')).toBeCloseTo(0.05, 3);
    expect(e.voltage('l', 'a')).toBeCloseTo(0, 2);
  });
});

describe('transistors', () => {
  const npn = (rb: string) =>
    load(
      [{ type: 'test-driver', id: 'd', attrs: { pin: 'high' } }, battery('b', 5), res('rb', rb), res('rc', '1k'), { type: 'axion-npn', id: 'q' }],
      [
        ['d:pin', 'rb:1'],
        ['rb:2', 'q:B'],
        ['q:E', 'b:-'],
        ['b:+', 'rc:1'],
        ['rc:2', 'q:C'],
      ],
    );

  it('NPN with a 10k base resistor saturates (VCE ≈ 0.2 V)', () => {
    const e = npn('10k');
    expect(e.voltage('q', 'C')).toBeCloseTo(0.2, 1);
    expect(e.voltage('q', 'B')).toBeCloseTo(0.69, 1);
    expect(states(e).q.on).toBe(true);
    e.input('d', 'pin', 'low');
    expect(e.voltage('q', 'C')).toBeCloseTo(5, 3);
    expect(states(e).q.on).toBe(false);
  });

  it('NPN in the active region: IC ≈ β·IB', () => {
    const e = npn('1M');
    const ib = (e.voltage('rb', '1')! - e.voltage('rb', '2')!) / 1e6;
    const ic = (5 - e.voltage('q', 'C')!) / 1000;
    expect(ic / ib).toBeCloseTo(100, 0);
    expect(states(e).q.ic).toBeCloseTo(ic * 1000, 1);
    expect(e.voltage('q', 'C')).toBeGreaterThan(4);
  });

  it('PNP high-side switch drives an LED', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { pin: 'high' } },
        battery('b', 5),
        res('rb', '1k'),
        res('rl', '220'),
        { type: 'axion-pnp', id: 'q' },
        { type: 'wokwi-led', id: 'led' },
      ],
      [
        ['d:pin', 'rb:1'],
        ['rb:2', 'q:B'],
        ['q:E', 'b:+'],
        ['q:C', 'rl:1'],
        ['rl:2', 'led:A'],
        ['led:C', 'b:-'],
      ],
    );
    e.stepTo(5 * MS);
    expect(states(e).led.brightness).toBe(0);
    e.input('d', 'pin', 'low');
    expect(e.voltage('q', 'C')).toBeCloseTo(4.8, 1);
    e.snapshot();
    e.stepTo(10 * MS);
    expect(states(e).led.brightness).toBeGreaterThan(0.6);
  });
});

describe('shorts and floating nets', () => {
  it('a pin driven HIGH wired straight to GND is a short circuit', () => {
    const e = load(
      [{ type: 'test-driver', id: 'd', attrs: { pin: 'high' } }, battery('b', 5), res('r', '1k')],
      [
        ['d:pin', 'b:-'],
        ['d:pin', 'r:1'],
        ['r:2', 'b:+'],
      ],
    );
    expect(e.snapshot().warnings.join()).toMatch(/Short circuit/);
    expect(e.voltage('d', 'pin')).toBe(null);
  });

  it('a battery shorted by a tiny resistance warns and stays finite', () => {
    const e = load(
      [battery('b', 9), res('r', '0.01'), res('r2', '1k'), { type: 'wokwi-led', id: 'led' }],
      [
        ['b:+', 'r:1'],
        ['r:2', 'b:-'],
        ['b:+', 'r2:1'],
        ['r2:2', 'led:A'],
        ['led:C', 'b:-'],
      ],
    );
    expect(e.snapshot().warnings.join()).toMatch(/Short circuit: \d+ A through r/);
    expect(Number.isFinite(e.voltage('led', 'A')!)).toBe(true);
  });

  it('floating nets read null; a resistor to nothing does not change that', () => {
    const e = load(
      [{ type: 'test-driver', id: 'd', attrs: { in: 'z' } }, res('r', '10k'), res('r2', '10k')],
      [
        ['d:in', 'r:1'],
        ['r:2', 'r2:1'],
      ],
    );
    expect(e.voltage('d', 'in')).toBe(null);
    expect(e.level('d', 'in')).toBe(null);
    expect(e.voltage('r2', '2')).toBe(null);
    e.input('d', 'in', 'pullup');
    expect(e.voltage('r2', '2')).toBeCloseTo(5, 4); // no current flows: the pull-up's voltage everywhere
  });
});

describe('Arduino end to end', () => {
  it('potentiometer as a divider into analogRead (voltage-divider example)', () => {
    const e = new Engine(types);
    e.load(parseDiagram(JSON.parse(read('examples/voltage-divider/diagram.json'))), { uno: read('examples/voltage-divider/sketch.hex') });
    let out = '';
    for (let t = 100; t <= 1200; t += 100) {
      e.stepTo(t * MS);
      out += e.snapshot().events.filter((x) => x.event === 'serial').map((x) => x.data).join('');
    }
    expect(out).toMatch(/A0 = 2\.50 V/);
    expect(states(e).vm1.volts).toBeCloseTo(2.5, 2);
    // The pot (10k) loads the divider through A1: half way it reads ~ 2.5 V too.
    expect(out).toMatch(/A1 = 2\.\d\d V/);
    e.input('pot1', 'value', 1023);
    let out2 = '';
    for (let t = 1300; t <= 2200; t += 100) {
      e.stepTo(t * MS);
      out2 += e.snapshot().events.filter((x) => x.event === 'serial').map((x) => x.data).join('');
    }
    expect(out2).toMatch(/A1 = 5\.00 V/);
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('RC timing example measures τ ≈ 1 s with analogRead', () => {
    const e = new Engine(types);
    e.load(parseDiagram(JSON.parse(read('examples/rc-timing/diagram.json'))), { uno: read('examples/rc-timing/sketch.hex') });
    let out = '';
    for (let t = 500; t <= 4000; t += 500) {
      e.stepTo(t * MS);
      out += e.snapshot().events.filter((x) => x.event === 'serial').map((x) => x.data).join('');
    }
    const m = /tau = (\d+) ms/.exec(out);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(970);
    expect(Number(m![1])).toBeLessThan(1040);
    expect(e.snapshot().warnings).toEqual([]);
  });
});
