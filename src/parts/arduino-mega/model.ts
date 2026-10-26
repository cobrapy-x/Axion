// SPDX-License-Identifier: Apache-2.0
import { ATMEGA2560 } from '../../mcu/avr';
import { avrBoard } from '../../mcu/avr-board';

/** Arduino Mega pin → ATmega2560 port + bit (from the core's variants/mega/pins_arduino.h). */
// prettier-ignore
const gpio: Record<string, [string, number]> = {
  '0': ['E', 0], '1': ['E', 1], '2': ['E', 4], '3': ['E', 5], '4': ['G', 5], '5': ['E', 3], '6': ['H', 3], '7': ['H', 4],
  '8': ['H', 5], '9': ['H', 6], '10': ['B', 4], '11': ['B', 5], '12': ['B', 6], '13': ['B', 7], '14': ['J', 1], '15': ['J', 0],
  '16': ['H', 1], '17': ['H', 0], '18': ['D', 3], '19': ['D', 2], '20': ['D', 1], '21': ['D', 0], '22': ['A', 0], '23': ['A', 1],
  '24': ['A', 2], '25': ['A', 3], '26': ['A', 4], '27': ['A', 5], '28': ['A', 6], '29': ['A', 7], '30': ['C', 7], '31': ['C', 6],
  '32': ['C', 5], '33': ['C', 4], '34': ['C', 3], '35': ['C', 2], '36': ['C', 1], '37': ['C', 0], '38': ['D', 7], '39': ['G', 2],
  '40': ['G', 1], '41': ['G', 0], '42': ['L', 7], '43': ['L', 6], '44': ['L', 5], '45': ['L', 4], '46': ['L', 3], '47': ['L', 2],
  '48': ['L', 1], '49': ['L', 0], '50': ['B', 3], '51': ['B', 2], '52': ['B', 1], '53': ['B', 0],
  A0: ['F', 0], A1: ['F', 1], A2: ['F', 2], A3: ['F', 3], A4: ['F', 4], A5: ['F', 5], A6: ['F', 6], A7: ['F', 7],
  A8: ['K', 0], A9: ['K', 1], A10: ['K', 2], A11: ['K', 3], A12: ['K', 4], A13: ['K', 5], A14: ['K', 6], A15: ['K', 7],
};

export default avrBoard({
  chip: ATMEGA2560,
  gpio,
  power: {
    '5V': 5,
    '5V.1': 5,
    '5V.2': 5,
    '3.3V': 3.3,
    IOREF: 5,
    VIN: 5,
    'GND.1': 0,
    'GND.2': 0,
    'GND.3': 0,
    'GND.4': 0,
    'GND.5': 0,
    RESET: 'pullup',
  },
  i2c: { sda: '20', scl: '21' }, // header SDA/SCL pins join these through part.json `internal`
  spi: { mosi: '51', miso: '50', sck: '52' },
  adc: Array.from({ length: 16 }, (_, i) => `A${i}`),
});
