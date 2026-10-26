// SPDX-License-Identifier: Apache-2.0
/**
 * Light-dependent resistor (photoresistor, CdS cell such as the GL5528).
 *
 * Its resistance falls with the light level following a power law:
 *   R = R10 · (lux / 10)^(−γ)
 * where R10 is the resistance at 10 lux (GL5528: 8–20 kΩ, typically 10 kΩ) and γ ≈ 0.7.
 * In the dark it is limited by the dark resistance (≈ 1 MΩ), in very bright light by a
 * few ohms of contact resistance.
 */

/** Resistance of a CdS cell in total darkness. */
export const LDR_DARK_OHMS = 1e6;
/** Lowest resistance (very bright light). */
export const LDR_MIN_OHMS = 10;

export function ldrOhms(lux: number, r10: number, gamma: number): number {
  if (!(lux > 0)) return LDR_DARK_OHMS;
  const r = r10 * Math.pow(lux / 10, -gamma);
  return Math.min(LDR_DARK_OHMS, Math.max(LDR_MIN_OHMS, r));
}

/** 0..1 brightness for drawing: logarithmic, 0 at ≤ 0.1 lux, 1 at ≥ 10 000 lux. */
export function lightLevel(lux: number): number {
  if (!(lux > 0.1)) return 0;
  return Math.min(1, Math.log10(lux / 0.1) / 5);
}

/** "350 lx", "1.2k lx" for labels. */
export function formatLux(lux: number): string {
  if (lux >= 10_000) return `${Math.round(lux / 1000)}k lx`;
  if (lux >= 1000) return `${(lux / 1000).toFixed(1)}k lx`;
  if (lux >= 10) return `${Math.round(lux)} lx`;
  return `${Number(lux.toFixed(1))} lx`;
}
