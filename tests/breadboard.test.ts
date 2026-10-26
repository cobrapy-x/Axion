// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram, type DiagramConnection, type DiagramPart } from '../src/core/diagram';
import { Engine, type PartType } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import type { ModelFactory } from '../src/core/types';
import {
  PointIndex,
  holeIndex,
  implicitConnections,
  isImplicit,
  snapOffset,
  type PlacedPart,
} from '../src/editor/breadboard';
import { BREADBOARDS, groups, holes } from '../src/parts/breadboard/layout';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const MS = 1e6;
const types = loadPartTypes();

/** Pin positions and element sizes (as measured in the browser) of the parts used below. */
const PINS: Record<string, Array<{ name: string; x: number; y: number }>> = {
  'wokwi-led': [{ name: 'A', x: 25, y: 42 }, { name: 'C', x: 15, y: 42 }],
  'wokwi-resistor': [{ name: '1', x: 0, y: 5.65 }, { name: '2', x: 58.8, y: 5.65 }],
  'wokwi-pushbutton': [
    { name: '1.l', x: 0, y: 13 }, { name: '2.l', x: 0, y: 32 },
    { name: '1.r', x: 67, y: 13 }, { name: '2.r', x: 67, y: 32 },
  ],
};
const SIZE: Record<string, [number, number]> = {
  'wokwi-led': [40, 50],
  'wokwi-resistor': [59, 11],
  'wokwi-pushbutton': [67, 48],
};

/** World pin positions, rotating around the part's centre like the editor does. */
function placed(parts: DiagramPart[]): PlacedPart[] {
  return parts.map((p) => {
    const bb = BREADBOARDS[p.type];
    const pins = bb ? holes(bb) : PINS[p.type] ?? [];
    const [w, h] = bb ? [bb.width, bb.height] : SIZE[p.type] ?? [0, 0];
    const a = ((p.rotate ?? 0) * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    const world = (x: number, y: number) => ({
      x: p.left + w / 2 + (x - w / 2) * cos - (y - h / 2) * sin,
      y: p.top + h / 2 + (x - w / 2) * sin + (y - h / 2) * cos,
    });
    return { id: p.id, carrier: !!bb, pins: pins.map((q) => ({ name: q.name, ...world(q.x, q.y) })) };
  });
}

function engineFor(parts: DiagramPart[], connections: DiagramConnection[], firmware: Record<string, string> = {}) {
  const e = new Engine(types);
  e.load(parseDiagram({ version: 1, parts, connections }), firmware);
  return e;
}

describe('breadboard parts', () => {
  it('have Wokwi tie-point counts, pin names and internal groups', () => {
    const counts: Record<string, number> = { 'wokwi-breadboard': 830, 'wokwi-breadboard-half': 400, 'wokwi-breadboard-mini': 170 };
    for (const [type, spec] of Object.entries(BREADBOARDS)) {
      const manifest = types.get(type)!.manifest;
      expect(manifest.carrier).toBe(true);
      expect(manifest.idPrefix).toBe('bb');
      const names = holes(spec).map((h) => h.name);
      expect(names.length).toBe(counts[type]);
      expect(new Set(names).size).toBe(names.length);
      // part.json is generated from layout.ts (scripts/gen-breadboards.mjs): keep them in sync.
      expect(manifest.internal).toEqual(groups(spec));
      expect(manifest.internal!.flat().sort()).toEqual([...names].sort());
    }
    const half = holes(BREADBOARDS['wokwi-breadboard-half']).map((h) => h.name);
    expect(half).toEqual(expect.arrayContaining(['1t.a', '30t.e', '12b.f', '30b.j', 'tp.1', 'tn.25', 'bp.1', 'bn.25']));
    expect(half).not.toContain('tp.26');
    const full = holes(BREADBOARDS['wokwi-breadboard']).map((h) => h.name);
    expect(full).toEqual(expect.arrayContaining(['63t.a', '63b.j', 'tp.50', 'bn.50']));
  });

  it('rail holes line up with terminal columns like Wokwi (groups of 5, one-hole gaps)', () => {
    const at = (type: string, name: string) => holes(BREADBOARDS[type]).find((h) => h.name === name)!;
    // From Wokwi projects: straight vertical wires bp.7 → 10b.j, bp.13 → 17b.j, bp.19 → 24b.j (full)
    expect(at('wokwi-breadboard', 'bp.7').x).toBe(at('wokwi-breadboard', '10b.j').x);
    expect(at('wokwi-breadboard', 'bp.13').x).toBe(at('wokwi-breadboard', '17b.j').x);
    expect(at('wokwi-breadboard', 'bn.30').x).toBe(at('wokwi-breadboard', '37t.e').x);
    // …and bn.10 → 12b.g on the half board.
    expect(at('wokwi-breadboard-half', 'bn.10').x).toBe(at('wokwi-breadboard-half', '12b.g').x);
  });

  it('connects a column half, not across the channel, and rails along their length', () => {
    const e = engineFor(
      [
        { type: 'wokwi-breadboard', id: 'bb1', top: 0, left: 0 },
        { type: 'axion-battery', id: 'b', top: 0, left: 0, attrs: { voltage: '5' } },
      ],
      [
        ['b:+', 'bb1:12t.a', '', []],
        ['b:-', 'bb1:bn.1', '', []],
      ],
    );
    expect(e.voltage('bb1', '12t.e')).toBe(5); // same column half
    expect(e.voltage('bb1', '12b.f')).toBeNull(); // across the channel
    expect(e.voltage('bb1', '13t.a')).toBeNull(); // next column
    expect(e.voltage('bb1', 'bn.50')).toBe(0); // the whole rail
    expect(e.voltage('bb1', 'bp.50')).toBeNull(); // the other rail
    expect(e.voltage('bb1', 'tn.1')).toBeNull(); // top rails are separate
  });
});

describe('implicit breadboard connections (geometry)', () => {
  const bb: DiagramPart = { type: 'wokwi-breadboard-half', id: 'bb1', top: 100, left: 50 };
  const hole = (name: string) => holes(BREADBOARDS[bb.type]).find((h) => h.name === name)!;

  it('connects pins sitting in holes, within a small tolerance', () => {
    const c11 = hole('11t.c');
    // LED pins are 10 px apart, holes 9.6 px: snap C exactly, A lands 0.4 px off.
    const led: DiagramPart = { type: 'wokwi-led', id: 'led1', top: bb.top + c11.y - 42, left: bb.left + c11.x - 15 };
    const far: DiagramPart = { type: 'wokwi-led', id: 'led2', top: bb.top + 400, left: 0 };
    const conns = implicitConnections(placed([bb, led, far]));
    expect(conns).toEqual([
      ['led1:A', 'bb1:12t.c', '', []],
      ['led1:C', 'bb1:11t.c', '', []],
    ]);
    // 3 px away is too far for a connection.
    expect(implicitConnections(placed([bb, { ...led, left: led.left + 3 }]))).toEqual([]);
  });

  it('snaps a part so its nearest pin sits exactly in a hole', () => {
    const f = hole('5b.f');
    const btn: DiagramPart = { type: 'wokwi-pushbutton', id: 'btn1', top: bb.top + f.y - 13 + 3, left: bb.left + f.x + 2 };
    const parts = placed([bb, btn]);
    const d = snapOffset(parts[1].pins, holeIndex(parts))!;
    // About (-2, -3); the button's pins are 67 × 19 px apart, the holes 67.2 × 19.2 px.
    expect(Math.hypot(d.x + 2, d.y + 3)).toBeLessThan(0.3);
    const snapped = placed([bb, { ...btn, left: btn.left + d.x, top: btn.top + d.y }]);
    expect(implicitConnections(snapped).map((c) => c[0] + '>' + c[1])).toEqual([
      'btn1:1.l>bb1:5b.f',
      'btn1:2.l>bb1:5b.h',
      'btn1:1.r>bb1:12b.f',
      'btn1:2.r>bb1:12b.h',
    ]);
    // Half-way between holes in both directions (~6.7 px from the nearest one): no snap.
    expect(snapOffset(placed([{ ...btn, left: btn.left + 2.8, top: btn.top + 1.8 }])[0].pins, holeIndex(parts))).toBeNull();
  });

  it("reproduces Wokwi's own $bb connections for a real project (full breadboard)", () => {
    // Part placements and the "$bb" connections Wokwi stored for them, from a public Wokwi project.
    const parts = [
      ['wokwi-breadboard', 'bb1', 25.8, -131.6, 0],
      ['wokwi-pushbutton', 'btn1', 85.8, -112.2, 90], ['wokwi-pushbutton', 'btn2', 86.5, -41.7, 270],
      ['wokwi-resistor', 'r1', 187.2, -96.55, 90], ['wokwi-resistor', 'r2', 187.2, -29.35, 90],
      ['wokwi-resistor', 'r3', 187.2, 37.85, 90], ['wokwi-pushbutton', 'btn3', 86.3, 22.7, 90],
      ['wokwi-pushbutton', 'btn4', 86.3, 89.9, 90], ['wokwi-resistor', 'r4', 187.2, 105.05, 90],
      ['wokwi-led', 'led1', 44.4, 186.2, 0], ['wokwi-led', 'led2', 44.4, 215, 0],
      ['wokwi-resistor', 'r5', 120, 181.85, 90], ['wokwi-resistor', 'r6', 120, 210.65, 90],
    ] as const;
    const stored = [
      'btn1:1.l>bb1:5t.a', 'btn1:2.l>bb1:3t.a', 'btn1:1.r>bb1:5b.f', 'btn1:2.r>bb1:3b.f',
      'btn2:1.l>bb1:10b.f', 'btn2:2.l>bb1:12b.f', 'btn2:1.r>bb1:10t.a', 'btn2:2.r>bb1:12t.a',
      'r1:1>bb1:5b.h', 'r1:2>bb1:bn.3', 'r2:1>bb1:12b.h', 'r2:2>bb1:bn.9', 'r3:1>bb1:19b.h', 'r3:2>bb1:bn.15',
      'btn3:1.l>bb1:19t.a', 'btn3:2.l>bb1:17t.a', 'btn3:1.r>bb1:19b.f', 'btn3:2.r>bb1:17b.f',
      'btn4:1.l>bb1:26t.a', 'btn4:2.l>bb1:24t.a', 'btn4:1.r>bb1:26b.f', 'btn4:2.r>bb1:24b.f',
      'r4:1>bb1:26b.h', // r4:2 sits in a gap of the rail (column 26): not connected
      'led1:A>bb1:34t.b', 'led1:C>bb1:33t.b', 'led2:A>bb1:37t.b', 'led2:C>bb1:36t.b',
      'r5:1>bb1:34t.c', 'r5:2>bb1:34b.g', 'r6:1>bb1:37t.c', 'r6:2>bb1:37b.g',
    ];
    const diagramParts = parts.map(([type, id, top, left, rotate]) => ({ type, id, top, left, rotate }));
    const mine = implicitConnections(placed(diagramParts)).map((c) => `${c[0]}>${c[1]}`);
    expect(mine.sort()).toEqual([...stored].sort());
  });

  it('ignores pins that cannot go into a breadboard and carrier-to-carrier overlaps', () => {
    const a = hole('3t.a');
    const parts: PlacedPart[] = [
      ...placed([bb, { ...bb, id: 'bb2' }]),
      { id: 'nano', carrier: false, pins: [{ name: 'ICSP', x: bb.left + a.x, y: bb.top + a.y, noBreadboard: true }] },
    ];
    expect(implicitConnections(parts)).toEqual([]);
  });

  it('point index finds the nearest point in neighbouring cells', () => {
    const idx = new PointIndex<{ x: number; y: number; id: number }>();
    idx.add({ x: 9.9, y: 0, id: 1 });
    idx.add({ x: 10.1, y: 0, id: 2 });
    idx.add({ x: -0.5, y: -0.5, id: 3 });
    expect(idx.nearest(10.05, 0, 1)?.id).toBe(2);
    expect(idx.nearest(0, 0, 1)?.id).toBe(3);
    expect(idx.nearest(5, 5, 1)).toBeNull();
    expect(idx.size).toBe(3);
  });
});

/** Uno + LED + resistor + button on a breadboard: only jumper wires are explicit. */
function breadboardCircuit(type = 'wokwi-breadboard-half') {
  const bb: DiagramPart = { type, id: 'bb1', top: 0, left: 300 };
  const hole = (name: string) => holes(BREADBOARDS[type]).find((h) => h.name === name)!;
  const at = (name: string, pinX: number, pinY: number) => ({ left: bb.left + hole(name).x - pinX, top: bb.top + hole(name).y - pinY });
  const parts: DiagramPart[] = [
    { type: 'wokwi-arduino-uno', id: 'uno', top: 300, left: 0 },
    bb,
    { type: 'wokwi-led', id: 'led1', ...at('11t.c', 15, 42) }, // C in column 11, A in column 12
    { type: 'wokwi-resistor', id: 'r1', ...at('12t.d', 0, 5.65), attrs: { value: '220' } }, // 12 → 18
    // Turned 90° to straddle the channel: side 1 in column 22, side 2 in column 20.
    // (Rotated around its 67×48 centre, pin 1.l lands at (44.5, -9.5).)
    { type: 'wokwi-pushbutton', id: 'btn1', ...at('22t.a', 44.5, -9.5), rotate: 90 },
  ];
  const wires: DiagramConnection[] = [
    ['uno:13', 'bb1:18t.a', 'orange', []],
    ['bb1:11t.e', 'bb1:tn.5', 'black', []],
    ['uno:GND.1', 'bb1:tn.20', 'black', []],
    ['uno:2', 'bb1:22b.j', 'blue', []],
    ['bb1:20t.e', 'bb1:tn.17', 'black', []],
  ];
  return { parts, wires };
}

describe('Uno on a breadboard (end to end)', () => {
  const hex = read('examples/blink-button/sketch.hex');

  it('blinks an LED wired only through breadboard holes', () => {
    const { parts, wires } = breadboardCircuit();
    const implicit = implicitConnections(placed(parts));
    expect(implicit.map((c) => c[0])).toEqual(expect.arrayContaining(['led1:A', 'led1:C', 'r1:1', 'r1:2']));
    const e = engineFor(parts, [...wires, ...implicit], { uno: hex });
    const seen: Array<number | null> = [];
    for (const t of [300, 700, 1200, 1700]) {
      e.stepTo(t * MS);
      seen.push(e.voltage('led1', 'A'));
    }
    // 500 ms on / off; while on, the anode sits at the red LED's forward voltage (~1.86 V).
    expect(seen.map((v) => (v! > 1.5 ? 1 : v))).toEqual([0, 1, 0, 1]);
    expect(seen[1]).toBeCloseTo(1.86, 1);
    expect(e.voltage('bb1', '12t.e')).toBeCloseTo(1.86, 1); // the LED's column (its anode)
    e.snapshot(); // brightness is averaged since the previous snapshot
    e.stepTo(1900 * MS);
    expect(e.snapshot().states.led1.brightness).toBeCloseTo(0.63, 1); // ~12.6 mA, full is 20 mA
    // Without the implicit connections nothing is connected.
    const bare = engineFor(parts, wires, { uno: hex });
    bare.stepTo(700 * MS);
    expect(bare.voltage('led1', 'A')).toBeNull();
  });

  it('reads a button plugged into the breadboard', () => {
    const { parts, wires } = breadboardCircuit();
    const implicit = implicitConnections(placed(parts));
    expect(implicit.filter((c) => c[0].startsWith('btn1:')).map((c) => c[1])).toEqual([
      'bb1:22t.a', 'bb1:20t.a', 'bb1:22b.f', 'bb1:20b.f',
    ]);
    const e = engineFor(parts, [...wires, ...implicit], { uno: hex });
    e.stepTo(100 * MS);
    expect(e.level('uno', '2')).toBe(1); // INPUT_PULLUP, released
    e.input('btn1', 'press');
    e.stepTo(200 * MS);
    expect(e.level('uno', '2')).toBe(0);
    const serial = e.snapshot().events.filter((x) => x.event === 'serial').map((x) => x.data).join('');
    expect(serial).toContain('Button pressed');
  });

  it('the breadboard-led example loads and its $bb connections match the geometry', () => {
    const d = parseDiagram(JSON.parse(read('examples/breadboard-led/diagram.json')));
    const stored = d.connections.filter(isImplicit).map((c) => `${c[0]}>${c[1]}`).sort();
    expect(stored.length).toBeGreaterThan(0);
    const geometric = implicitConnections(placed(d.parts.filter((p) => p.type !== 'wokwi-arduino-uno')))
      .map((c) => `${c[0]}>${c[1]}`)
      .sort();
    expect(geometric).toEqual(stored);
    // It runs from its own diagram.json (the stored connections), like an imported Wokwi project.
    const e = new Engine(types);
    e.load(d, { uno: read('examples/breadboard-led/sketch.hex') });
    e.stepTo(700 * MS);
    expect(e.voltage('led1', 'A')).toBeCloseTo(1.86, 1); // forward voltage of the lit red LED
    expect(e.voltage('led1', 'C')).toBe(0);
    expect(e.voltage('bb1', 'bp.25')).toBe(5); // 5V rail
    e.input('btn1', 'press');
    e.stepTo(800 * MS);
    expect(e.level('uno', '2')).toBe(0);
    expect(e.snapshot().events.map((x) => x.data).join('')).toContain('Button pressed');
    expect(e.snapshot().warnings).toEqual([]);
  });
});

describe.skipIf(!process.env.AXION_BENCH)('benchmark', () => {
  it('solve cost with and without a full breadboard', () => {
    // A toggling source drives LED + resistor: each toggle is one event-driven solve.
    const toggler: ModelFactory = (ctx) => {
      let on = false;
      return {
        drive: (pin) => (pin === 'out' ? (on ? 'high' : 'low') : pin === 'gnd' ? 'low' : 'z'),
        input() {
          on = !on;
          ctx.invalidate();
        },
      };
    };
    const t = new Map<string, PartType>([
      ...types,
      ['test-toggler', { manifest: { type: 'test-toggler', name: 'T', category: 'test', version: '1', license: 'Apache-2.0' }, model: toggler }],
    ]);
    const solves = (withBoard: boolean) => {
      const { parts } = breadboardCircuit('wokwi-breadboard');
      const src: DiagramPart = { type: 'test-toggler', id: 'src', top: 0, left: 0 };
      const ps = withBoard ? [...parts.filter((p) => p.id !== 'uno'), src] : [...parts.filter((p) => p.id !== 'uno' && p.id !== 'bb1'), src];
      const conns: DiagramConnection[] = withBoard
        ? [['src:out', 'bb1:18t.a', '', []], ['bb1:11t.e', 'bb1:tn.5', '', []], ['src:gnd', 'bb1:tn.20', '', []], ...implicitConnections(placed(parts))]
        : [['src:out', 'r1:2', '', []], ['r1:1', 'led1:A', '', []], ['led1:C', 'src:gnd', '', []]];
      const e = new Engine(t);
      e.load(parseDiagram({ version: 1, parts: ps, connections: conns }));
      const N = 20_000;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) e.input('src', 'toggle');
      expect(e.voltage('led1', 'A')).toBe(0);
      return ((performance.now() - t0) / N) * 1000;
    };
    solves(true);
    solves(false);
    const a = Math.min(solves(false), solves(false), solves(false));
    const b = Math.min(solves(true), solves(true), solves(true));
    console.log(`one solve: without breadboard ${a.toFixed(2)} µs, with full breadboard ${b.toFixed(2)} µs`);
  });

  it('a full breadboard costs (almost) nothing per solve', () => {
    const hex = read('examples/blink-button/sketch.hex');
    const run = (withBoard: boolean) => {
      const { parts, wires } = breadboardCircuit('wokwi-breadboard');
      let conns = [...wires, ...implicitConnections(placed(parts))];
      let ps = parts;
      if (!withBoard) {
        // Same circuit with direct wires.
        ps = parts.filter((p) => p.id !== 'bb1');
        conns = [
          ['uno:13', 'r1:2', '', []],
          ['r1:1', 'led1:A', '', []],
          ['led1:C', 'uno:GND.1', '', []],
          ['uno:2', 'btn1:1.l', '', []],
          // pin 9 (PWM fade) drives nothing on the board either way
        ];
      }
      // Pin 9 fades with analogWrite: hook an LED to it so the PWM edges cost solves.
      ps = [...ps, { type: 'wokwi-led', id: 'led2', top: 0, left: 0 }];
      conns = [...conns, ['uno:9', 'led2:A', '', []], ['led2:C', 'uno:GND.2', '', []]];
      const e = engineFor(ps, conns, { uno: hex });
      const t0 = performance.now();
      e.stepTo(3000 * MS);
      return performance.now() - t0;
    };
    run(true); // warm up
    run(false);
    const without = Math.min(run(false), run(false));
    const withBb = Math.min(run(true), run(true));
    console.log(`3 s simulated: without breadboard ${without.toFixed(0)} ms, with full breadboard ${withBb.toFixed(0)} ms (${((withBb / without - 1) * 100).toFixed(1)}%)`);
  }, 300_000);
});
