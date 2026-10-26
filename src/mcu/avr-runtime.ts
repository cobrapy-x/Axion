// SPDX-License-Identifier: Apache-2.0
/**
 * McuRuntime for AVR chips (avr8js). Owns the CPU and its peripherals; talks to the outside
 * world only through its McuHost (see runtime.ts), so it runs the same in-process or in an
 * MCU worker.
 */
import { ADCMuxInputType } from 'avr8js';
import type { Level } from '../core/types';
import { AvrMcu, PinState, type AvrChip } from './avr';
import { attachSpi, attachTwi, spiMaster, twiEnabled } from './avr-buses';
import { PIN_HIGH, PIN_LOW, PIN_PULLUP, PIN_Z, type McuHost, type McuRuntime, type PinDrive } from './runtime';

export interface AvrRuntimeConfig {
  chip: AvrChip;
  /** Runtime pin index → [port letter, bit]. */
  pins: Array<[string, number]>;
  /** Pins owned by the TWI (I²C) while it is enabled (runtime pin indices, -1 = not mapped). */
  twi?: { sda: number; scl: number };
  /** MISO pin of the hardware SPI (an SPI master forces it to be an input). */
  spi?: { miso: number };
  /** Supply voltage, used as the ADC's AVCC / AREF (default 5 V). */
  vcc?: number;
}

/** Bytes waiting for the UART receiver are capped (a sender with no listener must not grow memory forever). */
const RX_BACKLOG = 4096;

export class AvrRuntime implements McuRuntime {
  readonly mcu: AvrMcu;
  private readonly drives: Uint8Array;
  private readonly ports: Array<AvrMcu['ports'][string] | undefined>;
  private readonly rxQueue: number[] = [];
  private scratch: number[] = [];
  private refreshing = false;

  constructor(
    private readonly cfg: AvrRuntimeConfig,
    firmware: string,
    private readonly host: McuHost,
  ) {
    const mcu = (this.mcu = new AvrMcu(cfg.chip, firmware));
    const { cpu } = mcu;
    this.ports = cfg.pins.map(([port]) => mcu.ports[port]);
    this.drives = new Uint8Array(cfg.pins.length);
    for (let i = 0; i < cfg.pins.length; i++) this.drives[i] = this.compute(i);

    // GPIO: a port listener fires on every DDR / PORT / timer-override change of that port.
    const byPort = new Map<string, number[]>();
    cfg.pins.forEach(([port], i) => {
      let list = byPort.get(port);
      if (!list) byPort.set(port, (list = []));
      list.push(i);
    });
    for (const [name, list] of byPort) mcu.ports[name]?.addListener(() => this.refresh(list));

    // UART0 (Serial)
    mcu.usart.onByteTransmit = (byte) => host.uartTx(0, byte, mcu.timeNs);
    mcu.usart.onRxComplete = () => this.feedRx();

    // Buses are transaction level: whole bytes go to the devices (see avr-buses.ts).
    // Enabling the TWI / SPI master changes how their pins are driven, so watch those registers.
    const watch = (addr: number, pins: number[]) => {
      const prev = cpu.writeHooks[addr];
      cpu.writeHooks[addr] = (value, old, a, mask) => {
        if (!prev?.(value, old, a, mask)) cpu.data[a] = value;
        this.refresh(pins);
        return true;
      };
    };
    if (cfg.twi) {
      if (host.i2c) attachTwi(mcu, host.i2c);
      watch(cfg.chip.twi.TWCR, [cfg.twi.sda, cfg.twi.scl].filter((i) => i >= 0));
    }
    if (cfg.spi) {
      if (host.spi) attachSpi(mcu, host.spi);
      if (cfg.spi.miso >= 0) watch(cfg.chip.spi.SPCR, [cfg.spi.miso]);
    }

    // analogRead(): sample the pin voltage at the moment of the conversion.
    if (cfg.vcc !== undefined) mcu.adc.avcc = mcu.adc.aref = cfg.vcc;
    const defaultRead = mcu.adc.onADCRead;
    mcu.adc.onADCRead = (input) => {
      if (input.type === ADCMuxInputType.SingleEnded) mcu.adc.channelValues[input.channel] = host.analogRead(input.channel, mcu.timeNs);
      defaultRead(input);
    };

    // Remote hosts want to know when the firmware samples its inputs (see McuHost.syncInputs).
    const sync = host.syncInputs;
    if (sync) {
      for (const port of Object.values(cfg.chip.ports)) {
        const prev = cpu.readHooks[port.PIN];
        cpu.readHooks[port.PIN] = (addr) => {
          sync();
          return prev ? prev(addr) : cpu.data[addr];
        };
      }
    }
  }

  get timeNs(): number {
    return this.mcu.timeNs;
  }

  runUntil(ns: number): void {
    if (this.rxQueue.length) this.feedRx();
    this.mcu.runUntil(ns);
  }

  setInput(pin: number, level: Level): void {
    this.ports[pin]?.setPin(this.cfg.pins[pin][1], level === 1);
  }

  drive(pin: number): PinDrive {
    return this.drives[pin] as PinDrive;
  }

  uartReceive(_port: number, byte: number): void {
    if (this.rxQueue.length >= RX_BACKLOG) return;
    this.rxQueue.push(byte & 0xff);
    this.feedRx();
  }

  private feedRx(): void {
    const { usart } = this.mcu;
    if (!this.rxQueue.length || !usart.rxEnable || usart.rxBusy) return;
    const byte = this.rxQueue.shift()!;
    usart.writeByte(byte);
    this.host.uartRx?.(0, byte, this.mcu.timeNs);
  }

  private compute(i: number): PinDrive {
    const port = this.ports[i];
    if (!port) return PIN_Z;
    const { twi, spi } = this.cfg;
    // While TWEN is set the TWI owns SDA/SCL (open drain). Transfers are transaction
    // level, so the lines just sit at their idle level, pulled up.
    if (twi && (i === twi.sda || i === twi.scl) && twiEnabled(this.mcu)) return PIN_PULLUP;
    // An SPI master forces MISO to be an input, whatever DDR says.
    if (spi && i === spi.miso && spiMaster(this.mcu)) return PIN_Z;
    switch (port.pinState(this.cfg.pins[i][1])) {
      case PinState.High:
        return PIN_HIGH;
      case PinState.Low:
        return PIN_LOW;
      case PinState.InputPullUp:
        return PIN_PULLUP;
      default:
        return PIN_Z;
    }
  }

  /** Recompute the drives of `pins`; report the ones that changed. */
  private refresh(pins: readonly number[]): void {
    // The host may re-enter (a solve that makes the firmware's hooks run): use a fresh list then.
    const changed = this.refreshing ? [] : this.scratch;
    changed.length = 0;
    for (const i of pins) {
      const d = this.compute(i);
      if (d === this.drives[i]) continue;
      this.drives[i] = d;
      changed.push(i);
    }
    if (!changed.length) return;
    const outer = !this.refreshing;
    this.refreshing = true;
    try {
      this.host.outputs(this.mcu.timeNs, changed);
    } finally {
      if (outer) this.refreshing = false;
    }
  }
}
