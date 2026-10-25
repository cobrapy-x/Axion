// SPDX-License-Identifier: Apache-2.0
/**
 * Breadboard geometry, kept free of the DOM so it can be unit-tested:
 * which part pins sit in which carrier holes (implicit connections), and how far
 * to shift a part so its pins drop into the nearest holes (snapping).
 *
 * All coordinates are world coordinates (CSS px at zoom 1).
 */
import type { DiagramConnection, Point } from '../core/diagram';

/** Max distance between a pin and a hole for them to count as connected. */
export const PLUG_TOLERANCE = 2.5;
/** Max distance at which a dropped part snaps one of its pins onto a hole. */
export const SNAP_DISTANCE = 5;

export interface PlacedPin {
  name: string;
  x: number;
  y: number;
  /** wokwi-elements marks pins that can't go into a breadboard (e.g. ICSP headers). */
  noBreadboard?: boolean;
}

export interface PlacedPart {
  id: string;
  /** Breadboards and similar: their pins are holes that other parts plug into. */
  carrier: boolean;
  pins: PlacedPin[];
}

export interface HoleRef {
  part: string;
  pin: string;
  x: number;
  y: number;
}

/** A plain uniform-grid spatial hash for nearest-point queries with a small radius. */
export class PointIndex<T extends Point> {
  private cells = new Map<number, T[]>();
  private cell: number;
  constructor(cell = 10) {
    this.cell = cell;
  }

  private key(cx: number, cy: number): number {
    return (cx + 50_000) * 100_003 + (cy + 50_000);
  }

  add(p: T): void {
    const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
    const list = this.cells.get(k);
    if (list) list.push(p);
    else this.cells.set(k, [p]);
  }

  /** Nearest point within `max` (must be ≤ the cell size), or null. */
  nearest(x: number, y: number, max: number): T | null {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    let best: T | null = null;
    let bestD = max * max;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const p of this.cells.get(this.key(cx + i, cy + j)) ?? []) {
          const d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d <= bestD) {
            bestD = d;
            best = p;
          }
        }
      }
    }
    return best;
  }

  get size(): number {
    let n = 0;
    for (const l of this.cells.values()) n += l.length;
    return n;
  }
}

/** Index of every carrier hole. */
export function holeIndex(parts: Iterable<PlacedPart>): PointIndex<HoleRef> {
  const index = new PointIndex<HoleRef>();
  for (const part of parts) {
    if (!part.carrier) continue;
    for (const pin of part.pins) index.add({ part: part.id, pin: pin.name, x: pin.x, y: pin.y });
  }
  return index;
}

export interface Plug {
  part: string;
  pin: string;
  hole: HoleRef;
}

/** Every non-carrier pin that sits in a carrier hole. */
export function pluggedPins(parts: PlacedPart[], index = holeIndex(parts), tolerance = PLUG_TOLERANCE): Plug[] {
  const out: Plug[] = [];
  for (const part of parts) {
    if (part.carrier) continue;
    for (const pin of part.pins) {
      if (pin.noBreadboard) continue;
      const hole = index.nearest(pin.x, pin.y, tolerance);
      if (hole && hole.part !== part.id) out.push({ part: part.id, pin: pin.name, hole });
    }
  }
  return out;
}

/**
 * Connections created by plugging parts into breadboards:
 * `["led1:A", "bb1:12t.c", "", []]` for every pin sitting in a hole.
 */
export function implicitConnections(parts: PlacedPart[], tolerance = PLUG_TOLERANCE): DiagramConnection[] {
  return pluggedPins(parts, undefined, tolerance).map(
    (p) => [`${p.part}:${p.pin}`, `${p.hole.part}:${p.hole.pin}`, '', []] as DiagramConnection,
  );
}

/**
 * Offset that moves the pin closest to a hole exactly onto it, or null if no pin
 * is within `max`. The other pins then land within a pixel or two of their holes
 * (part footprints are not always an exact multiple of the 0.1" pitch).
 */
export function snapOffset(pins: PlacedPin[], index: PointIndex<HoleRef>, max = SNAP_DISTANCE): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const pin of pins) {
    if (pin.noBreadboard) continue;
    const hole = index.nearest(pin.x, pin.y, max);
    if (!hole) continue;
    const d = Math.hypot(hole.x - pin.x, hole.y - pin.y);
    if (d < bestD) {
      bestD = d;
      best = { x: hole.x - pin.x, y: hole.y - pin.y };
    }
  }
  return best;
}

/** Unordered key for a connection's two endpoints (to de-duplicate). */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Wokwi stores breadboard connections in diagram.json with the route ["$bb"]; they are not drawn. */
export const isImplicit = (c: DiagramConnection) => c[3]?.[0] === '$bb';
