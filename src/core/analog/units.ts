// SPDX-License-Identifier: Apache-2.0
/**
 * Parses component values written the way they are printed on parts and in
 * schematics: "220", "4.7k", "1M", "100nF", "10µF", "4.7uF", "2k2", "4R7", "1meg".
 *
 * Prefixes are case-sensitive where it matters: "M" is mega, "m" is milli
 * ("1M" = 1 000 000 Ω, "1mF" = 0.001 F). A trailing unit (Ω, ohm, F, H, V, A)
 * is ignored. Returns `fallback` for anything that is not a number.
 */
const PREFIX: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  R: 1,
  r: 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  meg: 1e6,
  MEG: 1e6,
  G: 1e9,
};

const VALUE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(meg|MEG|[pnuµμmRrkKMG])?(\d*)\s*(?:Ω|ohms?|Ohms?|[FHVAfhva])?$/;

export function parseValue(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const m = VALUE.exec(value.trim());
  if (!m) return fallback;
  const [, num, prefix, tail] = m;
  // "2k2" / "4R7": the prefix doubles as the decimal point.
  if (tail && (!prefix || num.includes('.'))) return fallback;
  const n = Number(tail ? `${num}.${tail}` : num);
  if (!Number.isFinite(n)) return fallback;
  return n * (prefix ? PREFIX[prefix] : 1);
}

/** "4.7 kΩ", "100 nF"… for messages. */
export function formatValue(v: number, unit: string): string {
  const abs = Math.abs(v);
  const steps: Array<[number, string]> = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ];
  for (const [f, p] of steps) {
    if (abs >= f * 0.9995) return `${Number((v / f).toPrecision(3))} ${p}${unit}`;
  }
  return `${v} ${unit}`;
}
