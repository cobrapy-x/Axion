// SPDX-License-Identifier: Apache-2.0
/**
 * Geometry and pin naming of the breadboards, shared by the three breadboard
 * parts (views) and by scripts/gen-breadboards.mjs, which writes the `internal`
 * groups into each part.json. No imports, so plain Node can run it.
 *
 * Pin names follow Wokwi exactly, so Wokwi diagram.json files import cleanly:
 *   "<col>t.<a-e>"   upper terminal block (columns numbered from 1)
 *   "<col>b.<f-j>"   lower terminal block
 *   "tp.<n>" "tn.<n>" "bp.<n>" "bn.<n>"   power rails (top/bottom, plus/minus), numbered from 1
 * Each 5-hole column half is one net and each rail is one net along the whole board.
 * Rail holes come in groups of 5 with a one-hole gap; rail hole n sits above/below
 * terminal column `railStart + 6·⌊(n-1)/5⌋ + (n-1) mod 5`.
 *
 * Coordinates (CSS px, 0.1" = 9.6 px) are matched to Wokwi's so parts imported
 * from Wokwi land on the same holes.
 */

export const PITCH = 9.6;

export interface Hole {
  name: string;
  x: number;
  y: number;
}

export interface BreadboardSpec {
  type: string;
  columns: number;
  /** Holes per rail (0 = no rails). */
  railHoles: number;
  /** Terminal column above which the first rail hole sits. */
  railStart: number;
  /** x of column 1. */
  x0: number;
  /** y of row a. */
  yA: number;
  width: number;
  height: number;
}

const r1 = (n: number) => Math.round(n * 100) / 100;

/** Rows a–e, then the centre channel (3 pitches), then rows f–j. */
export const ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
export const rowY = (spec: BreadboardSpec, row: number) => r1(spec.yA + row * PITCH + (row >= 5 ? 2 * PITCH : 0));
export const colX = (spec: BreadboardSpec, col: number) => r1(spec.x0 + (col - 1) * PITCH);
/** Rails, top to bottom: tp, tn above the terminal strips; bp, bn below. */
export const RAILS = ['tp', 'tn', 'bp', 'bn'] as const;
export function railY(spec: BreadboardSpec, rail: (typeof RAILS)[number]): number {
  const top = spec.yA - 3 * PITCH; // tn: 3 pitches above row a
  const bottom = rowY(spec, 9) + 3 * PITCH; // bp: 3 pitches below row j
  return r1({ tp: top - PITCH, tn: top, bp: bottom, bn: bottom + PITCH }[rail]);
}
export const railCol = (spec: BreadboardSpec, n: number) => spec.railStart + 6 * Math.floor((n - 1) / 5) + ((n - 1) % 5);

function make(type: string, columns: number, railHoles: number, railStart: number, x0: number, yA: number): BreadboardSpec {
  const spec: BreadboardSpec = { type, columns, railHoles, railStart, x0, yA, width: 0, height: 0 };
  spec.width = r1(2 * x0 + (columns - 1) * PITCH);
  spec.height = r1(railHoles ? railY(spec, 'bn') + (railY(spec, 'tp')) : rowY(spec, 9) + yA);
  return spec;
}

export const BREADBOARDS: Record<string, BreadboardSpec> = {
  /** 830 tie points: 63 columns + 4 rails × 50. */
  'wokwi-breadboard': make('wokwi-breadboard', 63, 50, 3, 26, 51),
  /** 400 tie points: 30 columns + 4 rails × 25. */
  'wokwi-breadboard-half': make('wokwi-breadboard-half', 30, 25, 2, 26, 51),
  /** 170 tie points: 17 columns, no rails. */
  'wokwi-breadboard-mini': make('wokwi-breadboard-mini', 17, 0, 0, 19.2, 22),
};

export function holes(spec: BreadboardSpec): Hole[] {
  const out: Hole[] = [];
  for (let c = 1; c <= spec.columns; c++) {
    ROWS.forEach((row, i) => out.push({ name: `${c}${i < 5 ? 't' : 'b'}.${row}`, x: colX(spec, c), y: rowY(spec, i) }));
  }
  for (const rail of spec.railHoles ? RAILS : []) {
    for (let n = 1; n <= spec.railHoles; n++) out.push({ name: `${rail}.${n}`, x: colX(spec, railCol(spec, n)), y: railY(spec, rail) });
  }
  return out;
}

/** Pins joined inside the breadboard: each column half, and each rail. */
export function groups(spec: BreadboardSpec): string[][] {
  const out: string[][] = [];
  for (let c = 1; c <= spec.columns; c++) {
    out.push(ROWS.slice(0, 5).map((r) => `${c}t.${r}`));
    out.push(ROWS.slice(5).map((r) => `${c}b.${r}`));
  }
  for (const rail of spec.railHoles ? RAILS : []) {
    out.push(Array.from({ length: spec.railHoles }, (_, i) => `${rail}.${i + 1}`));
  }
  return out;
}
