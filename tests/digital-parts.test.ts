// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram, type Diagram } from '../src/core/diagram';
import { Engine, type PartType } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import type { Drive, ModelFactory } from '../src/core/types';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const US = 1e3;
const MS = 1e6;

// A tiny fake part: drives each pin as configured (attrs), changeable at runtime.
// It also timestamps every level change it sees on its pins (`edges`).
const edges: Array<{ pin: string; level: number | null; t: number }> = [];
const driver: ModelFactory = (ctx) => {
  const drives: Record<string, Drive> = {};
  for (const [k, v] of Object.entries(ctx.props)) drives[k] = (typeof v === 'string' && /^-?[\d.]+$/.test(v) ? Number(v) : v) as Drive;
  return {
    drive: (pin) => drives[pin] ?? 'z',
    onPinChange(pin, level) {
      edges.push({ pin, level, t: ctx.now() });
    },
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
function load(parts: Part[], connections: Array<[string, string]>): Engine {
  const e = new Engine(types);
  const diagram: Diagram = parseDiagram({
    version: 1,
    parts: parts.map((p) => ({ top: 0, left: 0, ...p })),
    connections: connections.map(([a, b]) => [a, b, '', []]),
  });
  e.load(diagram);
  return e;
}
const states = (e: Engine) => e.snapshot().states;
/** LED brightness as on/off: the analog solver scales brightness with current. */
const lit = (s: Record<string, unknown> | undefined) => {
  const b = Number((s as { brightness?: number } | undefined)?.brightness);
  return b > 0.3 ? 1 : b < 0.05 ? 0 : b;
};

function runExample(name: string): Engine {
  const e = new Engine(loadPartTypes());
  const meta = JSON.parse(read(`examples/${name}/example.json`)) as { sketches: Record<string, string> };
  const firmware: Record<string, string> = {};
  for (const [mcu, file] of Object.entries(meta.sketches)) firmware[mcu] = read(`examples/${name}/${file.replace(/\.ino$/, '.hex')}`);
  e.load(parseDiagram(JSON.parse(read(`examples/${name}/diagram.json`))), firmware);
  return e;
}
/** Advance and collect serial output. */
function serialUntil(e: Engine, ms: number, out = { text: '' }): string {
  for (let t = Math.ceil(e.time / MS / 10) * 10; t <= ms; t += 10) {
    e.stepTo(t * MS);
    out.text += e
      .snapshot()
      .events.filter((x) => x.event === 'serial')
      .map((x) => x.data)
      .join('');
  }
  return out.text;
}

describe('DIP switch (8)', () => {
  it('connects each pin pair while its switch is ON and toggles on input', () => {
    const conns: Array<[string, string]> = [];
    for (let i = 1; i <= 8; i++) conns.push([`d:lo`, `dip:${i}b`], [`p:p${i}`, `dip:${i}a`]);
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { lo: 'low' } },
        { type: 'test-driver', id: 'p', attrs: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`p${i}`, 'pullup'])) },
        { type: 'wokwi-dip-switch-8', id: 'dip', attrs: { value: '10000001' } },
      ],
      conns,
    );
    const read8 = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => e.level('dip', `${i}a`)).join('');
    expect(read8()).toBe('01111110'); // ON switches pull their pin LOW
    expect(states(e).dip.value).toBe('10000001');
    e.input('dip', 'value', '00110000');
    expect(read8()).toBe('11001111');
    expect(states(e).dip.value).toBe('00110000');
    e.input('dip', 'value', '00000000');
    expect(read8()).toBe('11111111');
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('defaults to all OFF', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { hi: 'high' } },
        { type: 'wokwi-dip-switch-8', id: 'dip' },
      ],
      [['d:hi', 'dip:1a']],
    );
    expect(e.voltage('dip', '1b')).toBe(null);
    e.input('dip', 'value', '1');
    expect(e.level('dip', '1b')).toBe(1);
  });
});

describe('membrane keypad', () => {
  const rows = ['R1', 'R2', 'R3', 'R4'];
  const cols = ['C1', 'C2', 'C3', 'C4'];
  /** Rows pulled up, one column driven LOW: which rows read LOW? */
  function setup() {
    return load(
      [
        { type: 'test-driver', id: 'r', attrs: { R1: 'pullup', R2: 'pullup', R3: 'pullup', R4: 'pullup' } },
        { type: 'test-driver', id: 'c', attrs: { C1: 'pullup', C2: 'pullup', C3: 'pullup', C4: 'pullup' } },
        { type: 'wokwi-membrane-keypad', id: 'kp' },
      ],
      [...rows.map((p) => [`r:${p}`, `kp:${p}`] as [string, string]), ...cols.map((p) => [`c:${p}`, `kp:${p}`] as [string, string])],
    );
  }

  it('pressing a key connects its row and column, in both directions', () => {
    const e = setup();
    e.input('kp', 'press', { key: '6', row: 1, column: 2 });
    // Scan by columns: drive C3 LOW, R2 follows.
    e.input('c', 'C3', 'low');
    expect(rows.map((p) => e.level('kp', p))).toEqual([1, 0, 1, 1]);
    e.input('c', 'C3', 'pullup');
    // Scan by rows: drive R2 LOW, C3 follows.
    e.input('r', 'R2', 'low');
    expect(cols.map((p) => e.level('kp', p))).toEqual([1, 1, 0, 1]);
    expect(states(e).kp.pressed).toEqual(['6']);
    e.input('kp', 'release', { key: '6', row: 1, column: 2 });
    expect(cols.map((p) => e.level('kp', p))).toEqual([1, 1, 1, 1]);
    expect(states(e).kp.pressed).toEqual([]);
  });

  it('holds two keys at once', () => {
    const e = setup();
    e.input('kp', 'press', { key: '1', row: 0, column: 0 });
    e.input('kp', 'press', { key: 'D', row: 3, column: 3 });
    expect(states(e).kp.pressed).toEqual(['1', 'D']);
    e.input('r', 'R1', 'low');
    expect(cols.map((p) => e.level('kp', p))).toEqual([0, 1, 1, 1]);
    e.input('r', 'R1', 'pullup');
    e.input('r', 'R4', 'low');
    expect(cols.map((p) => e.level('kp', p))).toEqual([1, 1, 1, 0]);
    e.input('kp', 'release', { key: '1', row: 0, column: 0 });
    expect(states(e).kp.pressed).toEqual(['D']);
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('accepts a key label alone', () => {
    const e = setup();
    e.input('kp', 'press', { key: '#' });
    e.input('r', 'R4', 'low');
    expect(cols.map((p) => e.level('kp', p))).toEqual([1, 1, 0, 1]);
  });
});

describe('logic gates', () => {
  const table: Record<string, number[]> = {
    // Y for (A,B) = 00, 01, 10, 11
    'axion-gate-and': [0, 0, 0, 1],
    'axion-gate-or': [0, 1, 1, 1],
    'axion-gate-nand': [1, 1, 1, 0],
    'axion-gate-nor': [1, 0, 0, 0],
    'axion-gate-xor': [0, 1, 1, 0],
    'axion-gate-xnor': [1, 0, 0, 1],
  };
  const gate = (type: string, vcc = '5') =>
    load(
      [
        { type: 'test-driver', id: 'd', attrs: { vcc, gnd: 'low', a: 'low', b: 'low' } },
        { type, id: 'g' },
      ],
      [
        ['d:vcc', 'g:VCC'],
        ['d:gnd', 'g:GND'],
        ['d:a', 'g:A'],
        ['d:b', 'g:B'],
        ['d:y', 'g:Y'], // a probe: unconnected pins are not tracked by the engine
      ],
    );

  it.each(Object.entries(table))('%s follows its truth table', (type, ys) => {
    const e = gate(type);
    [0, 1, 2, 3].forEach((i) => {
      e.input('d', 'a', i & 2 ? 'high' : 'low');
      e.input('d', 'b', i & 1 ? 'high' : 'low');
      expect(e.level('g', 'Y')).toBe(ys[i]);
    });
    expect(states(e).g).toMatchObject({ powered: true, hint: '' });
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('NOT inverts its input', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { vcc: 'high', gnd: 'low', a: 'low' } },
        { type: 'axion-gate-not', id: 'g' },
      ],
      [
        ['d:vcc', 'g:VCC'],
        ['d:gnd', 'g:GND'],
        ['d:a', 'g:A'],
        ['d:y', 'g:Y'],
      ],
    );
    expect(e.level('g', 'Y')).toBe(1);
    e.input('d', 'a', 'high');
    expect(e.level('g', 'Y')).toBe(0);
  });

  it('output follows the supply voltage (3.3 V)', () => {
    const e = gate('axion-gate-or', '3.3');
    e.input('d', 'a', 3.3);
    expect(e.voltage('g', 'Y')).toBe(3.3);
  });

  it('does not drive its output without power', () => {
    const e = gate('axion-gate-nand', 'z');
    expect(e.voltage('g', 'Y')).toBe(null);
    expect(states(e).g).toMatchObject({ powered: false, y: null });
    expect(String(states(e).g.hint)).toContain('not powered');
    e.input('d', 'vcc', 'high');
    expect(e.level('g', 'Y')).toBe(1);
  });

  it('a floating input leaves the output undriven and explains why', () => {
    const e = gate('axion-gate-and');
    e.input('d', 'b', 'z');
    expect(e.voltage('g', 'Y')).toBe(null);
    const s = states(e).g;
    expect(s.y).toBe(null);
    expect(s.inputs).toEqual([0, null]);
    expect(String(s.hint)).toContain('input B floating');
  });

  it('chains: NOT(AND(A, B)) equals NAND', () => {
    const e = load(
      [
        { type: 'test-driver', id: 'd', attrs: { vcc: 'high', gnd: 'low', a: 'high', b: 'high' } },
        { type: 'axion-gate-and', id: 'g1' },
        { type: 'axion-gate-not', id: 'g2' },
      ],
      [
        ['d:vcc', 'g1:VCC'],
        ['d:vcc', 'g2:VCC'],
        ['d:gnd', 'g1:GND'],
        ['d:gnd', 'g2:GND'],
        ['d:a', 'g1:A'],
        ['d:b', 'g1:B'],
        ['g1:Y', 'g2:A'],
        ['d:y', 'g2:Y'],
      ],
    );
    expect(e.level('g2', 'Y')).toBe(0);
    e.input('d', 'b', 'low');
    expect(e.level('g2', 'Y')).toBe(1);
  });
});

describe('relay module', () => {
  const relay = (attrs: Record<string, string> = {}, inDrive = 'low') =>
    load(
      [
        { type: 'test-driver', id: 'd', attrs: { vcc: 'high', gnd: 'low', in: inDrive, com: '9' } },
        { type: 'wokwi-relay-module', id: 'k', attrs },
      ],
      [
        ['d:vcc', 'k:VCC'],
        ['d:gnd', 'k:GND'],
        ['d:in', 'k:IN'],
        ['d:com', 'k:COM'],
        ['d:no', 'k:NO'], // probes
        ['d:nc', 'k:NC'],
      ],
    );

  it('switches COM from NC to NO about 10 ms after IN goes HIGH, and back after release', () => {
    const e = relay();
    expect(e.voltage('k', 'NC')).toBe(9);
    expect(e.voltage('k', 'NO')).toBe(null);
    e.stepTo(1 * MS);
    e.input('d', 'in', 'high');
    expect(states(e).k).toMatchObject({ coil: true, closed: false, powered: true });
    e.stepTo(10.9 * MS);
    expect(e.voltage('k', 'NO')).toBe(null); // still moving
    e.stepTo(11.1 * MS);
    expect(e.voltage('k', 'NO')).toBe(9);
    expect(e.voltage('k', 'NC')).toBe(null);
    expect(states(e).k).toMatchObject({ closed: true, clicks: 1 });
    e.input('d', 'in', 'low');
    e.stepTo(15.9 * MS);
    expect(e.voltage('k', 'NO')).toBe(9);
    e.stepTo(16.2 * MS);
    expect(e.voltage('k', 'NC')).toBe(9);
    expect(e.voltage('k', 'NO')).toBe(null);
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('ignores a pulse shorter than the operate time', () => {
    const e = relay();
    e.input('d', 'in', 'high');
    e.stepTo(3 * MS);
    e.input('d', 'in', 'low');
    e.stepTo(30 * MS);
    expect(e.voltage('k', 'NO')).toBe(null);
    expect(states(e).k.clicks).toBe(0);
  });

  it('active-low option: IN LOW energises, floating IN stays off', () => {
    const e = relay({ trigger: 'low' }, 'z');
    e.stepTo(20 * MS);
    expect(e.voltage('k', 'NO')).toBe(null);
    e.input('d', 'in', 'low');
    e.stepTo(31 * MS);
    expect(e.voltage('k', 'NO')).toBe(9);
    e.input('d', 'in', 'high');
    e.stepTo(40 * MS);
    expect(e.voltage('k', 'NC')).toBe(9);
  });

  it('does nothing without VCC', () => {
    const e = relay({}, 'high');
    e.input('d', 'vcc', 'z');
    e.stepTo(30 * MS);
    expect(e.voltage('k', 'NC')).toBe(9);
    expect(states(e).k).toMatchObject({ powered: false, coil: false });
  });
});

describe('HC-SR04 ultrasonic sensor', () => {
  const sonar = (distance?: string) => {
    edges.length = 0;
    return load(
      [
        { type: 'test-driver', id: 'd', attrs: { vcc: 'high', gnd: 'low', trig: 'low', echo: 'z' } },
        { type: 'wokwi-hc-sr04', id: 's', attrs: distance === undefined ? {} : { distance } },
      ],
      [
        ['d:vcc', 's:VCC'],
        ['d:gnd', 's:GND'],
        ['d:trig', 's:TRIG'],
        ['d:echo', 's:ECHO'],
      ],
    );
  };
  /** Trigger with a pulse of `widthUs` at `atMs`; return the ECHO pulse width in µs (0 if none). */
  function ping(e: Engine, atMs: number, widthUs = 10): number {
    e.stepTo(atMs * MS);
    e.input('d', 'trig', 'high');
    e.stepTo(atMs * MS + widthUs * US);
    e.input('d', 'trig', 'low');
    const start = edges.length;
    e.stepTo(atMs * MS + 45 * MS);
    const echo = edges.slice(start).filter((x) => x.pin === 'echo');
    const rise = echo.find((x) => x.level === 1);
    const fall = echo.find((x) => x.level === 0 && rise && x.t > rise.t);
    return rise && fall ? (fall.t - rise.t) / US : 0;
  }

  it.each([
    [2, 116],
    [20, 1160],
    [100, 5800],
    [257, 14906],
    [400, 23200],
  ])('%d cm gives a %d µs echo', (cm, us) => {
    const e = sonar(String(cm));
    expect(ping(e, 1)).toBeCloseTo(us, 3);
  });

  it('starts the echo a few hundred µs after the trigger', () => {
    const e = sonar('50');
    ping(e, 1);
    const rise = edges.find((x) => x.pin === 'echo' && x.level === 1)!;
    const delay = rise.t - (1 * MS + 10 * US);
    expect(delay).toBeGreaterThanOrEqual(250 * US);
    expect(delay).toBeLessThanOrEqual(500 * US);
  });

  it('out of range: a 38 ms pulse', () => {
    const e = sonar('500');
    expect(ping(e, 1)).toBeCloseTo(38000, 3);
  });

  it('ignores trigger pulses shorter than 10 µs', () => {
    const e = sonar('100');
    expect(ping(e, 1, 5)).toBe(0);
    expect(states(e).s.pings).toBe(0);
  });

  it('follows a live distance change from the inspector', () => {
    const e = sonar();
    expect(ping(e, 1)).toBeCloseTo(100 * 58, 3); // default 100 cm
    e.input('s', 'prop', { key: 'distance', value: 33 });
    expect(ping(e, 60)).toBeCloseTo(33 * 58, 3);
    expect(states(e).s).toMatchObject({ distance: 33, pings: 2 });
  });

  it('stays silent without power', () => {
    const e = sonar('100');
    e.input('d', 'vcc', 'z');
    expect(ping(e, 1)).toBe(0);
  });
});

describe('digital examples', () => {
  it.each(['keypad-lock', 'logic-gates', 'relay-blink', 'ultrasonic-distance', 'dip-switch-binary'])('%s runs without warnings', (name) => {
    const e = runExample(name);
    e.stepTo(1500 * MS);
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('ultrasonic-distance prints the slider distance and lights the LED when near', () => {
    const e = runExample('ultrasonic-distance');
    const out = { text: '' };
    serialUntil(e, 400, out);
    const last = () => {
      const m = [...out.text.matchAll(/Distance: (\d+) cm/g)];
      return Number(m[m.length - 1]?.[1]);
    };
    expect(Math.abs(last() - 100)).toBeLessThanOrEqual(1);
    // ±1 cm at short range. pulseIn() reads ~0.6 % short, exactly like a real Uno: the
    // millis() timer interrupt steals cycles from its counting loop (see the next test).
    // So far readings get a 1 % tolerance.
    for (const cm of [15, 57, 250, 3, 400]) {
      e.input('sonar1', 'prop', { key: 'distance', value: cm });
      out.text = '';
      serialUntil(e, e.time / MS + 400, out);
      expect(Math.abs(last() - cm)).toBeLessThanOrEqual(Math.max(1, cm * 0.01));
      e.snapshot();
      e.stepTo(e.time + 50 * MS);
      expect(lit(states(e).led1)).toBe(cm < 20 ? 1 : 0);
    }
    e.input('sonar1', 'prop', { key: 'distance', value: 401 });
    out.text = '';
    serialUntil(e, e.time / MS + 400, out);
    expect(out.text).toContain('Out of range');
  });

  it('pulseIn() is cycle-exact; the ~0.6 % shortfall is the millis() interrupt, as on hardware', () => {
    const d = JSON.parse(read('examples/ultrasonic-distance/diagram.json')) as Diagram;
    const e = new Engine(loadPartTypes());
    e.load(parseDiagram(d), { uno: read('tests/fixtures/pulse-timing.hex') });
    e.input('sonar1', 'prop', { key: 'distance', value: 400 }); // 400 × 58 µs = 23 200 µs
    const out = serialUntil(e, 500);
    const m = /irq=(\d+) noirq=(\d+)/.exec(out);
    expect(m).not.toBeNull();
    const [withIrq, noIrq] = [Number(m![1]), Number(m![2])];
    expect(Math.abs(noIrq - 23_200)).toBeLessThanOrEqual(2);
    // Timer 0 overflows every 1024 µs; its ISR (~100 cycles of 16 384) is ~0.6 % of the loop.
    expect(1 - withIrq / 23_200).toBeGreaterThan(0.003);
    expect(1 - withIrq / 23_200).toBeLessThan(0.01);
  });

  it('keypad-lock unlocks with 1234#', () => {
    const e = runExample('keypad-lock');
    const out = { text: '' };
    serialUntil(e, 200, out);
    expect(out.text).toContain('Locked');
    const keys: Record<string, [number, number]> = { '1': [0, 0], '2': [0, 1], '3': [0, 2], '4': [1, 0], '9': [2, 2], '#': [3, 2], '*': [3, 0] };
    const type = (s: string) => {
      for (const k of s) {
        const [row, column] = keys[k];
        e.input('keypad1', 'press', { key: k, row, column });
        serialUntil(e, e.time / MS + 80, out);
        e.input('keypad1', 'release', { key: k, row, column });
        serialUntil(e, e.time / MS + 80, out);
      }
    };
    type('1239#');
    serialUntil(e, e.time / MS + 800, out);
    expect(out.text).toContain('****');
    expect(out.text).toContain('Wrong code');
    type('1234#');
    expect(out.text).toContain('Unlocked!');
    e.snapshot();
    e.stepTo(e.time + 50 * MS);
    let s = states(e);
    expect(lit(s.ledGreen)).toBe(1);
    expect(lit(s.ledRed)).toBe(0);
    type('*');
    e.stepTo(e.time + 50 * MS);
    s = states(e);
    expect(lit(s.ledGreen)).toBe(0);
    expect(lit(s.ledRed)).toBe(1);
    expect(e.snapshot().warnings).toEqual([]);
  });

  it('relay-blink: the LED on the NO contact follows the relay', () => {
    const e = runExample('relay-blink');
    e.stepTo(400 * MS);
    states(e);
    e.stepTo(500 * MS);
    let s = states(e);
    expect(s.relay1).toMatchObject({ coil: true, closed: true, clicks: 1 });
    expect(lit(s.led1)).toBe(1);
    e.stepTo(1400 * MS);
    states(e);
    e.stepTo(1500 * MS);
    s = states(e);
    expect(s.relay1).toMatchObject({ coil: false, closed: false, clicks: 2 });
    expect(lit(s.led1)).toBe(0);
  });

  it('dip-switch-binary prints the switch value', () => {
    const e = runExample('dip-switch-binary');
    const out = { text: '' };
    serialUntil(e, 200, out);
    expect(out.text).toContain('Switches: 00000101 = 5 (0x05)'); // the example starts with 6 and 8 ON
    e.input('dip1', 'value', '10000001');
    serialUntil(e, 400, out);
    expect(out.text).toContain('Switches: 10000001 = 129 (0x81)');
  });

  it('logic-gates: LEDs show AND, OR and XOR of the two switches', () => {
    const e = runExample('logic-gates');
    const set = (a: number, b: number) => {
      e.input('swA', 'value', a);
      e.input('swB', 'value', b);
      e.snapshot();
      e.stepTo(e.time + 10 * MS);
      const s = states(e);
      return ['ledAnd', 'ledOr', 'ledXor'].map((id) => lit(s[id]));
    };
    expect(set(0, 0)).toEqual([0, 0, 0]);
    expect(set(1, 0)).toEqual([0, 1, 1]);
    expect(set(0, 1)).toEqual([0, 1, 1]);
    expect(set(1, 1)).toEqual([1, 1, 0]);
    expect(e.snapshot().warnings).toEqual([]);
  });
});
