// SPDX-License-Identifier: Apache-2.0
/**
 * Every Arduino board built on an AVR chip: the chip-independent board model (board.ts)
 * on top of an AvrRuntime (avr-runtime.ts). A board part only describes its pin mapping
 * (see src/parts/arduino-*).
 */
import type { Drive, ModelFactory } from '../core/types';
import type { AvrChip } from './avr';
import type { AvrRuntimeConfig } from './avr-runtime';
import { mcuBoard } from './board';
import type { I2CPins, SPIPins } from './buses';

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
  /** Board pins of the TWI (Wire) bus. Header aliases (e.g. Uno A4.2) join via part.json `internal`. */
  i2c?: I2CPins;
  /** Board pins of the hardware SPI bus. */
  spi?: SPIPins;
  /** I/O supply voltage (default 5 V). 3.3 V boards (e.g. a Pro Mini 8 MHz) get 3.3 V outputs, thresholds and ADC reference. */
  vcc?: number;
}

export function avrBoard(spec: AvrBoardSpec): ModelFactory {
  const pins = Object.keys(spec.gpio);
  const idx = (pin: string) => pins.indexOf(pin);
  const config: AvrRuntimeConfig = {
    chip: spec.chip,
    pins: pins.map((p) => spec.gpio[p]),
    twi: spec.i2c ? { sda: idx(spec.i2c.sda), scl: idx(spec.i2c.scl) } : undefined,
    spi: spec.spi ? { miso: idx(spec.spi.miso) } : undefined,
    vcc: spec.vcc,
  };
  return mcuBoard(
    { pins, analog: spec.adc, power: spec.power, ledPin: spec.ledPin, uart: { rx: '0', tx: '1' }, i2c: spec.i2c, spi: spec.spi, vcc: spec.vcc },
    { family: 'avr', pins: pins.length, config },
  );
}
