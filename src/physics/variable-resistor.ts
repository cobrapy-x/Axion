// SPDX-License-Identifier: Apache-2.0
/**
 * Shared models of variable resistors (trimmer, slide potentiometer, rheostat).
 *
 * A three-pin potentiometer is two R elements, `top` (VCC–SIG) and `bottom` (SIG–GND),
 * that add up to its total resistance; moving the wiper moves resistance from one to the
 * other, like the rotary potentiometer. A rheostat is a single R element between one end
 * of the track and the wiper. Values change in place and call `ctx.invalidate()`, so the
 * solver sees the new resistance immediately, also while the simulation runs.
 */
import { parseValue } from '../core/analog/units';
import type { AnalogElement, ModelFactory, PartModel } from '../core/types';

/** Resistance left between the wiper and an end of the track at the end stop. */
export const END_OHMS = 1;

/** Total track resistance from the `resistance` prop (default 10 kΩ). */
export function trackOhms(value: unknown): number {
  return Math.max(2 * END_OHMS, parseValue(value, 10_000));
}

const clamp01 = (n: number) => (n > 1 ? 1 : n > 0 ? n : 0);

export interface PotOptions {
  /** Pin names: track ends and wiper. */
  vcc: string;
  sig: string;
  gnd: string;
  /** Range of the `value` prop / input (0..max ↔ GND..VCC). */
  max: number;
}

/**
 * A potentiometer whose wiper position comes from the `value` prop (0..max) and from
 * `input('value', n)` sent by the view while the knob / slider moves.
 * State: `value` (same range) and `ohms` (SIG–GND resistance, rounded).
 */
export function potModel(o: PotOptions): ModelFactory {
  return (ctx) => {
    const total = trackOhms(ctx.props.resistance);
    let position = clamp01((Number(ctx.props.value) || 0) / o.max);
    const top = { kind: 'R', a: o.vcc, b: o.sig, ohms: total, id: 'top' } satisfies AnalogElement;
    const bottom = { kind: 'R', a: o.sig, b: o.gnd, ohms: total, id: 'bottom' } satisfies AnalogElement;
    const els: AnalogElement[] = [top, bottom];
    const update = () => {
      top.ohms = Math.max(END_OHMS, total * (1 - position));
      bottom.ohms = Math.max(END_OHMS, total * position);
    };
    update();
    const model: PartModel = {
      elements: () => els,
      input(event, data) {
        if (event !== 'value') return;
        position = clamp01(Number(data) / o.max);
        update();
        ctx.invalidate();
      },
      state: () => ({ value: Math.round(position * o.max), ohms: Math.round(bottom.ohms) }),
    };
    return model;
  };
}

/**
 * A rheostat (two-terminal variable resistor): resistance = position × total between
 * pins 1 and 2. `position` is a live prop in percent (0..100).
 */
export const rheostatModel: ModelFactory = (ctx) => {
  const total = trackOhms(ctx.props.resistance);
  let position = clamp01((Number(ctx.props.position ?? 50) || 0) / 100);
  const r = { kind: 'R', a: '1', b: '2', ohms: total, id: 'r' } satisfies AnalogElement;
  const els: AnalogElement[] = [r];
  const update = () => {
    r.ohms = Math.max(END_OHMS, total * position);
  };
  update();
  return {
    elements: () => els,
    input(event, data) {
      if (event !== 'prop') return;
      const d = data as { key: string; value: number };
      if (d.key !== 'position') return;
      position = clamp01(Number(d.value) / 100);
      update();
      ctx.invalidate();
    },
    state: () => ({ position: Math.round(position * 100), ohms: Math.round(r.ohms), mA: Math.round(Math.abs(ctx.current('r')) * 1e4) / 10 }),
  };
};
