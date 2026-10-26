// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram, type Diagram } from '../src/core/diagram';
import { Engine, type PartType } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import type { Drive, ModelFactory } from '../src/core/types';

const ex = (p: string) => readFileSync(resolve(__dirname, '../examples', p), 'utf8');
const MS = 1e6;

function serialOf(engine: Engine, part: string): string {
  return engine
    .snapshot()
    .events.filter((e) => e.part === part && e.event === 'serial')
    .map((e) => e.data)
    .join('');
}

describe('netlist solver', () => {
  // A tiny fake part: drives each pin as configured, records what it sees.
  const driver: ModelFactory = (ctx) => ({
    drive: (pin) => (ctx.props[pin] as Drive) ?? 'z',
  });
  const types = new Map<string, PartType>([
    ...loadPartTypes(),
    ['test-driver', { manifest: { type: 'test-driver', name: 'T', category: 'test', version: '1', license: 'Apache-2.0' }, model: driver }],
  ]);
  const diagram = (attrs: Record<string, string>, connections: Diagram['connections'], extra: Diagram['parts'] = []) =>
    parseDiagram({
      version: 1,
      parts: [{ type: 'test-driver', id: 'd', top: 0, left: 0, attrs }, ...extra],
      connections,
    });

  it('strong drive beats pull-up', () => {
    const e = new Engine(types);
    e.load(diagram({ a: 'pullup', b: 'low' }, [['d:a', 'd:b', 'g', []]]));
    expect(e.level('d', 'a')).toBe(0);
  });

  it('resistor to a strong rail beats an internal pull-up', () => {
    const e = new Engine(types);
    e.load(
      diagram({ in: 'pullup', gnd: 'low' }, [['d:in', 'r1:1', 'g', []], ['r1:2', 'd:gnd', 'g', []]], [
        { type: 'wokwi-resistor', id: 'r1', top: 0, left: 0 },
      ]),
    );
    expect(e.level('d', 'in')).toBe(0);
  });

  it('pushbutton connects its two sides only while pressed', () => {
    const e = new Engine(types);
    e.load(
      diagram({ in: 'pullup', gnd: 'low' }, [['d:in', 'b:1.l', 'g', []], ['b:2.r', 'd:gnd', 'g', []]], [
        { type: 'wokwi-pushbutton', id: 'b', top: 0, left: 0 },
      ]),
    );
    expect(e.level('d', 'in')).toBe(1);
    e.input('b', 'press');
    expect(e.level('d', 'in')).toBe(0);
    e.input('b', 'release');
    expect(e.level('d', 'in')).toBe(1);
  });

  it('reports a short circuit', () => {
    const e = new Engine(types);
    e.load(diagram({ a: 'high', b: 'low' }, [['d:a', 'd:b', 'g', []]]));
    expect(e.level('d', 'a')).toBe(null);
    expect(e.snapshot().warnings.join()).toMatch(/Short circuit/);
  });
});

describe('Arduino Uno firmware (avr8js)', () => {
  it('runs the blink-button example: blink, PWM fade, button, serial', () => {
    const e = new Engine(loadPartTypes());
    e.load(parseDiagram(JSON.parse(ex('blink-button/diagram.json'))), { uno: ex('blink-button/sketch.hex') });

    e.stepTo(250 * MS);
    expect(serialOf(e, 'uno')).toContain('Axion demo');

    // Red LED toggles every 500 ms
    const seen = new Set<number>();
    for (let t = 300; t <= 1600; t += 100) {
      e.stepTo(t * MS);
      // The lit LED's anode sits at its forward voltage (~1.86 V), below the logic HIGH threshold.
      const v = e.voltage('led1', 'A');
      seen.add(v === null ? -1 : v > 1.5 ? 1 : 0);
    }
    expect(seen).toEqual(new Set([0, 1]));

    // Green LED is PWM driven: brightness takes intermediate values
    const brightness: number[] = [];
    for (let t = 1600; t <= 2600; t += 50) {
      e.stepTo(t * MS);
      brightness.push(e.snapshot().states.led2.brightness as number);
    }
    expect(brightness.some((b) => b > 0.1 && b < 0.9)).toBe(true);

    // Button press is seen by the firmware
    e.input('btn1', 'press');
    e.stepTo(2700 * MS);
    expect(serialOf(e, 'uno')).toContain('Button pressed');

    // Serial input is echoed
    e.input('uno', 'serial', 'x');
    e.stepTo(2800 * MS);
    expect(serialOf(e, 'uno')).toContain('You typed: x');
  });

  it('two Unos talk over a TX→RX wire (multi-MCU)', () => {
    const e = new Engine(loadPartTypes());
    e.load(parseDiagram(JSON.parse(ex('two-unos-serial/diagram.json'))), {
      uno1: ex('two-unos-serial/sender.hex'),
      uno2: ex('two-unos-serial/receiver.hex'),
    });
    let rx = '';
    const levels = new Set<number>();
    for (let t = 100; t <= 2100; t += 100) {
      e.stepTo(t * MS);
      rx += serialOf(e, 'uno2');
      levels.add(e.level('led1', 'A') ?? -1);
    }
    expect(rx).toContain('Received: N0');
    expect(rx).toContain('Received: N3');
    expect(levels).toEqual(new Set([0, 1]));
  });
});
