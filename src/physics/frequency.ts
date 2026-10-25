// SPDX-License-Identifier: Apache-2.0
/**
 * Measures the frequency of a square wave (e.g. Arduino's tone()) from the
 * timestamps of its rising edges. Averages the last few periods so the reading
 * is steady, and reports "off" once edges stop arriving.
 */
const MAX_PERIOD_NS = 50e6; // below 20 Hz we call it "not a tone"
const MIN_TIMEOUT_NS = 20e6;
const AVERAGE = 8;

export class FrequencyMeter {
  private high = false;
  private lastRise: number | null = null;
  private periods: number[] = [];

  /** Feed the current signal state at time `now` (ns). */
  update(high: boolean, now: number): void {
    if (high && !this.high) {
      if (this.lastRise !== null) {
        const p = now - this.lastRise;
        // A gap (silence between notes) is not a period: start measuring afresh.
        if (p > MAX_PERIOD_NS || (this.periods.length && p > 2.5 * this.period())) this.periods = [];
        else if (p > 0) {
          this.periods.push(p);
          if (this.periods.length > AVERAGE) this.periods.shift();
        }
      }
      this.lastRise = now;
    }
    this.high = high;
  }

  private period(): number {
    return this.periods.reduce((a, b) => a + b, 0) / this.periods.length;
  }

  /** Whether a tone is currently playing, and its frequency in Hz (0 when off). */
  read(now: number): { on: boolean; frequency: number } {
    if (this.lastRise === null || !this.periods.length) return { on: false, frequency: 0 };
    const p = this.period();
    if (now - this.lastRise > Math.max(MIN_TIMEOUT_NS, 2.5 * p)) {
      this.periods = [];
      this.lastRise = null;
      return { on: false, frequency: 0 };
    }
    return { on: true, frequency: Math.round(1e9 / p) };
  }
}
