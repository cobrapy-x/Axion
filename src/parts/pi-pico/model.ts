// SPDX-License-Identifier: Apache-2.0
import { mcuBoard } from '../../mcu/board';
import { GPIO_COUNT, USB_PORT } from '../../mcu/rp2040-runtime';

/** Runtime pin index = GPIO number. GP23–25 and GP29 are on-board (GP25: the LED). */
const pins = Array.from({ length: GPIO_COUNT }, (_, i) => `GP${i}`);

export default mcuBoard(
  {
    pins,
    analog: ['GP26', 'GP27', 'GP28', 'GP29'],
    power: {
      VBUS: 5, // powered over USB
      VSYS: 5,
      '3V3': 3.3,
      ADC_VREF: 3.3,
      '3V3_EN': { volts: 3.3, ohms: 100_000 },
      RUN: { volts: 3.3, ohms: 50_000 },
      'GND.1': 0,
      'GND.2': 0,
      'GND.3': 0,
      'GND.4': 0,
      'GND.5': 0,
      'GND.6': 0,
      'GND.7': 0,
      AGND: 0,
    },
    ledPin: 'GP25',
    uarts: [
      { tx: 'GP0', rx: 'GP1' }, // Serial1
      { tx: 'GP8', rx: 'GP9' }, // Serial2
    ],
    console: USB_PORT, // Serial / the MicroPython REPL
    i2c: { sda: 'GP4', scl: 'GP5' },
    spi: { mosi: 'GP19', miso: 'GP16', sck: 'GP18' },
    vcc: 3.3,
    logic: { vih: 2.0, vil: 0.8 }, // RP2040 datasheet, IOVDD 3.3 V
  },
  { family: 'rp2040', pins: GPIO_COUNT, config: { vref: 3.3 } },
);
