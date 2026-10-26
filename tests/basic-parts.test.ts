// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram, type Diagram } from '../src/core/diagram';
import { Engine, type PartType } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import type { Drive, ModelFactory } from '../src/core/types';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const MS = 1e6;

// A tiny fake part: drives each pin as configured (attrs), changeable at runtime.
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
const types = new Map<string, PartType>([
  ...loadPartTypes(),
  ['test-driver', { manifest: { type: 'test-driver', name: 'T', category: 'test', version: '1', license: 'Apache-2.0' }, model: driver }],
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

const states = (e: Engine) => e.snapshot().states;

describe('slide switch', () => {
  it('connects the common leg to leg 1 or leg 3 and toggles on input', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { hi: 'high', lo: 'low' } },
        { type: 'wokwi-slide-switch', id: 'sw' },
      ],
      [
        ['d:hi', 'sw:1'],
        ['d:lo', 'sw:3'],
      ],
    );
    expect(e.level('sw', '2')).toBe(1); // handle left: 2 ↔ 1
    expect(states(e).sw.value).toBe(0);
    e.input('sw', 'value', 1);
    expect(e.level('sw', '2')).toBe(0); // handle right: 2 ↔ 3
    expect(states(e).sw.value).toBe(1);
    e.input('sw', 'value', 0);
    expect(e.level('sw', '2')).toBe(1);
  });

  it('starts in the position saved in its value property', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { hi: 'high' } },
        { type: 'wokwi-slide-switch', id: 'sw', attrs: { value: '1' } },
      ],
      [['d:hi', 'sw:3']],
    );
    expect(e.level('sw', '2')).toBe(1);
    expect(e.voltage('sw', '1')).toBe(null);
  });
});

describe('transistors (switching model)', () => {
  it('NPN conducts C→E when the base is ≥ 0.6 V above the emitter', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { b: 'low', gnd: 'low' } },
        { type: 'axion-npn', id: 'q' },
        { type: 'wokwi-resistor', id: 'rb' },
        { type: 'test-driver', id: 'probe', attrs: { p: 'pullup' } },
      ],
      [
        ['d:b', 'rb:1'],
        ['rb:2', 'q:B'],
        ['q:E', 'd:gnd'],
        ['q:C', 'probe:p'],
      ],
    );
    expect(e.level('q', 'C')).toBe(1); // off: the pull-up wins
    expect(states(e).q.on).toBe(false);
    e.input('d', 'b', 'high');
    expect(e.level('q', 'C')).toBe(0); // on: collector pulled to GND
    expect(states(e).q.on).toBe(true);
    e.input('d', 'b', 0.5); // below 0.6 V
    expect(e.level('q', 'C')).toBe(1);
  });

  it('PNP conducts E→C when the base is ≥ 0.6 V below the emitter', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { b: 'high', vcc: 'high' } },
        { type: 'axion-pnp', id: 'q' },
        { type: 'test-driver', id: 'probe', attrs: { p: 'pulldown' } },
      ],
      [
        ['d:b', 'q:B'],
        ['q:E', 'd:vcc'],
        ['q:C', 'probe:p'],
      ],
    );
    expect(e.level('q', 'C')).toBe(0);
    e.input('d', 'b', 'low');
    // Analog solver: with no base resistor ~70 mA of base current sags the emitter's
    // driving pin (25 Ω) to ~3.2 V, and C sits VCE(sat) ≈ 0.2 V below it.
    expect(e.voltage('q', 'C')).toBeCloseTo(3, 1);
    expect(e.voltage('q', 'E')! - e.voltage('q', 'C')!).toBeCloseTo(0.2, 1);
    e.input('d', 'b', 4.6); // only 0.4 V below the emitter
    expect(e.level('q', 'C')).toBe(0);
  });
});

describe('voltmeter', () => {
  it('reads V − COM with two decimals, or null when a probe floats', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { a: '3.3', b: '1.25' } },
        { type: 'axion-voltmeter', id: 'vm' },
      ],
      [
        ['d:a', 'vm:V'],
        ['d:b', 'vm:COM'],
      ],
    );
    expect(states(e).vm.volts).toBe(2.05);
    e.input('d', 'a', 0);
    expect(states(e).vm.volts).toBe(-1.25);
    e.input('d', 'b', 'z');
    expect(states(e).vm.volts).toBe(null);
  });
});

describe('batteries', () => {
  it.each([
    ['axion-battery-9v', 9],
    ['axion-battery-aa', 1.5],
    ['axion-coin-cell', 3],
    ['axion-battery-pack-4aa', 6],
  ])('%s gives %d V', (type, volts) => {
    const e = load(
      [
        { type, id: 'b' },
        { type: 'axion-voltmeter', id: 'vm' },
      ],
      [
        ['b:+', 'vm:V'],
        ['b:-', 'vm:COM'],
      ],
    );
    expect(e.voltage('b', '+')).toBe(volts);
    expect(e.voltage('b', '-')).toBe(0);
    expect(states(e).vm.volts).toBe(volts);
  });

  it.each([
    ['axion-battery-9v', '3', 27],
    ['axion-battery-aa', '8', 12],
    ['axion-coin-cell', '2', 6],
    ['axion-battery-aa', '20', 12], // clamped to the 8-cell maximum
  ])('%s with count %s gives %d V', (type, count, volts) => {
    const e = load(
      [
        { type, id: 'b', attrs: { count } },
        { type: 'axion-voltmeter', id: 'vm' },
      ],
      [
        ['b:+', 'vm:V'],
        ['b:-', 'vm:COM'],
      ],
    );
    expect(states(e).vm.volts).toBe(volts);
  });
});

describe('capacitors', () => {
  it('are open circuits in the DC model', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { hi: 'high' } },
        { type: 'axion-capacitor', id: 'c1' },
        { type: 'axion-capacitor-electrolytic', id: 'c2' },
      ],
      [
        ['d:hi', 'c1:1'],
        ['d:hi', 'c2:+'],
      ],
    );
    expect(e.voltage('c1', '2')).toBe(null);
    expect(e.voltage('c2', '-')).toBe(null);
    expect(e.snapshot().warnings).toEqual([]);
  });
});

describe('7-segment display', () => {
  // Segments A..G for "2" are A B D E G.
  const two = { A: 'high', B: 'high', C: 'low', D: 'high', E: 'high', F: 'low', G: 'high', DP: 'low' };
  const segs = Object.keys(two);
  const wires = (com: string): Array<[string, string]> => [...segs.map((s) => [`d:${s}`, `s:${s}`] as [string, string]), [`d:com`, `s:${com}`]];

  it('common cathode: lights segments driven HIGH', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { ...two, com: 'low' } },
        { type: 'wokwi-7segment', id: 's', attrs: { common: 'cathode' } },
      ],
      wires('COM.2'), // COM.1 and COM.2 are joined inside the part
    );
    e.stepTo(10 * MS);
    expect(states(e).s.values).toEqual([1, 1, 0, 1, 1, 0, 1, 0]);
  });

  it('common anode: lights segments driven LOW, nothing when COM floats', () => {
    const inverted = Object.fromEntries(Object.entries(two).map(([k, v]) => [k, v === 'high' ? 'low' : 'high']));
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { ...inverted, com: 'high' } },
        { type: 'wokwi-7segment', id: 's', attrs: { common: 'anode' } },
      ],
      wires('COM.1'),
    );
    expect(states(e).s.values).toEqual([1, 1, 0, 1, 1, 0, 1, 0]);
    e.input('d', 'com', 'z');
    states(e); // start a new averaging window
    expect(states(e).s.values).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('runs the counter example: shows 0, then 1', () => {
    const e = new Engine(loadPartTypes());
    e.load(parseDiagram(JSON.parse(read('examples/seven-segment-counter/diagram.json'))), {
      uno: read('examples/seven-segment-counter/sketch.hex'),
    });
    e.stepTo(200 * MS);
    states(e);
    // The single 220 Ω on COM shares ~14 mA between the lit segments (dim but lit, as on a
    // real display); count a segment as lit above 5 %, like the view does.
    const lit = () => (states(e).seg1.values as number[]).map((v) => (v > 0.05 ? 1 : 0));
    e.stepTo(300 * MS);
    expect(lit()).toEqual([1, 1, 1, 1, 1, 1, 0, 0]); // 0
    e.stepTo(600 * MS);
    states(e);
    e.stepTo(700 * MS);
    expect(lit()).toEqual([0, 1, 1, 0, 0, 0, 0, 0]); // 1
  });
});

describe('RGB LED', () => {
  it('averages PWM per channel (common cathode)', () => {
    const e = new Engine(loadPartTypes());
    e.load(parseDiagram(JSON.parse(read('examples/rgb-led-fade/diagram.json'))), { uno: read('examples/rgb-led-fade/sketch.hex') });
    // First phase (0 → ~1.06 s): red fades out while green fades in, blue off.
    e.stepTo(500 * MS);
    states(e);
    e.stepTo(560 * MS);
    const mid = states(e).rgb1 as { r: number; g: number; b: number };
    expect(mid.r).toBeGreaterThan(0.2);
    expect(mid.r).toBeLessThan(0.8);
    expect(mid.g).toBeGreaterThan(0.2);
    expect(mid.g).toBeLessThan(0.8);
    // Brightness follows current (full at 20 mA): 220 Ω gives red ~12.5 mA, green ~11.4 mA at
    // 100 % duty, so the two duty cycles adding up to 1 give ~0.6 together.
    expect(mid.r + mid.g).toBeCloseTo(0.6, 1);
    expect(mid.b).toBe(0);
    // Second phase: green → blue, red off.
    e.stepTo(1600 * MS);
    states(e);
    e.stepTo(1660 * MS);
    const later = states(e).rgb1 as { r: number; g: number; b: number };
    expect(later.r).toBe(0);
    expect(later.b).toBeGreaterThan(0.2);
  });

  it('common anode lights a channel driven LOW', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { com: 'high', r: 'low', g: 'high', b: 'z' } },
        { type: 'wokwi-rgb-led', id: 'led', attrs: { common: 'anode' } },
      ],
      [
        ['d:com', 'led:COM'],
        ['d:r', 'led:R'],
        ['d:g', 'led:G'],
        ['d:b', 'led:B'],
      ],
    );
    e.stepTo(5 * MS);
    expect(states(e).led).toEqual({ r: 1, g: 0, b: 0 });
  });
});

describe('piezo buzzer', () => {
  it('measures the tone() frequency of the melody example', () => {
    const e = new Engine(loadPartTypes());
    e.load(parseDiagram(JSON.parse(read('examples/buzzer-melody/diagram.json'))), { uno: read('examples/buzzer-melody/sketch.hex') });
    const heard = new Set<number>();
    let serial = '';
    let silent = 0;
    for (let t = 20; t <= 4400; t += 20) {
      e.stepTo(t * MS);
      const snap = e.snapshot();
      serial += snap.events.filter((x) => x.event === 'serial').map((x) => x.data).join('');
      const s = snap.states.bz1 as { on: boolean; frequency: number };
      if (s.on) heard.add(s.frequency);
      else silent++;
    }
    expect(serial).toContain('C4 (262 Hz)');
    expect(serial).toContain('G4 (392 Hz)');
    // Twinkle twinkle: C C G G A A G F F E E D D C
    expect([...heard].every((h) => [262, 294, 330, 349, 392, 440].some((f) => Math.abs(h - f) <= 2))).toBe(true);
    for (const f of [262, 392, 440, 349, 330, 294]) {
      expect([...heard].some((h) => Math.abs(h - f) <= 2)).toBe(true);
    }
    expect(silent).toBeGreaterThan(0); // the short gaps between notes
  });
});

describe('new examples run cleanly', () => {
  it.each(['rgb-led-fade', 'buzzer-melody', 'seven-segment-counter', 'transistor-switch'])('%s has no warnings', (name) => {
    const e = new Engine(loadPartTypes());
    e.load(parseDiagram(JSON.parse(read(`examples/${name}/diagram.json`))), { uno: read(`examples/${name}/sketch.hex`) });
    e.stepTo(2500 * MS);
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('transistor-switch: LED and voltmeter follow the base pin', () => {
    const e = new Engine(loadPartTypes());
    e.load(parseDiagram(JSON.parse(read('examples/transistor-switch/diagram.json'))), { uno: read('examples/transistor-switch/sketch.hex') });
    e.stepTo(400 * MS);
    states(e);
    e.stepTo(500 * MS);
    let s = states(e);
    expect(s.q1.on).toBe(true);
    // ~13.6 mA through 220 Ω (full brightness is 20 mA); the voltmeter across the LED shows its ~1.86 V drop.
    expect(s.led1.brightness).toBeCloseTo(0.68, 1);
    expect(s.vm1.volts).toBeCloseTo(1.86, 1);
    e.stepTo(1400 * MS);
    states(e);
    e.stepTo(1500 * MS);
    s = states(e);
    expect(s.q1.on).toBe(false);
    expect(s.led1.brightness).toBe(0);
    expect(s.vm1.volts).toBe(null); // the cathode side floats while the transistor is off
  });
});
