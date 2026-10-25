// SPDX-License-Identifier: Apache-2.0
/**
 * Measures the fraction of time each of several channels was "on" (lit) since the
 * last reading. Used by LED-like parts so PWM (analogWrite) and multiplexing show
 * up as brightness. Lazy: it only does work when a channel changes or is read.
 */
export class DutyMeter {
  private on: boolean[];
  private onTime: number[];
  private since: number;
  private windowStart: number;

  constructor(channels: number, now: number) {
    this.on = new Array(channels).fill(false);
    this.onTime = new Array(channels).fill(0);
    this.since = now;
    this.windowStart = now;
  }

  private accumulate(now: number): void {
    const dt = Math.max(0, now - this.since);
    if (dt > 0) for (let i = 0; i < this.on.length; i++) if (this.on[i]) this.onTime[i] += dt;
    this.since = now;
  }

  /** Channel states from time `now` (ns) on. */
  set(states: boolean[], now: number): void {
    this.accumulate(now);
    for (let i = 0; i < this.on.length; i++) this.on[i] = !!states[i];
  }

  /** On-time fractions (0..1, two decimals) since the previous call; starts a new window. */
  read(now: number): number[] {
    this.accumulate(now);
    const span = now - this.windowStart;
    const out = this.on.map((on, i) => {
      const f = span > 0 ? Math.min(1, this.onTime[i] / span) : on ? 1 : 0;
      return Math.round(f * 100) / 100;
    });
    this.windowStart = now;
    this.onTime.fill(0);
    return out;
  }
}
