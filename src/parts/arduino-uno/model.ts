// SPDX-License-Identifier: Apache-2.0
import { ATMEGA328P } from '../../mcu/avr';
import { avrBoard } from '../../mcu/avr-board';

/** Arduino pin name → ATmega328P port + bit. */
const gpio: Record<string, [string, number]> = {};
for (let i = 0; i <= 7; i++) gpio[String(i)] = ['D', i];
for (let i = 8; i <= 13; i++) gpio[String(i)] = ['B', i - 8];
for (let i = 0; i <= 5; i++) gpio[`A${i}`] = ['C', i];

export default avrBoard({
  chip: ATMEGA328P,
  gpio,
  power: {
    '5V': 5,
    '3.3V': 3.3,
    IOREF: 5,
    VIN: 5,
    'GND.1': 0,
    'GND.2': 0,
    'GND.3': 0,
    RESET: 'pullup',
  },
  adc: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
});
