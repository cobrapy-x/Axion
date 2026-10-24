// SPDX-License-Identifier: Apache-2.0
/**
 * Shared behaviour of every Arduino board built on an AVR chip: GPIO, power pins,
 * analogRead(), Serial (USART0) and the on-board L / TX / RX LEDs.
 * A board part only describes its pin mapping (see src/parts/arduino-*).
 */
import { ADCMuxInputType } from 'avr8js';
import type { Drive, ModelFactory } from '../core/types';
import { AvrMcu, PinState, type AvrChip } from './avr';

export interface AvrBoardSpec {
  chip: AvrChip;
  /** Arduino pin name → [port letter, bit]. */
  gpio: Record<string, [string, number]>;
  /** Power and reset pins and how they are driven. */
  power: Record<string, Drive>;
  /** ADC channel number → pin name (A0, A1, …). */
  adc: string[];
  /** Pin with the "L" LED. */
  ledPin?: string;
}

const LED_FLASH_NS = 30_000_000; // TX/RX LEDs stay lit 30 ms after a byte

export function avrBoard(spec: AvrBoardSpec): ModelFactory {
  return (ctx) => {
    const mcu = ctx.firmware ? new AvrMcu(spec.chip, ctx.firmware) : null;
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

      // analogRead(): sample the pin voltage at the moment of the conversion.
      const defaultRead = mcu.adc.onADCRead;
      mcu.adc.onADCRead = (input) => {
        if (input.type === ADCMuxInputType.SingleEnded) {
          const pin = spec.adc[input.channel];
          mcu.adc.channelValues[input.channel] = (pin && ctx.voltage(pin)) || 0;
        }
        defaultRead(input);
      };
    }

    const pinState = (pin: string): PinState | null => {
      const g = spec.gpio[pin];
      return mcu && g ? mcu.ports[g[0]].pinState(g[1]) : null;
    };

    return {
      drive(pin) {
        if (pin in spec.power) return spec.power[pin];
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
        const g = spec.gpio[pin];
        if (mcu && g) mcu.ports[g[0]].setPin(g[1], level === 1);
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
          led13: pinState(spec.ledPin ?? '13') === PinState.High,
          ledTX: now < txUntil,
          ledRX: now < rxUntil,
          running: !!mcu,
        };
      },
    };
  };
}
