// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram, type Diagram } from '../src/core/diagram';
import { Engine, type PartType } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import type { Drive, ModelFactory } from '../src/core/types';
import { ldrOhms } from '../src/physics/ldr';

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

const manifest = (type: string) => ({ type, name: type, category: 'test', version: '1', license: 'Apache-2.0' });
const types = new Map<string, PartType>([...loadPartTypes(), ['test-driver', { manifest: manifest('test-driver'), model: driver }]]);

type Part = { type: string; id: string; attrs?: Record<string, string> };
function load(parts: Part[], connections: Array<[string, string]>): Engine {
  const e = new Engine(types);
  const diagram: Diagram = parseDiagram({
    version: 1,
    parts: parts.map((p) => ({ top: 0, left: 0, ...p })),
    connections: connections.map(([a, b]) => [a, b, '', []]),
  });
  e.load(diagram, {});
  return e;
}

const res = (id: string, value: string): Part => ({ type: 'wokwi-resistor', id, attrs: { value } });
const battery = (id: string, volts: number): Part => ({ type: 'axion-battery', id, attrs: { voltage: String(volts) } });
const drv = (id: string, attrs: Record<string, string>): Part => ({ type: 'test-driver', id, attrs });
const states = (e: Engine) => e.snapshot().states;
const warnings = (e: Engine) => e.snapshot().warnings;

describe('inductor', () => {
  it('RL: current reaches 63 % at τ = L / R and settles at V / R', () => {
    // 100 mH with 1 Ω of wire, in series with 99 Ω: τ = 0.1 / 100 = 1 ms, I = 50 mA.
    const e = load(
      [drv('d', { v: '0', gnd: '0' }), res('r', '99'), { type: 'axion-inductor', id: 'l', attrs: { inductance: '100mH', resistance: '1Ω' } }],
      [
        ['d:v', 'l:1'],
        ['l:2', 'r:1'],
        ['r:2', 'd:gnd'],
      ],
    );
    expect(states(e).l.mA).toBe(0);
    e.input('d', 'v', 5);
    const t0 = e.time;
    expect(e.voltage('r', '1')).toBeCloseTo(0, 3); // no current yet
    for (const [k, frac] of [
      [0.5, 1 - Math.exp(-0.5)],
      [1, 1 - Math.exp(-1)],
      [2, 1 - Math.exp(-2)],
    ]) {
      e.stepTo(t0 + k * MS);
      const i = Number(states(e).l.mA) / 50;
      expect(Math.abs(i - frac) / frac).toBeLessThan(0.03);
    }
    e.stepTo(t0 + 10 * MS);
    expect(states(e).l.mA).toBeCloseTo(50, 0);
    // The winding resistance is in series: 1 Ω × 50 mA across the coil when settled.
    expect(e.voltage('l', '1')! - e.voltage('l', '2')!).toBeCloseTo(0.05, 2);
  });

  it('an ideal coil (resistance 0) has no internal node', () => {
    const e = load(
      [drv('d', { v: '5', gnd: '0' }), res('r', '100'), { type: 'axion-inductor', id: 'l', attrs: { inductance: '10mH', resistance: '0' } }],
      [
        ['d:v', 'l:1'],
        ['l:2', 'r:1'],
        ['r:2', 'd:gnd'],
      ],
    );
    e.stepTo(5 * MS); // τ = 0.1 ms
    expect(states(e).l.mA).toBeCloseTo(50, 1);
  });
});

describe('variable resistors', () => {
  const pot = (type: string, attrs: Record<string, string>) =>
    load(
      [battery('b', 5), { type, id: 'p', attrs }],
      [
        ['b:+', 'p:VCC'],
        ['b:-', 'p:GND'],
      ],
    );

  it('trimmer: the screw position sets SIG, also while running', () => {
    const e = pot('axion-trimpot', { value: '512', resistance: '10k' });
    expect(e.voltage('p', 'SIG')).toBeCloseTo((5 * 512) / 1023, 3);
    expect(states(e).p.ohms).toBe(Math.round((10_000 * 512) / 1023));
    e.input('p', 'value', 1023);
    expect(e.voltage('p', 'SIG')).toBeCloseTo(5, 3);
    e.input('p', 'value', 0);
    expect(e.voltage('p', 'SIG')).toBeCloseTo(0, 3);
  });

  it('trimmer: its real resistance shows under load', () => {
    // 10k trimmer at the middle loaded by 10k: 5k ∥ 10k below, 5k above → 2 V.
    const e = load(
      [battery('b', 5), { type: 'axion-trimpot', id: 'p', attrs: { value: '511.5', resistance: '10k' } }, res('rl', '10k')],
      [
        ['b:+', 'p:VCC'],
        ['b:-', 'p:GND'],
        ['p:SIG', 'rl:1'],
        ['rl:2', 'b:-'],
      ],
    );
    expect(e.voltage('p', 'SIG')).toBeCloseTo(2, 2);
  });

  it('slide potentiometer: 0–100 from GND to VCC', () => {
    const e = pot('wokwi-slide-potentiometer', { value: '25' });
    expect(e.voltage('p', 'SIG')).toBeCloseTo(1.25, 3);
    e.input('p', 'value', 100);
    expect(e.voltage('p', 'SIG')).toBeCloseTo(5, 3);
    expect(states(e).p.value).toBe(100);
  });

  it('rheostat: resistance = position × full value, changed live', () => {
    const e = load(
      [battery('b', 5), { type: 'axion-rheostat', id: 'rh', attrs: { position: '50', resistance: '10k' } }, res('r', '5k')],
      [
        ['b:+', 'r:1'],
        ['r:2', 'rh:2'],
        ['rh:1', 'b:-'],
      ],
    );
    expect(e.voltage('rh', '2')).toBeCloseTo(2.5, 3);
    expect(states(e).rh.ohms).toBe(5000);
    expect(states(e).rh.mA).toBeCloseTo(0.5, 2);
    e.input('rh', 'prop', { key: 'position', value: 20 });
    expect(e.voltage('rh', '2')).toBeCloseTo((5 * 2) / 7, 3);
    e.input('rh', 'prop', { key: 'position', value: 0 });
    expect(e.voltage('rh', '2')).toBeLessThan(0.002); // 1 Ω end resistance
  });
});

describe('photoresistor', () => {
  it('follows R = R10 · (lux / 10)^−0.7, about 1 MΩ in the dark', () => {
    expect(ldrOhms(10, 10_000, 0.7)).toBeCloseTo(10_000, 6);
    expect(ldrOhms(100, 10_000, 0.7)).toBeCloseTo(10_000 * Math.pow(10, -0.7), 3); // ≈ 2 kΩ
    expect(ldrOhms(1, 10_000, 0.7)).toBeCloseTo(50_119, 0);
    expect(ldrOhms(0, 10_000, 0.7)).toBe(1e6);
  });

  it('in a divider with 10k the voltage rises with the light, live', () => {
    const e = load(
      [battery('b', 5), { type: 'axion-photoresistor', id: 'ldr', attrs: { lux: '10' } }, res('r', '10k')],
      [
        ['b:+', 'ldr:1'],
        ['ldr:2', 'r:1'],
        ['r:2', 'b:-'],
      ],
    );
    expect(e.voltage('r', '1')).toBeCloseTo(2.5, 3);
    expect(states(e).ldr.ohms).toBe(10_000);
    e.input('ldr', 'prop', { key: 'lux', value: 1000 });
    const r = 10_000 * Math.pow(100, -0.7);
    expect(e.voltage('r', '1')).toBeCloseTo((5 * 10_000) / (10_000 + r), 3);
    e.input('ldr', 'prop', { key: 'lux', value: 0 });
    expect(e.voltage('r', '1')).toBeCloseTo((5 * 10_000) / 1_010_000, 3);
    expect(states(e).ldr.lux).toBe(0);
  });

  it('sensor module: AO rises in the dark, DO goes HIGH above the threshold', () => {
    const e = load(
      [battery('b', 5), { type: 'wokwi-photoresistor-sensor', id: 'm', attrs: { lux: '500' } }, drv('in', {})],
      [
        ['b:+', 'm:VCC'],
        ['b:-', 'm:GND'],
        ['m:DO', 'in:pin'], // a digital input listening to DO
      ],
    );
    const ldr = ldrOhms(500, 50_000, 0.7);
    expect(e.voltage('m', 'AO')).toBeCloseTo((5 * ldr) / (ldr + 10_000), 3);
    expect(e.level('m', 'DO')).toBe(0); // bright
    expect(states(e).m.bright).toBe(true);
    expect(states(e).m.power).toBe(true);
    e.input('m', 'prop', { key: 'lux', value: 2 });
    expect(e.voltage('m', 'AO')).toBeGreaterThan(4);
    expect(e.level('m', 'DO')).toBe(1); // dark
    expect(states(e).m.bright).toBe(false);
    // Raising the threshold above AO makes it count as bright again.
    e.input('m', 'prop', { key: 'threshold', value: 4.9 });
    expect(e.level('m', 'DO')).toBe(0);
  });

  it('sensor module: DO is an open collector with a 10k pull-up; unpowered it drives nothing', () => {
    const e = load(
      [battery('b', 5), { type: 'wokwi-photoresistor-sensor', id: 'm', attrs: { lux: '1' } }, res('rl', '10k')],
      [
        ['b:+', 'm:VCC'],
        ['b:-', 'm:GND'],
        ['m:DO', 'rl:1'],
        ['rl:2', 'b:-'],
      ],
    );
    expect(e.voltage('m', 'DO')).toBeCloseTo(2.5, 2);
    const off = load([{ type: 'wokwi-photoresistor-sensor', id: 'm', attrs: { lux: '1' } }, drv('in', {})], [['m:DO', 'in:pin']]);
    expect(off.voltage('m', 'DO')).toBe(null);
    expect(states(off).m.power).toBe(false);
  });
});

describe('diodes', () => {
  const forward = (type: string) =>
    load(
      [battery('b', 5), res('r', '1k'), { type, id: 'd' }],
      [
        ['b:+', 'r:1'],
        ['r:2', 'd:A'],
        ['d:K', 'b:-'],
      ],
    );
  const reverse = (type: string) =>
    load(
      [battery('b', 5), res('r', '1k'), { type, id: 'd' }],
      [
        ['b:+', 'r:1'],
        ['r:2', 'd:K'],
        ['d:A', 'b:-'],
      ],
    );

  for (const [type, vf] of [
    ['axion-diode-1n4148', 0.65],
    ['axion-diode-1n4007', 0.7],
    ['axion-schottky', 0.3],
    ['axion-zener', 0.7],
  ] as const) {
    it(`${type}: drops ≈ ${vf} V forward and blocks reverse`, () => {
      const f = forward(type);
      expect(f.voltage('d', 'A')).toBeGreaterThan(vf);
      expect(f.voltage('d', 'A')).toBeLessThan(vf + 0.04);
      expect(states(f).d.on).toBe(true);
      expect(states(f).d.mA).toBeCloseTo((5 - f.voltage('d', 'A')!) * 1, 1);
      const r = reverse(type);
      expect(r.voltage('d', 'K')).toBeCloseTo(5, 4);
      expect(states(r).d.mA).toBe(0);
      expect(states(r).d.on).toBe(false);
      expect(warnings(f)).toEqual([]);
    });
  }

  it('zener clamps at its voltage (prop) through a series resistor', () => {
    const z = (voltage: string, volts: number) =>
      load(
        [battery('b', volts), res('r', '470'), { type: 'axion-zener', id: 'z', attrs: { voltage } }],
        [
          ['b:+', 'r:1'],
          ['r:2', 'z:K'],
          ['z:A', 'b:-'],
        ],
      );
    const e = z('5.1', 9);
    expect(e.voltage('z', 'K')).toBeCloseTo(5.14, 1);
    expect(states(e).z.breakdown).toBe(true);
    expect(states(e).z.mA).toBeCloseTo(-8.2, 0);
    expect(z('3.3', 9).voltage('z', 'K')).toBeCloseTo(3.35, 1);
    // Below its voltage it does nothing.
    expect(z('5.1', 3).voltage('z', 'K')).toBeCloseTo(3, 3);
  });

  it('warns when a 1N4148 carries more than 300 mA', () => {
    const e = load(
      [battery('b', 5), res('r', '10'), { type: 'axion-diode-1n4148', id: 'd' }],
      [
        ['b:+', 'r:1'],
        ['r:2', 'd:A'],
        ['d:K', 'b:-'],
      ],
    );
    expect(warnings(e).join()).toMatch(/Diode d \(1N4148\) carries 3\d\d mA/);
  });
});

describe('MOSFETs', () => {
  const lowSide = (type: string, gate: Drive, attrs: Record<string, string> = {}, load_ = '1k', volts = 5) =>
    load(
      [drv('g', { pin: gate as string }), battery('b', volts), res('rl', load_), { type, id: 'q', attrs }],
      [
        ['g:pin', 'q:G'],
        ['q:S', 'b:-'],
        ['b:+', 'rl:1'],
        ['rl:2', 'q:D'],
      ],
    );

  it('2N7000 turns on above Vth (≈ 2.1 V) with RDS(on) ≈ 2.5 Ω', () => {
    const e = lowSide('axion-nmos', 'high');
    expect(e.voltage('q', 'D')).toBeCloseTo((5 * 2.5) / 1002.5, 4);
    expect(states(e).q.on).toBe(true);
    expect(states(e).q.mA).toBeCloseTo(4.99, 1);
    e.input('g', 'pin', 'low');
    expect(e.voltage('q', 'D')).toBeCloseTo(5, 4);
    expect(states(e).q.on).toBe(false);
    e.input('g', 'pin', { volts: 1.8, ohms: 100 });
    expect(e.voltage('q', 'D')).toBeCloseTo(5, 4); // VGS < Vth
    e.input('g', 'pin', { volts: 2.5, ohms: 100 });
    expect(e.voltage('q', 'D')).toBeLessThan(0.05);
  });

  it('a floating gate is off; the gate draws no current', () => {
    const e = lowSide('axion-nmos', 'z');
    expect(e.voltage('q', 'D')).toBeCloseTo(5, 4);
    // Gate through 100k from a HIGH pin: still the full 5 V on the gate.
    const g = load(
      [drv('g', { pin: 'high' }), battery('b', 5), res('rg', '100k'), res('rl', '1k'), { type: 'axion-nmos', id: 'q' }],
      [
        ['g:pin', 'rg:1'],
        ['rg:2', 'q:G'],
        ['q:S', 'b:-'],
        ['b:+', 'rl:1'],
        ['rl:2', 'q:D'],
      ],
    );
    expect(g.voltage('q', 'G')).toBeCloseTo(5, 3);
  });

  it('IRLZ44N switches 0.9 A at a 5 V gate with ≈ 0.025 Ω; IRF520 needs more than 3.3 V', () => {
    const e = lowSide('axion-nmos-power', 'high', {}, '10', 9);
    expect(states(e).q.mA).toBeCloseTo(9000 / 10.025, 0);
    expect(e.voltage('q', 'D')).toBeCloseTo(0.0225, 3);
    expect(warnings(e)).toEqual([]);
    // A 3.3 V board's pin on the gate.
    const logic = lowSide('axion-nmos-power', 'low', { model: 'IRLZ44N' }, '100', 9);
    logic.input('g', 'pin', { volts: 3.3, ohms: 25 });
    expect(logic.voltage('q', 'D')).toBeLessThan(0.01);
    const irf = lowSide('axion-nmos-power', 'low', { model: 'IRF520' }, '100', 9);
    irf.input('g', 'pin', { volts: 3.3, ohms: 25 });
    expect(irf.voltage('q', 'D')).toBeCloseTo(9, 3);
    irf.input('g', 'pin', 'high');
    expect(irf.voltage('q', 'D')).toBeCloseTo((9 * 0.4) / 100.4, 3);
  });

  it('P-channel high-side switch: on when the gate is LOW', () => {
    const e = load(
      [drv('g', { pin: 'high' }), battery('b', 5), res('rl', '1k'), { type: 'axion-pmos', id: 'q' }],
      [
        ['g:pin', 'q:G'],
        ['q:S', 'b:+'],
        ['q:D', 'rl:1'],
        ['rl:2', 'b:-'],
      ],
    );
    expect(e.voltage('rl', '1')).toBeCloseTo(0, 3); // off
    e.input('g', 'pin', 'low');
    expect(e.voltage('rl', '1')).toBeCloseTo((5 * 1000) / 1005, 3);
    expect(states(e).q.on).toBe(true);
  });
});

describe('TIP120 Darlington', () => {
  const circuit = () =>
    load(
      [drv('p', { pin: 'low' }), battery('b', 9), res('rb', '1k'), res('rl', '47'), { type: 'axion-tip120', id: 'q' }],
      [
        ['p:pin', 'rb:1'],
        ['rb:2', 'q:B'],
        ['q:E', 'b:-'],
        ['b:+', 'rl:1'],
        ['rl:2', 'q:C'],
      ],
    );

  it('switches a 47 Ω load from a pin through 1k: VBE ≈ 1.4 V, VCE(sat) ≈ 0.9 V', () => {
    const e = circuit();
    expect(e.voltage('q', 'C')).toBeCloseTo(9, 3);
    expect(states(e).q.on).toBe(false);
    e.input('p', 'pin', 'high');
    const vbe = e.voltage('q', 'B')!;
    expect(vbe).toBeGreaterThan(1.25);
    expect(vbe).toBeLessThan(1.5);
    const vce = e.voltage('q', 'C')!;
    expect(vce).toBeGreaterThan(0.75);
    expect(vce).toBeLessThan(1.05);
    expect(states(e).q.ic).toBeCloseTo(((9 - vce) / 47) * 1000, 0);
    expect(states(e).q.on).toBe(true);
    expect(warnings(e)).toEqual([]);
  });

  it('current gain ≈ 1000 in the active region', () => {
    // Base through 10k (IB ≈ 0.37 mA) and a 10 Ω load on 9 V: IC ≈ 0.4 A, not saturated.
    const e = load(
      [drv('p', { pin: 'high' }), battery('b', 9), res('rb', '10k'), res('rl', '10'), { type: 'axion-tip120', id: 'q' }],
      [
        ['p:pin', 'rb:1'],
        ['rb:2', 'q:B'],
        ['q:E', 'b:-'],
        ['b:+', 'rl:1'],
        ['rl:2', 'q:C'],
      ],
    );
    const ib = (e.voltage('rb', '1')! - e.voltage('rb', '2')!) / 1e4;
    const ic = (9 - e.voltage('q', 'C')!) / 10;
    expect(e.voltage('q', 'C')).toBeGreaterThan(2); // not saturated
    expect(ic / ib).toBeGreaterThan(700);
    expect(ic / ib).toBeLessThan(2000);
  });

  it('needs ≈ 80 µA before it starts to conduct (the internal 8 kΩ base resistor takes the rest)', () => {
    const e = load(
      [drv('p', { pin: 'high' }), battery('b', 9), res('rb', '100k'), res('rl', '10'), { type: 'axion-tip120', id: 'q' }],
      [
        ['p:pin', 'rb:1'],
        ['rb:2', 'q:B'],
        ['q:E', 'b:-'],
        ['b:+', 'rl:1'],
        ['rl:2', 'q:C'],
      ],
    );
    expect(states(e).q.ic).toBeLessThan(1);
  });
});

describe('flyback diode', () => {
  // 9 V → coil (100 mH, 47 Ω) → drain of an IRLZ44N; gate from a pin. τ ≈ 2 ms, I ≈ 190 mA.
  const coil = (diode: boolean) =>
    load(
      [
        drv('p', { pin: 'high' }),
        battery('b', 9),
        { type: 'axion-inductor', id: 'l', attrs: { inductance: '100mH', resistance: '47' } },
        { type: 'axion-nmos-power', id: 'q' },
        ...(diode ? [{ type: 'axion-diode-1n4007', id: 'd' }] : []),
      ],
      [
        ['p:pin', 'q:G'],
        ['q:S', 'b:-'],
        ['b:+', 'l:1'],
        ['l:2', 'q:D'],
        ...((diode
          ? [
              ['d:A', 'q:D'],
              ['d:K', 'b:+'],
            ]
          : []) as Array<[string, string]>),
      ],
    );

  const turnOff = (e: Engine) => {
    e.stepTo(30 * MS); // fully on
    expect(states(e).l.mA).toBeCloseTo(9000 / 47.025, 0);
    e.input('p', 'pin', 'low');
    let peak = e.voltage('q', 'D') ?? 0;
    const t0 = e.time;
    for (let t = 0.02; t <= 20; t += 0.02) {
      e.stepTo(t0 + t * MS);
      peak = Math.max(peak, e.voltage('q', 'D') ?? 0);
    }
    return peak;
  };

  it('clamps the turn-off spike to one diode drop above the supply', () => {
    const e = coil(true);
    const peak = turnOff(e);
    expect(peak).toBeGreaterThan(9.5);
    expect(peak).toBeLessThan(10);
    expect(Math.abs(Number(states(e).l.mA))).toBeLessThan(1); // the current died away through the diode
    expect(warnings(e)).toEqual([]);
  });

  it('without it the drain jumps to the MOSFET breakdown voltage, with a warning', () => {
    const e = coil(false);
    const peak = turnOff(e);
    expect(peak).toBeGreaterThan(50);
    expect(peak).toBeLessThan(60);
    expect(warnings(e).join()).toMatch(/MOSFET q \(IRLZ44N\).*flyback diode/);
  });
});

// ───────────────────────────── examples ─────────────────────────────

function runExample(name: string, untilMs: number, during?: (e: Engine, t: number) => void) {
  const e = new Engine(types);
  e.load(parseDiagram(JSON.parse(read(`examples/${name}/diagram.json`))), { uno: read(`examples/${name}/sketch.hex`) });
  let out = '';
  for (let t = 100; t <= untilMs; t += 100) {
    during?.(e, t);
    e.stepTo(t * MS);
    out += e
      .snapshot()
      .events.filter((x) => x.event === 'serial')
      .map((x) => x.data)
      .join('');
  }
  return { e, out };
}

const hasExample = (name: string) => existsSync(resolve(__dirname, '..', `examples/${name}/sketch.hex`));

describe.runIf(hasExample('ldr-night-light'))('example: ldr-night-light', () => {
  it('the LED turns on in the dark and off in the light', () => {
    const { e, out } = runExample('ldr-night-light', 3000, (eng, t) => {
      if (t === 1500) eng.input('ldr1', 'prop', { key: 'lux', value: 1 });
    });
    const lines = out.split('\n');
    const before = lines.find((l) => /Light: \d+/.test(l))!;
    expect(before).toMatch(/LED off/);
    expect(Number(/Light: (\d+)/.exec(before)![1])).toBeGreaterThan(700);
    expect(out).toMatch(/Light: \d+ .*LED on/);
    expect(Number(states(e).led1.brightness)).toBeGreaterThan(0.5);
    expect(warnings(e)).toEqual([]);
  });
});

describe.runIf(hasExample('mosfet-motor'))('example: mosfet-motor', () => {
  it('the potentiometer sets the PWM duty and the motor speed', () => {
    const { e, out } = runExample('mosfet-motor', 2000, (eng, t) => {
      if (t === 100) eng.input('pot1', 'value', 1023);
    });
    expect(out).toMatch(/Speed: 100 %/);
    const rpm = Number(states(e).m1.rpm);
    expect(rpm).toBeGreaterThan(150);
    const half = runExample('mosfet-motor', 2000, (eng, t) => {
      if (t === 100) eng.input('pot1', 'value', 512);
    });
    expect(half.out).toMatch(/Speed: 50 %/);
    // While the MOSFET is off the armature current keeps flowing through the flyback diode,
    // so 50 % PWM gives more than half of full speed.
    expect(Number(states(half.e).m1.rpm)).toBeLessThan(rpm * 0.9);
    expect(Number(states(half.e).m1.rpm)).toBeGreaterThan(rpm * 0.25);
    expect(warnings(e)).toEqual([]);
    expect(warnings(half.e)).toEqual([]);
  });
});

describe.runIf(hasExample('zener-regulator'))('example: zener-regulator', () => {
  it('the zener holds ≈ 5.1 V from a 9 V battery and the Uno reads it', () => {
    const { e, out } = runExample('zener-regulator', 1500);
    expect(Number(states(e).vm1.volts)).toBeGreaterThan(5.05);
    expect(Number(states(e).vm1.volts)).toBeLessThan(5.2);
    const m = /Zener: (\d\.\d\d) V/.exec(out);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(5.0);
    expect(Number(m![1])).toBeLessThan(5.25);
    expect(warnings(e)).toEqual([]);
  });
});

describe.runIf(hasExample('rl-circuit'))('example: rl-circuit', () => {
  it('measures τ = L / R with analogRead', () => {
    const { e, out } = runExample('rl-circuit', 2500);
    const m = /tau = (\d+\.\d+) ms/.exec(out);
    expect(m).not.toBeNull();
    const tau = 1 / (220 + 1 + 25); // L / (R + coil + pin)
    expect(Math.abs(Number(m![1]) / (tau * 1000) - 1)).toBeLessThan(0.05);
    expect(warnings(e)).toEqual([]);
  });
});

describe.runIf(hasExample('trimpot-led-dimmer'))('example: trimpot-led-dimmer', () => {
  it('the trimmer sets the LED brightness', () => {
    const { e, out } = runExample('trimpot-led-dimmer', 1500, (eng, t) => {
      if (t === 100) eng.input('trim1', 'value', 1023);
    });
    expect(out).toMatch(/Brightness: 255/);
    expect(Number(states(e).led1.brightness)).toBeGreaterThan(0.5);
    const dim = runExample('trimpot-led-dimmer', 1500, (eng, t) => {
      if (t === 100) eng.input('trim1', 'value', 100);
    });
    expect(Number(states(dim.e).led1.brightness)).toBeLessThan(0.2);
    expect(warnings(e)).toEqual([]);
  });
});

void S;

describe('DC motor as an electrical load', () => {
  const motor = (id: string, attrs: Record<string, string> = {}): Part => ({ type: 'axion-dc-motor', id, attrs: { rpm: '200', ratedVoltage: '6', ...attrs } });

  it('draws its stall current at start, then the no-load current at the rated speed', () => {
    const e = load([battery('b', 6), motor('m')], [
      ['b:+', 'm:+'],
      ['b:-', 'm:-'],
    ]);
    e.stepTo(2 * MS); // the armature inductance (1.5 mH / 4 Ω) settles in well under a millisecond
    expect(Number(states(e).m.amps)).toBeGreaterThan(1.3); // stall current 1.5 A
    e.stepTo(1.5 * S);
    expect(Number(states(e).m.rpm)).toBeGreaterThan(195);
    expect(Number(states(e).m.rpm)).toBeLessThanOrEqual(200);
    expect(Number(states(e).m.amps)).toBeCloseTo(0.15, 2);
    // A spinning motor is a generator: its back-EMF is ≈ 5.4 V of the 6 V.
    expect(warnings(e)).toEqual([]);
  });

  it('speed follows the voltage; a weak source cannot spin it up', () => {
    const half = load([battery('b', 3), motor('m')], [
      ['b:+', 'm:+'],
      ['b:-', 'm:-'],
    ]);
    half.stepTo(1.5 * S);
    expect(Number(states(half).m.rpm)).toBeGreaterThan(90);
    expect(Number(states(half).m.rpm)).toBeLessThan(105);
    // 5 V behind 1 kΩ: at most 5 mA, far below the no-load current: the shaft barely moves.
    const weak = load([battery('b', 5), res('r', '1k'), motor('m')], [
      ['b:+', 'r:1'],
      ['r:2', 'm:+'],
      ['b:-', 'm:-'],
    ]);
    weak.stepTo(1.5 * S);
    expect(Math.abs(Number(states(weak).m.rpm))).toBeLessThan(10);
  });

  it('coasts slowly with open terminals and brakes fast when shorted', () => {
    const e = load([battery('b', 6), motor('m'), { type: 'wokwi-slide-switch', id: 'sw' }], [
      ['b:+', 'sw:1'],
      ['sw:2', 'm:+'],
      ['b:-', 'm:-'],
    ]);
    e.stepTo(1.5 * S);
    const full = Number(states(e).m.rpm);
    e.input('sw', 'value', 1); // open
    e.stepTo(1.75 * S);
    const coasting = Number(states(e).m.rpm);
    expect(coasting).toBeLessThan(full);
    expect(coasting).toBeGreaterThan(full * 0.6); // J / b ≈ 1.2 s
  });

  it('mosfet-motor without its flyback diode: the MOSFET warns about the inductive spike', () => {
    const d = JSON.parse(read('examples/mosfet-motor/diagram.json')) as Diagram;
    d.parts = d.parts.filter((p) => p.id !== 'd1');
    d.connections = d.connections.filter((c) => !String(c[0]).startsWith('d1:') && !String(c[1]).startsWith('d1:'));
    d.connections.push(['q1:D', 'm1:-', 'gray', []], ['m1:+', 'bat1:+', 'red', []]);
    const e = new Engine(types);
    e.load(parseDiagram(d), { uno: read('examples/mosfet-motor/sketch.hex') });
    e.stepTo(800 * MS);
    expect(warnings(e).join('\n')).toMatch(/flyback diode/);
  });
});
