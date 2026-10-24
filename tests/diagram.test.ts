// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseDiagram, parseProject, pointsToRoute, routeToPoints } from '../src/core/diagram';

describe('diagram.json (Wokwi compatible)', () => {
  it('parses a Wokwi diagram and fills defaults', () => {
    const d = parseDiagram({
      version: 1,
      author: 'someone',
      editor: 'wokwi',
      parts: [{ type: 'wokwi-led', id: 'led1', top: '10', left: 20, attrs: { color: 'red' } }],
      connections: [['led1:A', 'led1:C', 'green', ['v10', 'h5']]],
    });
    expect(d.parts[0]).toMatchObject({ top: 10, left: 20, rotate: 0 });
    expect(d.connections[0][3]).toEqual(['v10', 'h5']);
  });

  it('rejects duplicate ids and bad endpoints', () => {
    const part = { type: 'wokwi-led', id: 'x', top: 0, left: 0 };
    expect(() => parseDiagram({ version: 1, parts: [part, part], connections: [] })).toThrow(/Duplicate/);
    expect(() => parseDiagram({ version: 1, parts: [part], connections: [['x', 'x:A', 'g', []]] })).toThrow(/part:pin/);
  });

  it('wraps a plain diagram into a project', () => {
    const p = parseProject({ version: 1, parts: [], connections: [] });
    expect(p.format).toBe('axion-project');
    expect(p.sketches).toEqual({});
  });
});

describe('wire routes', () => {
  it('round-trips waypoints through h/v moves', () => {
    const from = { x: 10, y: 10 };
    const route = pointsToRoute(from, [{ x: 10, y: -20 }, { x: 60, y: -20 }]);
    expect(route).toEqual(['v-30', 'h50']);
    const pts = routeToPoints(from, { x: 60, y: 40 }, route);
    expect(pts).toEqual([from, { x: 10, y: -20 }, { x: 60, y: -20 }, { x: 60, y: 40 }]);
  });

  it('applies moves after "*" relative to the target', () => {
    const pts = routeToPoints({ x: 0, y: 0 }, { x: 100, y: 100 }, ['v10', '*', 'h-20']);
    // head: (0,10). The last move "h-20" arrives at the target, so it starts at (120,100).
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 120, y: 10 }, { x: 120, y: 100 }, { x: 100, y: 100 }]);
  });
});
