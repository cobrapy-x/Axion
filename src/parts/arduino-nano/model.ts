// SPDX-License-Identifier: Apache-2.0
import { ATMEGA328P } from '../../mcu/avr';
import { avrBoard } from '../../mcu/avr-board';

/** Same chip and pin mapping as the Uno; A6/A7 are analog-only inputs. */
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
    VIN: 5,
    'GND.1': 0,
    'GND.2': 0,
    'GND.3': 0,
    RESET: 'pullup',
  },
  adc: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'],
});
