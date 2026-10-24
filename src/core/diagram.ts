// SPDX-License-Identifier: Apache-2.0
/**
 * Circuit file format. Axion uses Wokwi's documented `diagram.json` format
 * so projects can move between tools (the anti-fragmentation goal):
 *
 * {
 *   "version": 1,
 *   "editor": "axion",
 *   "parts": [{ "type": "wokwi-led", "id": "led1", "top": 0, "left": 0, "rotate": 0, "attrs": {} }],
 *   "connections": [["uno:13", "led1:A", "green", ["v-20", "h40"]]]
 * }
 *
 * Wire routes are lists of relative moves from the source pin:
 * "h<dx>" (horizontal) / "v<dy>" (vertical). A "*" splits the list: moves
 * after it are relative to the *target* pin.
 */

export interface DiagramPart {
  type: string;
  id: string;
  top: number;
  left: number;
  rotate?: number;
  attrs?: Record<string, string>;
}

/** [from "part:pin", to "part:pin", color, route] */
export type DiagramConnection = [string, string, string, string[]];

export interface Diagram {
  version: 1;
  author?: string;
  editor?: string;
  parts: DiagramPart[];
  connections: DiagramConnection[];
  dependencies?: Record<string, string>;
}

/** An Axion project = a circuit + one sketch per microcontroller. */
export interface Project {
  format: 'axion-project';
  version: 1;
  name: string;
  diagram: Diagram;
  /** Sketch source per MCU part id. */
  sketches: Record<string, string>;
}

export function emptyDiagram(): Diagram {
  return { version: 1, editor: 'axion', parts: [], connections: [] };
}

export function splitEndpoint(endpoint: string): { part: string; pin: string } {
  const i = endpoint.indexOf(':');
  if (i < 0) throw new Error(`Invalid connection endpoint "${endpoint}" (expected "part:pin")`);
  return { part: endpoint.slice(0, i), pin: endpoint.slice(i + 1) };
}

/** Parse and validate a diagram.json (Wokwi or Axion). Throws a readable error. */
export function parseDiagram(json: unknown): Diagram {
  if (!json || typeof json !== 'object') throw new Error('Diagram must be a JSON object');
  const d = json as Partial<Diagram>;
  if (!Array.isArray(d.parts)) throw new Error('Diagram is missing "parts"');
  const ids = new Set<string>();
  const parts: DiagramPart[] = d.parts.map((p, i) => {
    if (!p || typeof p.type !== 'string' || typeof p.id !== 'string') {
      throw new Error(`Part #${i} needs "type" and "id"`);
    }
    if (ids.has(p.id)) throw new Error(`Duplicate part id "${p.id}"`);
    ids.add(p.id);
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.attrs ?? {})) attrs[k] = String(v);
    return {
      type: p.type,
      id: p.id,
      top: Number(p.top) || 0,
      left: Number(p.left) || 0,
      rotate: Number(p.rotate) || 0,
      attrs,
    };
  });
  const connections: DiagramConnection[] = (d.connections ?? []).map((c, i) => {
    if (!Array.isArray(c) || typeof c[0] !== 'string' || typeof c[1] !== 'string') {
      throw new Error(`Connection #${i} must be ["part:pin", "part:pin", color, route]`);
    }
    splitEndpoint(c[0]);
    splitEndpoint(c[1]);
    const route = Array.isArray(c[3]) ? c[3].map(String) : [];
    return [c[0], c[1], typeof c[2] === 'string' ? c[2] : 'green', route];
  });
  return {
    version: 1,
    author: d.author,
    editor: d.editor ?? 'axion',
    parts,
    connections,
    dependencies: d.dependencies,
  };
}

export function parseProject(json: unknown): Project {
  const p = json as Partial<Project>;
  if (p && p.format === 'axion-project') {
    return {
      format: 'axion-project',
      version: 1,
      name: String(p.name ?? 'Untitled'),
      diagram: parseDiagram(p.diagram),
      sketches: { ...(p.sketches ?? {}) },
    };
  }
  // A plain (Wokwi) diagram.json is also accepted.
  return { format: 'axion-project', version: 1, name: 'Imported', diagram: parseDiagram(json), sketches: {} };
}

// ─────────────────────────────── Wire routes ────────────────────────────

export interface Point {
  x: number;
  y: number;
}

function applyMoves(start: Point, moves: string[], sign = 1): Point[] {
  const pts: Point[] = [];
  let { x, y } = start;
  for (const m of moves) {
    const n = parseFloat(m.slice(1));
    if (!Number.isFinite(n)) continue;
    if (m[0] === 'h') x += sign * n;
    else if (m[0] === 'v') y += sign * n;
    else continue;
    pts.push({ x, y });
  }
  return pts;
}

/**
 * Compute the polyline of a wire from its route.
 * The last leg is drawn as an orthogonal "L".
 */
export function routeToPoints(from: Point, to: Point, route: string[]): Point[] {
  const star = route.indexOf('*');
  const head = star >= 0 ? route.slice(0, star) : route;
  const tail = star >= 0 ? route.slice(star + 1) : [];
  const headPts = applyMoves(from, head);
  // Tail moves lead *into* the target: walk them backwards from the target.
  const tailPts = applyMoves(to, [...tail].reverse(), -1).reverse();
  const a = headPts.length ? headPts[headPts.length - 1] : from;
  const b = tailPts.length ? tailPts[0] : to;
  const mid: Point[] = a.x !== b.x && a.y !== b.y ? [{ x: b.x, y: a.y }] : [];
  return [from, ...headPts, ...mid, ...tailPts, to];
}

/** Convert absolute waypoints (clicked by the user) into relative h/v moves. */
export function pointsToRoute(from: Point, waypoints: Point[]): string[] {
  const route: string[] = [];
  let cur = from;
  const r = (n: number) => String(Math.round(n * 10) / 10);
  for (const p of waypoints) {
    if (p.x !== cur.x) route.push('h' + r(p.x - cur.x));
    if (p.y !== cur.y) route.push('v' + r(p.y - cur.y));
    cur = p;
  }
  return route;
}
