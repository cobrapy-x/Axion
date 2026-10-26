// SPDX-License-Identifier: Apache-2.0
import type { AnalogElement, Drive, ModelFactory } from '../../core/types';
import { ldrOhms } from '../../physics/ldr';

/** Pull-up on the comparator's open-collector output (DO). */
const DO_PULLUP = 10_000;
/** Fixed resistor of the divider, VCC–AO. */
const R_FIXED = 10_000;

/**
 * LM393 light sensor module: 10 kΩ from VCC to AO, the LDR from AO to GND, so AO rises in the
 * dark. The comparator pulls DO LOW while AO is below the threshold (bright); otherwise DO is
 * pulled up to VCC through 10 kΩ. Props as in Wokwi: `lux`, `threshold` (V), `rl10` (kΩ), `gamma`.
 * State: `lux`, `ao` (V), `do` (level), `power`.
 */
const create: ModelFactory = (ctx) => {
  const rl10 = Number(ctx.props.rl10) > 0 ? Number(ctx.props.rl10) * 1000 : 50_000;
  const gamma = Number(ctx.props.gamma) > 0 ? Number(ctx.props.gamma) : 0.7;
  let lux = Math.max(0, Number(ctx.props.lux) || 0);
  let threshold = Number(ctx.props.threshold ?? 2.5);
  const ldr = { kind: 'R', a: 'AO', b: 'GND', ohms: ldrOhms(lux, rl10, gamma), id: 'ldr' } satisfies AnalogElement;
  const els: AnalogElement[] = [{ kind: 'R', a: 'VCC', b: 'AO', ohms: R_FIXED, id: 'r' }, ldr];
  const supply = () => {
    const vcc = ctx.voltage('VCC');
    const gnd = ctx.voltage('GND') ?? 0;
    return vcc === null ? 0 : vcc - gnd;
  };
  /** Comparator output: true = DO pulled LOW (light detected). */
  const bright = () => {
    const ao = ctx.voltage('AO');
    const gnd = ctx.voltage('GND') ?? 0;
    return ao !== null && ao - gnd < threshold;
  };
  return {
    elements: () => els,
    drive(pin): Drive {
      if (pin !== 'DO' || supply() < 2) return 'z';
      return bright() ? 'low' : { volts: ctx.voltage('VCC')!, ohms: DO_PULLUP };
    },
    input(event, data) {
      if (event !== 'prop') return;
      const d = data as { key: string; value: number };
      if (d.key === 'lux') {
        lux = Math.max(0, Number(d.value) || 0);
        ldr.ohms = ldrOhms(lux, rl10, gamma);
      } else if (d.key === 'threshold') threshold = Number(d.value);
      else return;
      ctx.invalidate();
    },
    state() {
      const power = supply() >= 2;
      const ao = ctx.voltage('AO');
      return { lux, ao: ao === null ? null : Math.round(ao * 100) / 100, power, bright: power && bright() };
    },
  };
};

export default create;
