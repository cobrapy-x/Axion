// SPDX-License-Identifier: Apache-2.0
/** Shared rules for LED-like parts (RGB LED, 7-segment display). */

/** Forward voltage needed for an LED segment to light. */
export const LED_THRESHOLD = 1.5;

/**
 * Whether an LED between a channel pin and a common pin is lit.
 * Common cathode: the channel must be ≥ 1.5 V above COM. Common anode: COM ≥ 1.5 V above the channel.
 * Floating pins never light.
 */
export function ledLit(channel: number | null, common: number | null, commonAnode: boolean): boolean {
  if (channel === null || common === null) return false;
  return (commonAnode ? common - channel : channel - common) >= LED_THRESHOLD;
}
