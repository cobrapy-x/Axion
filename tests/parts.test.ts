// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/core/diagram';
import { Engine } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const MS = 1e6;

function load(diagram: unknown, firmware: Record<string, string> = {}) {
  const e = new Engine(loadPartTypes());
  e.load(parseDiagram(diagram), firmware);
  return e;
}

function loadExample(name: string, firmware: Record<string, string>) {
  return load(JSON.parse(read(`examples/${name}/diagram.json`)), firmware);
}

let last: ReturnType<Engine['snapshot']>;

/** Run until `ms` and return all serial output of `part`. The final snapshot is kept in `last`. */
function serial(e: Engine, part: string, ms: number, everyMs = 100): string {
  let out = '';
  for (let t = e.time / MS + everyMs; t <= ms; t += everyMs) {
    e.stepTo(t * MS);
    last = e.snapshot();
    out += last.events
      .filter((x) => x.part === part && x.event === 'serial')
      .map((x) => x.data)
      .join('');
  }
  return out;
}

describe('analog parts', () => {
  it('potentiometer outputs a fraction of VCC', () => {
    const e = load({
      version: 1,
      parts: [
        { type: 'axion-battery', id: 'b', top: 0, left: 0, attrs: { voltage: '5' } },
        { type: 'wokwi-potentiometer', id: 'p', top: 0, left: 0, attrs: { value: '256' } },
        { type: 'wokwi-resistor', id: 'probe', top: 0, left: 0 },
      ],
      connections: [
        ['b:+', 'p:VCC', '', []],
        ['b:-', 'p:GND', '', []],
        ['p:SIG', 'probe:1', '', []],
      ],
    });
    expect(e.voltage('p', 'SIG')).toBeCloseTo(1.25, 2);
    e.input('p', 'value', 1023);
    expect(e.voltage('p', 'SIG')).toBeCloseTo(5, 2);
    expect(e.level('p', 'SIG')).toBe(1);
  });

  it('L298N switches its outputs from the inputs and floats them when disabled', () => {
    const e = load({
      version: 1,
      parts: [
        { type: 'axion-battery', id: 'b', top: 0, left: 0, attrs: { voltage: '12' } },
        { type: 'axion-battery', id: 'logic', top: 0, left: 0, attrs: { voltage: '5' } },
        { type: 'axion-l298n', id: 'd', top: 0, left: 0 },
        { type: 'axion-dc-motor', id: 'm', top: 0, left: 0 },
        { type: 'wokwi-resistor', id: 'probe', top: 0, left: 0 },
      ],
      connections: [
        ['d:OUT1', 'm:+', '', []],
        ['d:OUT2', 'm:-', '', []],
        ['d:5V', 'probe:1', '', []],
        ['b:+', 'd:12V', '', []],
        ['b:-', 'd:GND', '', []],
        ['logic:+', 'd:IN1', '', []],
        ['logic:-', 'd:IN2', '', []],
      ],
    });
    expect(e.voltage('d', 'OUT1')).toBeCloseTo(10.6, 1); // 12 V minus the bridge drop
    expect(e.voltage('d', 'OUT2')).toBe(0);
    expect(e.voltage('d', '5V')).toBe(5);
    e.stepTo(500 * MS);
    expect(e.snapshot().states.m.rpm).toBeGreaterThan(200); // 10.6 V on a 6 V motor: over-driven
  });
});

describe('examples with new parts', () => {
  it('servo follows the potentiometer (Servo.h + analogRead)', () => {
    const e = loadExample('servo-knob', { uno: read('examples/servo-knob/sketch.hex') });
    const out = serial(e, 'uno', 1000);
    expect(out).toContain('pot=300  angle=52');
    expect(last.states.servo1.angle).toBeCloseTo(52, -1);
    e.input('pot1', 'value', 1023);
    const out2 = serial(e, 'uno', 2000);
    expect(out2).toContain('angle=180');
    expect(last.states.servo1.angle).toBeGreaterThan(175);
  });

  it('encoder motor: speed, direction and RPM measured by interrupts', () => {
    const e = loadExample('motor-encoder', { uno: read('examples/motor-encoder/sketch.hex') });
    const fwd = serial(e, 'uno', 2000);
    const rpms = [...fwd.matchAll(/rpm=(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(rpms.at(-1)).toBeGreaterThan(100);
    // The measured RPM matches the motor's own speed.
    expect(rpms.at(-1)).toBeCloseTo(Number(last.states.motor1.rpm), -1);
    e.input('pot1', 'value', 100); // turn the knob left: reverse
    const rev = serial(e, 'uno', 3500);
    const rpms2 = [...rev.matchAll(/rpm=(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(rpms2.at(-1)).toBeLessThan(-100);
    expect(last.warnings).toEqual([]);
  });

  it('Mega drives two encoder motors with four external interrupts', () => {
    const e = loadExample('mega-two-motors', { mega: read('examples/mega-two-motors/sketch.hex') });
    // Reports every 500 ms: 0-2 s forward, 2-3 s turn on the spot.
    const out = serial(e, 'mega', 3100);
    const m = [...out.matchAll(/left=(-?[\d.]+) turns {2}right=(-?[\d.]+)/g)].map((x) => [Number(x[1]), Number(x[2])]);
    expect(m.length).toBe(6);
    const [l2s, r2s] = m[3]; // t = 2 s
    expect(l2s).toBeGreaterThan(3); // both wheels went forward the same distance
    expect(Math.abs(l2s - r2s)).toBeLessThan(0.05);
    const [l3s, r3s] = m[5]; // t = 3 s
    expect(l3s).toBeGreaterThan(l2s + 0.5); // left keeps going forward…
    expect(r3s).toBeLessThan(r2s - 0.5); //    …right reverses
  });
});

describe('more microcontrollers', () => {
  it('Mega: timers 2-5 PWM, Servo on timer 5, ADC channels 0-15, INT3/INT4', () => {
    const e = load(
      {
        version: 1,
        parts: [
          { type: 'wokwi-arduino-mega', id: 'mega', top: 0, left: 0 },
          { type: 'wokwi-potentiometer', id: 'pot', top: 0, left: 0, attrs: { value: '512' } },
          { type: 'wokwi-led', id: 'l5', top: 0, left: 0 },
          { type: 'wokwi-led', id: 'l6', top: 0, left: 0 },
          { type: 'wokwi-led', id: 'l9', top: 0, left: 0 },
          { type: 'wokwi-servo', id: 'sv', top: 0, left: 0 },
        ],
        connections: [
          ['pot:VCC', 'mega:5V', '', []],
          ['pot:GND', 'mega:GND.1', '', []],
          ['pot:SIG', 'mega:A0', '', []],
          ['mega:A8', 'mega:3.3V', '', []],
          ['mega:30', 'mega:2', '', []],
          ['mega:30', 'mega:18', '', []],
          ['mega:5', 'l5:A', '', []],
          ['l5:C', 'mega:GND.2', '', []],
          ['mega:6', 'l6:A', '', []],
          ['l6:C', 'mega:GND.2', '', []],
          ['mega:9', 'l9:A', '', []],
          ['l9:C', 'mega:GND.2', '', []],
          ['mega:44', 'sv:PWM', '', []],
          ['sv:V+', 'mega:5V.1', '', []],
          ['sv:GND', 'mega:GND.3', '', []],
        ],
      },
      { mega: read('tests/fixtures/mega-check.hex') },
    );
    const out = serial(e, 'mega', 1500);
    expect(out).toContain('mega ready');
    expect(out).toContain('A0=512 A8=675');
    const ticks = [...out.matchAll(/i2=(\d+) i18=(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(ticks.at(-1)![0]).toBeGreaterThanOrEqual(5);
    expect(ticks.at(-1)![0]).toBe(ticks.at(-1)![1]);
    const s = last.states;
    expect(s.l5.brightness).toBeCloseTo(0.25, 1); // analogWrite(5, 64)  → timer 3
    expect(s.l6.brightness).toBeCloseTo(0.5, 1); //  analogWrite(6, 128) → timer 4
    expect(s.l9.brightness).toBeCloseTo(0.75, 1); // analogWrite(9, 192) → timer 2
    expect(s.sv.angle).toBeCloseTo(45, 0); //        Servo.h on timer 5
  });

  it('Nano: analog-only pin A7 and PWM', () => {
    const e = load(
      {
        version: 1,
        parts: [
          { type: 'wokwi-arduino-nano', id: 'nano', top: 0, left: 0 },
          { type: 'wokwi-led', id: 'led', top: 0, left: 0 },
        ],
        connections: [
          ['nano:A7', 'nano:3.3V', '', []],
          ['nano:3', 'led:A', '', []],
          ['led:C', 'nano:GND.1', '', []],
        ],
      },
      { nano: read('tests/fixtures/nano-check.hex') },
    );
    const out = serial(e, 'nano', 500);
    expect(out).toContain('A7=675');
    expect(last.states.led.brightness).toBeCloseTo(0.5, 1);
  });
});
