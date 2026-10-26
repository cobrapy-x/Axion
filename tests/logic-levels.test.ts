// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/core/diagram';
import { Engine, type PartType } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import { cmosLogic, levelOf, type Level, type ModelFactory } from '../src/core/types';
import { ATMEGA328P } from '../src/mcu/avr';
import { avrBoard } from '../src/mcu/avr-board';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const MS = 1e6;
const manifest = (type: string) => ({ type, name: type, category: 'test', version: '1', license: 'Apache-2.0' });

describe('logic thresholds', () => {
  it('cmosLogic: 0.6 / 0.3 × VCC', () => {
    expect(levelOf(3.0)).toBe(1);
    expect(levelOf(1.5)).toBe(0);
    expect(levelOf(2.5)).toBe(null);
    const t = cmosLogic(3.3);
    expect(t.vih).toBeCloseTo(1.98);
    expect(t.vil).toBeCloseTo(0.99);
    expect(levelOf(2.5, t)).toBe(1);
    expect(levelOf(0.9, t)).toBe(0);
  });

  it('each part sees levels through its own thresholds (ctx.setLogic)', () => {
    const seen: Record<string, Level[]> = { five: [], three: [] };
    const source: ModelFactory = () => ({ drive: () => 2.5 });
    const listener =
      (name: string, vcc?: number): ModelFactory =>
      (ctx) => {
        if (vcc) ctx.setLogic?.(cmosLogic(vcc));
        return { onPinChange: (_pin, level) => seen[name].push(level) };
      };
    const types = new Map<string, PartType>([
      ['src', { manifest: manifest('src'), model: source }],
      ['l5', { manifest: manifest('l5'), model: listener('five') }],
      ['l3', { manifest: manifest('l3'), model: listener('three', 3.3) }],
    ]);
    const e = new Engine(types);
    e.load(
      parseDiagram({
        version: 1,
        parts: [
          { type: 'src', id: 's', top: 0, left: 0 },
          { type: 'l5', id: 'a', top: 0, left: 0 },
          { type: 'l3', id: 'b', top: 0, left: 0 },
        ],
        connections: [
          ['s:OUT', 'a:IN', '', []],
          ['s:OUT', 'b:IN', '', []],
        ],
      }),
    );
    expect(seen.five.at(-1)).toBe(null); // 2.5 V is in a 5 V part's undefined band
    expect(seen.three.at(-1)).toBe(1); //   and HIGH for a 3.3 V part
    expect(e.level('a', 'IN')).toBe(null);
    expect(e.level('b', 'IN')).toBe(1);
  });

  it('a 3.3 V board: 3.3 V outputs, 3.3 V thresholds and ADC reference', () => {
    const gpio: Record<string, [string, number]> = {};
    for (let i = 0; i <= 7; i++) gpio[String(i)] = ['D', i];
    for (let i = 8; i <= 13; i++) gpio[String(i)] = ['B', i - 8];
    for (let i = 0; i <= 5; i++) gpio[`A${i}`] = ['C', i];
    const types = loadPartTypes();
    types.set('test-mcu-3v3', {
      manifest: { ...manifest('test-mcu-3v3'), mcu: { arch: 'avr', fqbn: 'arduino:avr:pro' } },
      model: avrBoard({ chip: ATMEGA328P, gpio, power: { VCC: 3.3, GND: 0 }, adc: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'], vcc: 3.3 }),
    });
    const e = new Engine(types);
    e.load(
      parseDiagram({
        version: 1,
        parts: [
          { type: 'test-mcu-3v3', id: 'mcu', top: 0, left: 0 },
          { type: 'axion-battery', id: 'b', top: 0, left: 0, attrs: { voltage: '2.5' } },
          { type: 'wokwi-resistor', id: 'probe', top: 0, left: 0 },
        ],
        connections: [
          ['b:-', 'mcu:GND', '', []],
          ['b:+', 'mcu:2', '', []],
          ['b:+', 'mcu:A0', '', []],
          ['mcu:13', 'probe:1', '', []],
        ],
      }),
      { mcu: read('tests/fixtures/logic33.hex') },
    );
    let out = '';
    for (let t = 50; t <= 400; t += 50) {
      e.stepTo(t * MS);
      out += e
        .snapshot()
        .events.filter((x) => x.part === 'mcu' && x.event === 'serial')
        .map((x) => x.data)
        .join('');
    }
    expect(out).toContain('D2=1'); // 2.5 V ≥ 1.98 V
    const a0 = Number(/A0=(\d+)/.exec(out)?.[1]);
    expect(a0).toBeGreaterThanOrEqual(773); // 2.5 / 3.3 × 1023 ≈ 775
    expect(a0).toBeLessThanOrEqual(777);
    expect(e.voltage('mcu', '13')).toBeCloseTo(3.3, 2); // output HIGH is the board's own supply
  });
});
