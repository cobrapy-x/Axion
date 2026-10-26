// SPDX-License-Identifier: Apache-2.0
/**
 * Measures the average "on" level of each of several channels since the last
 * reading. Used by LED-like parts so PWM (analogWrite) and multiplexing show up as
 * brightness. A channel's level is a boolean (on/off) or a number 0..1 (e.g. the
 * LED current relative to full brightness). Lazy: it only does work when a channel
 * changes or is read.
 */
export class DutyMeter {
  private on: number[];
  private onTime: number[];
  private since: number;
  private windowStart: number;

  constructor(channels: number, now: number) {
    this.on = new Array(channels).fill(0);
    this.onTime = new Array(channels).fill(0);
    this.since = now;
    this.windowStart = now;
  }

  private accumulate(now: number): void {
    const dt = Math.max(0, now - this.since);
    if (dt > 0) for (let i = 0; i < this.on.length; i++) if (this.on[i]) this.onTime[i] += dt * this.on[i];
    this.since = now;
  }

  /** Channel levels from time `now` (ns) on. */
  set(states: ArrayLike<boolean | number>, now: number): void {
    this.accumulate(now);
    for (let i = 0; i < this.on.length; i++) {
      const s = states[i];
      this.on[i] = typeof s === 'number' ? Math.min(1, Math.max(0, s || 0)) : s ? 1 : 0;
    }
  }

  /** Average levels (0..1, two decimals) since the previous call; starts a new window. */
  read(now: number): number[] {
    this.accumulate(now);
    const span = now - this.windowStart;
    const out = this.on.map((on, i) => {
      const f = span > 0 ? Math.min(1, this.onTime[i] / span) : on;
      return Math.round(f * 100) / 100;
    });
    this.windowStart = now;
    this.onTime.fill(0);
    return out;
  }
}
