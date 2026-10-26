// SPDX-License-Identifier: Apache-2.0
/**
 * Shared rules for LED-like parts (LED, RGB LED, 7-segment display).
 *
 * Every LED is a D element: it conducts above its forward voltage `vf` (by colour)
 * with a small series resistance, so a 220 Ω resistor on 5 V gives ≈ 14 mA and
 * ≈ 1.85 V across a red LED. Brightness is proportional to the current, full at
 * 20 mA; PWM and multiplexing average out over a frame (see DutyMeter).
 */
import type { AnalogElement, PartContext } from '../core/types';

/** Forward voltage by colour (volts). */
export const LED_VF: Record<string, number> = {
  red: 1.8,
  orange: 2.0,
  yellow: 2.0,
  green: 2.1,
  blue: 3.0,
  white: 3.0,
  purple: 3.0,
};

/** Series (dynamic) resistance of an LED junction. */
export const LED_OHMS = 5;
/** Current at which an LED is shown at full brightness. */
export const LED_FULL_AMPS = 0.02;
/** Above this an LED would burn out (typical absolute maximum: 30 mA). */
export const LED_MAX_AMPS = 0.03;

/** Kept for parts that only know voltages: an LED needs about this much to light. */
export const LED_THRESHOLD = 1.5;

export function ledVf(color: unknown): number {
  return LED_VF[String(color)] ?? LED_VF.red;
}

/** D element of an LED between `anode` and `cathode`. */
export function ledElement(anode: string, cathode: string, color: unknown, id: string): AnalogElement {
  return { kind: 'D', anode, cathode, vf: ledVf(color), ohms: LED_OHMS, id };
}

/** Brightness (0..1) of an LED carrying `amps`. */
export function ledLevel(amps: number): number {
  return amps > 0 ? Math.min(1, amps / LED_FULL_AMPS) : 0;
}

/**
 * Brightness of the LED element `id`, warning once if it carries more than an LED can take
 * (`label` names it in the message, e.g. "LED led1").
 */
export class LedGuard {
  private warned = new Set<string>();

  constructor(private ctx: PartContext) {}

  level(id: string, label: string): number {
    const amps = this.ctx.current(id);
    if (amps > LED_MAX_AMPS && !this.warned.has(id)) {
      this.warned.add(id);
      this.ctx.warn(`${label} has no current-limiting resistor (${Math.round(amps * 1000)} mA)`);
    }
    return ledLevel(amps);
  }
}

/**
 * Whether an LED between a channel pin and a common pin is lit, from voltages alone.
 * Common cathode: the channel must be ≥ 1.5 V above COM. Common anode: COM ≥ 1.5 V above the channel.
 * Floating pins never light.
 */
export function ledLit(channel: number | null, common: number | null, commonAnode: boolean): boolean {
  if (channel === null || common === null) return false;
  return (commonAnode ? common - channel : channel - common) >= LED_THRESHOLD;
}
