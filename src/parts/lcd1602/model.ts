// SPDX-License-Identifier: Apache-2.0
/**
 * 16×2 character LCD (HD44780). Two wirings, like Wokwi's `wokwi-lcd1602`:
 *
 *  - `pins: "i2c"`: the common backpack with a PCF8574 I/O expander (address 0x27,
 *    or 0x3F for the PCF8574A). Its port bits drive the LCD as LiquidCrystal_I2C
 *    expects: P0 = RS, P1 = RW, P2 = E, P3 = backlight, P4-P7 = D4-D7.
 *  - `pins: "full"`: the bare module, RS / RW / E / D0-D7 driven directly by GPIO
 *    (LiquidCrystal in 4- or 8-bit mode). The backlight follows A/K when wired.
 *
 * Both feed the same HD44780 model, which latches on the falling edge of E.
 */
import type { Drive, I2CDevice, ModelFactory } from '../../core/types';
import { parseI2CAddress } from '../../mcu/buses';
import { HD44780 } from './hd44780';

const RS = 0x01;
const RW = 0x02;
const E = 0x04;
const BL = 0x08;

const DATA_PINS = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'];
/** Minimum supply for the controller to run. */
const MIN_VCC = 2.7;

const create: ModelFactory = (ctx) => {
  const i2cMode = ctx.props.pins === 'i2c';
  const vccPin = i2cMode ? 'VCC' : 'VDD';
  const gndPin = i2cMode ? 'GND' : 'VSS';
  const address = parseI2CAddress(ctx.props.i2cAddress, 0x27);
  const lcd = new HD44780();
  /** PCF8574 output latch (I²C variant). */
  let port = 0xff;

  const supply = () => {
    const v = ctx.voltage(vccPin);
    const g = ctx.voltage(gndPin);
    return v === null || g === null ? 0 : v - g;
  };
  let powered = false;
  const checkPower = () => {
    const on = supply() >= MIN_VCC;
    if (on && !powered) {
      lcd.reset();
      port = 0xff; // PCF8574 power-on: all quasi-bidirectional pins high
    }
    powered = on;
  };

  // ─── I²C backpack (PCF8574) ───
  const setPort = (value: number) => {
    const old = port;
    port = value & 0xff;
    // HD44780 latches on the falling edge of E.
    if (old & E && !(port & E)) lcd.strobe(!!(port & RS), !!(port & RW), port & 0xf0);
  };
  const i2c: I2CDevice = {
    addresses: () => (powered ? [address] : []),
    start: () => powered,
    write(byte) {
      setPort(byte);
      return true;
    },
    read() {
      // Pins written high are inputs (weak pull-ups); while RW and E are high the
      // HD44780 drives D4-D7.
      const lcdBus = port & RW && port & E ? lcd.busOutput(!!(port & RS)) | 0x0f : 0xff;
      return port & lcdBus;
    },
    stop() {},
  };

  // ─── Parallel bus ───
  let lastE: number | null = 0;
  const bit = (pin: string) => (ctx.level(pin) === 1 ? 1 : 0);
  const readsBus = () => powered && bit('RW') === 1 && bit('E') === 1;

  const backlight = () => {
    if (!powered) return false;
    if (i2cMode) return !!(port & BL);
    const a = ctx.voltage('A');
    const k = ctx.voltage('K');
    if (a === null && k === null) return true; // backlight pins not wired: assume always on
    return a !== null && k !== null && a - k >= 2;
  };

  return {
    i2c: i2cMode ? i2c : undefined,

    drive(pin): Drive {
      // Parallel reads (RW = 1): the controller drives the data pins while E is high.
      if (i2cMode || !readsBus()) return 'z';
      const n = DATA_PINS.indexOf(pin);
      if (n < 0) return 'z';
      return (lcd.busOutput(bit('RS') === 1) >> n) & 1 ? 'high' : 'low';
    },

    onPinChange(pin, level) {
      if (pin === vccPin || pin === gndPin) checkPower();
      if (i2cMode || !powered || pin !== 'E') return;
      if (lastE === 1 && level === 0) {
        let data = 0;
        for (let i = 0; i < 8; i++) data |= bit(DATA_PINS[i]) << i;
        lcd.strobe(bit('RS') === 1, bit('RW') === 1, data);
      }
      lastE = level;
    },

    state() {
      const cursor = lcd.displayOn ? lcd.cursorAt() : null;
      return {
        chars: powered ? lcd.visible() : [],
        cgram: Array.from(lcd.cgram),
        cursor: !!cursor && lcd.cursorOn,
        blink: !!cursor && lcd.blinkOn,
        cx: cursor?.x ?? -1,
        cy: cursor?.y ?? -1,
        backlight: backlight(),
        powered,
      };
    },
  };
};

export default create;
