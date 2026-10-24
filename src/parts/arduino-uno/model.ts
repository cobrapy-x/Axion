// SPDX-License-Identifier: Apache-2.0
import type { Drive, ModelFactory } from '../../core/types';
import { ATmega328P, PinState } from '../../mcu/avr';

type PortName = 'B' | 'C' | 'D';

/** Arduino pin name → ATmega328P port + bit. */
const GPIO: Record<string, [PortName, number]> = {};
for (let i = 0; i <= 7; i++) GPIO[String(i)] = ['D', i];
for (let i = 8; i <= 13; i++) GPIO[String(i)] = ['B', i - 8];
for (let i = 0; i <= 5; i++) GPIO[`A${i}`] = ['C', i];

const POWER: Record<string, Drive> = {
  '5V': 'high',
  '3.3V': 'high',
  IOREF: 'high',
  VIN: 'high',
  'GND.1': 'low',
  'GND.2': 'low',
  'GND.3': 'low',
  RESET: 'pullup',
};

const LED_FLASH_NS = 30_000_000; // TX/RX LEDs stay lit 30 ms after a byte

const create: ModelFactory = (ctx) => {
  const mcu = ctx.firmware ? new ATmega328P(ctx.firmware) : null;
  let serialOut = '';
  let txUntil = 0;
  let rxUntil = 0;
  const rxQueue: number[] = [];

  const feedRx = () => {
    if (!mcu || !rxQueue.length || !mcu.usart.rxEnable || mcu.usart.rxBusy) return;
    mcu.usart.writeByte(rxQueue.shift()!);
    rxUntil = ctx.now() + LED_FLASH_NS;
  };

  if (mcu) {
    for (const port of Object.values(mcu.ports)) {
      port.addListener(() => {
        ctx.advanceTime(mcu.timeNs);
        ctx.invalidate();
      });
    }
    mcu.usart.onByteTransmit = (byte) => {
      serialOut += String.fromCharCode(byte);
      txUntil = mcu.timeNs + LED_FLASH_NS;
      ctx.advanceTime(mcu.timeNs);
      ctx.sendData('1', 'uart', byte); // TX pin → whatever is wired to it
    };
    mcu.usart.onRxComplete = feedRx;
  }

  const pinState = (pin: string): PinState | null => {
    const g = GPIO[pin];
    return mcu && g ? mcu.ports[g[0]].pinState(g[1]) : null;
  };

  return {
    drive(pin) {
      if (pin in POWER) return POWER[pin];
      switch (pinState(pin)) {
        case PinState.High:
          return 'high';
        case PinState.Low:
          return 'low';
        case PinState.InputPullUp:
          return 'pullup';
        default:
          return 'z';
      }
    },

    onPinChange(pin, level) {
      const g = GPIO[pin];
      if (!mcu || !g) return;
      mcu.ports[g[0]].setPin(g[1], level === 1);
      if (g[0] === 'C') mcu.adc.channelValues[g[1]] = level === 1 ? 5 : 0;
    },

    onData(pin, channel, value) {
      if (pin === '0' && channel === 'uart' && rxQueue.length < 4096) {
        rxQueue.push(value);
        feedRx();
      }
    },

    step(timeNs) {
      if (!mcu) return;
      if (rxQueue.length) feedRx();
      mcu.runUntil(timeNs);
    },

    input(event, data) {
      if (event === 'serial' && typeof data === 'string') {
        for (const ch of data) rxQueue.push(ch.charCodeAt(0) & 0xff);
        feedRx();
      }
    },

    state() {
      if (serialOut) {
        ctx.emit('serial', serialOut);
        serialOut = '';
      }
      const now = ctx.now();
      return {
        ledPower: true,
        led13: pinState('13') === PinState.High,
        ledTX: now < txUntil,
        ledRX: now < rxUntil,
        running: !!mcu,
      };
    },
  };
};

export default create;
