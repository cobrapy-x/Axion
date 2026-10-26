// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../../core/types';

/** Time from the coil being energised to the NO contact closing (SRD-05VDC: ≤ 10 ms). */
export const OPERATE_NS = 10e6;
/** Time from the coil being released to the contact falling back to NC (≤ 5 ms). */
export const RELEASE_NS = 5e6;
/** The on-board transistor and coil need at least this much supply. */
const MIN_VCC = 3.5;

/**
 * Relay module: VCC/GND power a transistor that drives the coil from IN.
 * The contact (COM–NO or COM–NC) moves a few ms after the coil changes, using
 * `ctx.schedule()` so the switch happens at the exact simulated time.
 * A floating IN is OFF in both modes (the board has a pull resistor on IN).
 */
const create: ModelFactory = (ctx) => {
  const activeLow = String(ctx.props.trigger) === 'low';
  let coil = false; // the coil is energised
  let closed = false; // the armature has pulled in: COM–NO
  let generation = 0;
  let clicks = 0;

  const powered = () => {
    const vcc = ctx.voltage('VCC');
    const gnd = ctx.voltage('GND');
    return vcc !== null && gnd !== null && vcc - gnd >= MIN_VCC;
  };
  const wantsOn = () => {
    if (!powered()) return false;
    const level = ctx.level('IN');
    return activeLow ? level === 0 : level === 1;
  };

  return {
    switches: () => [closed ? ['COM', 'NO'] : ['COM', 'NC']],
    onPinChange() {
      const next = wantsOn();
      if (next === coil) return;
      coil = next;
      const gen = ++generation;
      // A pulse shorter than the operate time never moves the contact.
      ctx.schedule(ctx.now() + (next ? OPERATE_NS : RELEASE_NS), () => {
        if (gen !== generation || closed === coil) return;
        closed = coil;
        clicks++;
        ctx.invalidate(true); // contacts moved: connectivity changed
      });
    },
    state: () => ({ powered: powered(), coil, closed, clicks }),
  };
};

export default create;
