// SPDX-License-Identifier: Apache-2.0
/**
 * Glue between the avr8js TWI / SPI peripherals and the MCU-independent bus
 * interfaces of runtime.ts (served by the controllers in buses.ts). Device calls happen
 * when the CPU starts a bus event; the peripheral reports completion after the real byte
 * time on the wire (9 SCL periods per I²C byte, 8 SCK periods per SPI byte), so sketch
 * timing (e.g. how long Wire.endTransmission() takes) matches real hardware.
 */
import type { TWIEventHandler } from 'avr8js';
import type { AvrMcu } from './avr';
import type { I2CBus, SPIBus } from './runtime';

const TWCR_TWEN = 0x04;
const SPCR_SPE = 0x40;

const rev8 = (b: number) => {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
  return r;
};

/** True while the TWI owns the SDA/SCL pins (TWEN set). */
export const twiEnabled = (mcu: AvrMcu) => !!(mcu.cpu.data[mcu.chip.twi.TWCR] & TWCR_TWEN);

/** True while the SPI is enabled as a master (owns MISO as an input). */
export const spiMaster = (mcu: AvrMcu) => !!(mcu.cpu.data[mcu.chip.spi.SPCR] & SPCR_SPE) && mcu.spi.isMaster;

/** Route TWI events to `bus`, stamped with the CPU's exact time. */
export function attachTwi(mcu: AvrMcu, bus: I2CBus): void {
  const { twi, cpu } = mcu;
  // One SCL period in CPU cycles: F_CPU / f_SCL = 16 + 2·TWBR·prescaler.
  const bit = () => Math.max(1, Math.round(mcu.frequency / twi.sclFrequency));
  const later = (bits: number, fn: () => void) => cpu.addClockEvent(fn, bits * bit());
  const handler: TWIEventHandler = {
    start() {
      bus.start(mcu.timeNs);
      later(1, () => twi.completeStart());
    },
    stop() {
      bus.stop(mcu.timeNs);
      later(1, () => twi.completeStop());
    },
    connectToSlave(addr, write) {
      const ack = bus.connect(mcu.timeNs, addr, !write);
      later(9, () => twi.completeConnect(ack));
    },
    writeByte(value) {
      const ack = bus.write(mcu.timeNs, value);
      later(9, () => twi.completeWrite(ack));
    },
    readByte(ack) {
      const value = bus.read(mcu.timeNs, ack);
      later(9, () => twi.completeRead(value));
    },
  };
  twi.eventHandler = handler;
}

/**
 * Route SPI bytes to `bus`. Bytes reach devices in wire order, MSB first: with
 * SPI.setBitOrder(LSBFIRST) the byte is mirrored on the way out and back.
 */
export function attachSpi(mcu: AvrMcu, bus: SPIBus): void {
  const { spi, cpu } = mcu;
  spi.onByte = (value) => {
    // A slave waits for a master's clock, which never comes on this bus.
    if (!spi.isMaster) return;
    const lsb = spi.dataOrder === 'lsbFirst';
    const reply = bus.transfer(mcu.timeNs, lsb ? rev8(value) : value);
    cpu.addClockEvent(() => spi.completeTransfer(lsb ? rev8(reply) : reply), spi.transferCycles);
  };
}
