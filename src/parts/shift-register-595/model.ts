// SPDX-License-Identifier: Apache-2.0
/**
 * 74HC595: 8-bit shift register with output latches.
 *
 * - Bit-banged (shiftOut()): a rising edge on SHCP shifts DS into stage 0 and every
 *   stage one place up; Q7S always shows stage 7, so chips chain through Q7S → DS.
 * - Hardware SPI: the chip is also an `SPIDevice` (it has no chip select, so it takes
 *   every byte clocked on its SHCP net). A byte replaces the shift register at once,
 *   and the old contents, which a real chip would push out of Q7S, are passed on to
 *   any chained 595 whose DS is wired to our Q7S.
 * - A rising edge on STCP copies the shift register to the output latches; Q0-Q7
 *   drive them while OE is LOW. MR LOW clears the shift register.
 *
 * Inputs use CMOS thresholds relative to the supply (HIGH ≥ 60 % VCC, LOW ≤ 30 %).
 * For convenience an unconnected OE counts as LOW and an unconnected MR as HIGH.
 */
import type { Drive, ModelFactory, SPIDevice } from '../../core/types';

const MIN_VCC = 2;
const OUTPUTS = ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'];

type Rails = { vcc: number; gnd: number };

const create: ModelFactory = (ctx) => {
  let shift = 0;
  let latch = 0;
  let lastShcp: 0 | 1 | null = null;
  let lastStcp: 0 | 1 | null = null;
  let forwarding = false;

  const rails = (): Rails | null => {
    const vcc = ctx.voltage('VCC');
    const gnd = ctx.voltage('GND');
    return vcc === null || gnd === null || vcc - gnd < MIN_VCC ? null : { vcc, gnd };
  };
  /** 1, 0, or null when floating / in between. */
  const read = (pin: string, r: Rails): 0 | 1 | null => {
    const v = ctx.voltage(pin);
    if (v === null) return null;
    const rel = (v - r.gnd) / (r.vcc - r.gnd);
    return rel >= 0.6 ? 1 : rel <= 0.3 ? 0 : null;
  };
  const resetActive = (r: Rails) => read('MR', r) === 0;
  const outputsOn = (r: Rails) => {
    if (ctx.voltage('OE') === null) return true; // unconnected: treat as tied LOW
    return read('OE', r) === 0;
  };

  /** Pass the bits leaving Q7S to 595s chained on it (transaction-level SPI path). */
  const forward = (byte: number) => {
    if (forwarding) return; // a Q7S → DS loop would recurse forever
    forwarding = true;
    try {
      const clocked = new Set(ctx.peers('SHCP').map((p) => p.id));
      for (const p of ctx.peers('Q7S')) {
        if (p.id !== ctx.id && p.pin === 'DS' && p.model.spi && clocked.has(p.id)) p.model.spi.transfer(byte);
      }
    } finally {
      forwarding = false;
    }
  };

  const spi: SPIDevice = {
    selected: () => {
      const r = rails();
      return !!r && !resetActive(r);
    },
    transfer(byte) {
      const old = shift;
      shift = byte & 0xff;
      forward(old);
      ctx.invalidate(); // Q7S changed
      return old;
    },
  };

  return {
    spi,

    drive(pin): Drive {
      const r = rails();
      if (!r) return 'z';
      if (pin === 'Q7S') return shift & 0x80 ? r.vcc : r.gnd;
      const n = OUTPUTS.indexOf(pin);
      if (n < 0 || !outputsOn(r)) return 'z';
      return (latch >> n) & 1 ? r.vcc : r.gnd;
    },

    onPinChange(pin) {
      const r = rails();
      if (!r) {
        // Unpowered: registers lose their contents.
        shift = 0;
        latch = 0;
        lastShcp = lastStcp = null;
        return;
      }
      if (pin === 'MR' || pin === 'SHCP') {
        const clk = read('SHCP', r);
        if (resetActive(r)) shift = 0;
        else if (pin === 'SHCP' && lastShcp === 0 && clk === 1) shift = ((shift << 1) | (read('DS', r) === 1 ? 1 : 0)) & 0xff;
        lastShcp = clk;
      } else if (pin === 'STCP') {
        const clk = read('STCP', r);
        if (lastStcp === 0 && clk === 1) latch = shift;
        lastStcp = clk;
      } else if (pin === 'VCC' || pin === 'GND') {
        lastShcp = read('SHCP', r);
        lastStcp = read('STCP', r);
      }
    },

    state() {
      const r = rails();
      const on = !!r && outputsOn(r);
      return { powered: !!r, q: on ? latch : 0, enabled: on, shift };
    },
  };
};

export default create;
