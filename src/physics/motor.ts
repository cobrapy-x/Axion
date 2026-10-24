// SPDX-License-Identifier: Apache-2.0
/**
 * Brushed DC motor physics shared by the motor parts.
 *
 * Speed follows the applied voltage with a first-order lag (rotor inertia):
 *   ω(t) = ω∞ + (ω0 − ω∞)·e^(−t/τ),  ω∞ = maxSpeed · V / Vrated
 * Between pin changes the voltage is constant, so the motor is advanced with the
 * exact solution of that equation. This makes PWM average out naturally and costs
 * nothing between events.
 *
 * Driven or short-circuited terminals brake quickly (τ_drive); open terminals let the
 * motor coast (τ_coast).
 */
export interface MotorParams {
  /** No-load speed at the rated voltage, in RPM (output shaft). */
  rpm: number;
  /** Rated voltage. */
  ratedVoltage: number;
  /** Time constant while driven / braking, in seconds. */
  tauDrive?: number;
  /** Time constant while coasting (terminals open), in seconds. */
  tauCoast?: number;
}

export class MotorPhysics {
  /** Total shaft rotation in degrees (not wrapped). */
  angle = 0;
  /** Current speed in degrees per nanosecond. */
  private speed = 0;
  private targetSpeed = 0;
  private tau: number;
  private readonly maxDegPerNs: number;
  private readonly tauDrive: number;
  private readonly tauCoast: number;
  private readonly ratedVoltage: number;
  private last: number;

  constructor(p: MotorParams, now: number) {
    this.maxDegPerNs = (Math.max(0, p.rpm) * 360) / 60e9;
    this.tauDrive = (p.tauDrive ?? 0.12) * 1e9;
    this.tauCoast = (p.tauCoast ?? 0.4) * 1e9;
    this.tau = this.tauCoast;
    this.ratedVoltage = Math.max(0.1, p.ratedVoltage);
    this.last = now;
  }

  /** Advance the rotor to time `now` (ns) under the current voltage. */
  advance(now: number): void {
    const dt = now - this.last;
    if (dt <= 0) return;
    this.last = now;
    const k = Math.exp(-dt / this.tau);
    const w0 = this.speed;
    const wInf = this.targetSpeed;
    this.angle += wInf * dt + (w0 - wInf) * this.tau * (1 - k);
    this.speed = wInf + (w0 - wInf) * k;
  }

  /**
   * Apply a new terminal voltage from time `now` on. `null` = open circuit (coast).
   * Speed is clamped to 2× rated so an over-volted motor stays sane.
   */
  setVoltage(volts: number | null, now: number): void {
    this.advance(now);
    if (volts === null) {
      this.targetSpeed = 0;
      this.tau = this.tauCoast;
    } else {
      const ratio = Math.max(-2, Math.min(2, volts / this.ratedVoltage));
      this.targetSpeed = ratio * this.maxDegPerNs;
      this.tau = this.tauDrive;
    }
  }

  get rpm(): number {
    return (this.speed * 60e9) / 360;
  }
}

/** Voltage across two pins, or null when either side is floating. */
export function across(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}
