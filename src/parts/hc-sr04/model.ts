// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

const US = 1000; // ns
/** Shortest TRIG pulse that starts a measurement. */
export const MIN_TRIGGER_NS = 10 * US;
/** From the end of TRIG to the rising edge of ECHO (8 × 40 kHz burst + processing). */
export const ECHO_DELAY_NS = 400 * US;
/** Round trip of sound per centimetre of distance. */
export const NS_PER_CM = 58 * US;
/** Pulse width when nothing is in range. */
export const TIMEOUT_NS = 38_000 * US;
export const MAX_CM = 400;
const MIN_CM = 2;
const MIN_VCC = 4;

/**
 * HC-SR04: the TRIG pulse is timed in `onPinChange` (exact timestamps from the MCU),
 * and both ECHO edges are placed with `ctx.schedule()`, so `pulseIn()` measures the
 * same width a real sensor would give. The distance can change while running
 * (`input('prop', { key: 'distance', value })` from the inspector's slider).
 */
const create: ModelFactory = (ctx) => {
  let distance = Number(ctx.props.distance);
  let trigSince: number | null = null;
  let busy = false;
  let echo = false;
  let pings = 0;

  const powered = () => {
    const vcc = ctx.voltage('VCC');
    const gnd = ctx.voltage('GND');
    return vcc !== null && gnd !== null && vcc - gnd >= MIN_VCC;
  };
  const cm = () => (Number.isFinite(distance) ? Math.max(MIN_CM, distance) : 100);

  const measure = () => {
    busy = true;
    pings++;
    const d = cm();
    const width = d > MAX_CM ? TIMEOUT_NS : Math.round(d * NS_PER_CM);
    const rise = ctx.now() + ECHO_DELAY_NS;
    ctx.schedule(rise, () => {
      echo = true;
      ctx.invalidate();
      ctx.schedule(rise + width, () => {
        echo = false;
        busy = false;
        ctx.invalidate();
      });
    });
  };

  return {
    drive: (pin) => (pin === 'ECHO' && powered() ? (echo ? 'high' : 'low') : 'z'),
    onPinChange(pin, level) {
      if (pin !== 'TRIG') return;
      if (level === 1) {
        if (trigSince === null) trigSince = ctx.now();
        return;
      }
      if (trigSince === null) return;
      const width = ctx.now() - trigSince;
      trigSince = null;
      // A real sensor ignores triggers while it is still listening for an echo.
      if (width >= MIN_TRIGGER_NS && !busy && powered()) measure();
    },
    input(event, data) {
      const d = (data ?? {}) as { key?: string; value?: unknown };
      if (event === 'prop' && d.key === 'distance') distance = Number(d.value);
      else if (event === 'distance') distance = Number(data);
    },
    state: () => ({ distance: Math.round(cm()), pings, echo, powered: powered() }),
  };
};

export default create;
