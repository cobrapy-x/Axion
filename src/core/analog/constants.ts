// SPDX-License-Identifier: Apache-2.0
/** Electrical constants of the analog solver (see docs/SOLVER.md). */

/** Output resistance of a push-pull digital pin ('high' / 'low'): AVR ≈ 25 Ω (VOH ≈ 4.5 V at 20 mA). */
export const PIN_OHMS = 25;
/** Internal pull-up / pull-down ('pullup' / 'pulldown'): AVR datasheet 20–50 kΩ. */
export const PULL_OHMS = 35_000;
/** Drives below this resistance are "strong" (they beat pulls; two of them disagreeing is a short). */
export const STRONG_OHMS = 1_000;
/** Default resistance of a pair returned by the legacy `resistors()` hook. */
export const LEGACY_OHMS = 1_000;
/** Default closed resistance of a SW element. */
export const SW_OHMS = 0.05;
/** Default series resistance of a D element. */
export const DIODE_OHMS = 1;
/** Default on-resistance of a FET element. */
export const FET_OHMS = 0.1;
/** Default current gain of a BJT element. */
export const BJT_BETA = 100;
/** BJT base-emitter drop and its series resistance. */
export const VBE = 0.65;
export const BE_OHMS = 10;
/** BJT collector-emitter voltage in saturation and the resistance on top of it. */
export const VCE_SAT = 0.2;
export const SAT_OHMS = 1;

/** Conductance of something that is "off" (diode, open switch, transistor in cutoff). Keeps matrices regular. */
export const G_LEAK = 1e-9;
/** Below this current a diode / transistor does not count as connecting two nets (only leakage flows). */
export const I_FLOAT = 5e-8;
/** Tiny conductance to ground on every matrix row (never changes a visible result). */
export const G_MIN = 1e-12;
/** Any element (other than a capacitor) carrying more than this is reported as a short circuit. */
export const SHORT_AMPS = 1;

/** Nonlinear iteration cap per solve. */
export const MAX_ITER = 40;

// Time stepping (seconds)
/** Step used to solve a reactive cluster "at" an event: capacitor voltages and inductor currents are held. */
export const H_EVENT = 1e-9;
/** Smallest / largest internal integration step. */
export const H_MIN = 1e-6;
export const H_MAX = 0.25;
/** Smallest / largest interval between two reports (re-solves the rest of the circuit sees). */
export const REPORT_MIN = 10e-6;
export const REPORT_MAX = 0.25;
/** A report is made at least every time a node voltage moved this much (≈ 1 LSB of a 10-bit ADC at 5 V). */
export const REPORT_VOLTS = 0.005;
