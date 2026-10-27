// SPDX-License-Identifier: Apache-2.0
/**
 * Raspberry Pi Pico (RP2040) on rp2040js (MIT, https://github.com/wokwi/rp2040js), behind the
 * chip-independent McuRuntime interface (runtime.ts).
 *
 * - GPIO: every pin's drive follows its function select (SIO, PWM, PIO) and pad pulls.
 *   Pins handed to a UART / I²C / SPI sit at their idle level: the buses are transaction level.
 * - UART0 / UART1 → ports 0 / 1. USB CDC (the Arduino `Serial`, the MicroPython REPL) → port 2:
 *   the runtime plays the USB host.
 * - I²C0 and SPI0 → `host.i2c` / `host.spi`; ADC channels 0–3 (GP26–29) → `host.analogRead`.
 * - Only core 0 runs (rp2040js emulates one Cortex-M0+ core).
 */
import { Simulator, USBCDC, type RP2040 } from 'rp2040js';
import type { Level } from '../core/types';
import { base64ToBytes, uf2Blocks, unpackFirmware } from './firmware';
import { loadHex } from './intelhex';
import { RP2040_BOOTROM_B1 } from './rp2040-bootrom';
import { PIN_HIGH, PIN_LOW, PIN_PULLDOWN, PIN_PULLUP, PIN_Z, type McuHost, type McuRuntime, type PinDrive } from './runtime';

export const RP2040_FLASH = 0x10000000;
/** McuHost / uartReceive port number of the USB serial (CDC) link. */
export const USB_PORT = 2;
export const GPIO_COUNT = 30;

export interface Rp2040RuntimeConfig {
  /** ADC reference (ADC_VREF), normally 3.3 V. */
  vref?: number;
}

// GPIO function select values (RP2040 datasheet 2.19.2)
const F_SPI = 1;
const F_UART = 2;
const F_I2C = 3;
const F_PWM = 4;
const F_SIO = 5;
const F_PIO0 = 6;
const F_PIO1 = 7;
const UART_TX = new Set([0, 4, 8, 12, 16, 20, 24, 28]);

const RXFF = 1 << 6; // UART flag: receive FIFO full
const RX_BACKLOG = 8192;
/** Temperature sensor reading at 27 °C (datasheet 4.9.5). */
const TEMP_SENSOR_VOLTS = 0.706;

const enum GpioState {
  Low = 0,
  High = 1,
  Input = 2,
  InputPullUp = 3,
  InputPullDown = 4,
  InputBusKeeper = 5,
}

function loadImage(mcu: RP2040, image: string): void {
  const flash = mcu.flash;
  if (image.startsWith(':')) {
    loadHex(image, flash, RP2040_FLASH);
  } else if (image.startsWith('bin:')) {
    const bytes = base64ToBytes(image.slice(4));
    if (bytes.length > flash.length) throw new Error('Firmware is too large for the Pico (2 MB flash)');
    flash.set(bytes, 0);
  } else if (image.startsWith('uf2:')) {
    for (const { address, payload } of uf2Blocks(base64ToBytes(image.slice(4)))) {
      const at = address - RP2040_FLASH;
      if (at < 0 || at + payload.length > flash.length) throw new Error('UF2 block outside the Pico flash');
      flash.set(payload, at);
    }
  } else {
    throw new Error('Unknown firmware format for the Pico (expected Intel HEX, UF2 or a .bin image)');
  }
}

export class Rp2040Runtime implements McuRuntime {
  readonly mcu: RP2040;
  private readonly clock: Simulator['clock'];
  private readonly drives = new Uint8Array(GPIO_COUNT);
  private readonly changed: number[] = [];
  private readonly rx: number[][] = [[], [], []];
  private cdc: USBCDC;
  private dirty = true;
  private refreshing = false;

  constructor(
    cfg: Rp2040RuntimeConfig,
    firmware: string,
    private readonly host: McuHost,
  ) {
    // We step the CPU ourselves (runUntil); the Simulator just builds an RP2040 with its clock.
    const sim = new Simulator();
    const clock = (this.clock = sim.clock);
    const mcu = (this.mcu = sim.rp2040);
    mcu.logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as RP2040['logger'];
    mcu.loadBootrom(RP2040_BOOTROM_B1);
    loadImage(mcu, unpackFirmware(firmware).image);
    mcu.core.PC = RP2040_FLASH; // boot2 at the start of flash, as the boot ROM would

    // GPIO: listeners fire on output / direction / pull changes; function selects are re-checked
    // on every runUntil (they change rarely, during setup).
    for (const pin of mcu.gpio.slice(0, GPIO_COUNT)) pin.addListener(() => this.onGpio());
    for (let i = 0; i < GPIO_COUNT; i++) this.drives[i] = this.compute(i);

    // UARTs
    mcu.uart.forEach((uart, port) => {
      uart.onByte = (byte) => host.uartTx(port, byte, clock.nanos);
    });

    // USB serial: we are the USB host with a CDC-ACM driver.
    this.cdc = new USBCDC(mcu.usbCtrl);
    this.cdc.onSerialData = (data) => {
      for (const b of data) host.uartTx(USB_PORT, b, clock.nanos);
    };

    // I²C0, transaction level. rp2040js lets us complete each step synchronously.
    const i2c = host.i2c;
    if (i2c) {
      const bus = mcu.i2c[0];
      bus.onStart = () => {
        i2c.start(clock.nanos);
        bus.completeStart();
      };
      bus.onConnect = (address, mode) => bus.completeConnect(i2c.connect(clock.nanos, address, mode === 1));
      bus.onWriteByte = (value) => bus.completeWrite(i2c.write(clock.nanos, value));
      bus.onReadByte = (ack) => bus.completeRead(i2c.read(clock.nanos, ack) & 0xff);
      bus.onStop = () => {
        i2c.stop(clock.nanos);
        bus.completeStop();
      };
    }

    // SPI0
    const spi = host.spi;
    if (spi) {
      const port = mcu.spi[0];
      port.onTransmit = (value) => port.completeTransmit(spi.transfer(clock.nanos, value & 0xff) & 0xff);
    }

    // ADC: GP26–29 are channels 0–3, channel 4 is the temperature sensor.
    const vref = cfg.vref ?? 3.3;
    const adc = mcu.adc;
    const defaultRead = adc.onADCRead;
    adc.onADCRead = (channel) => {
      const volts = channel < 4 ? host.analogRead(channel, clock.nanos) : TEMP_SENSOR_VOLTS;
      adc.channelValues[channel] = Math.max(0, Math.min(4095, Math.round((volts / vref) * 4095)));
      defaultRead(channel);
    };

    // Remote hosts want fresh inputs right before the firmware samples them (SIO GPIO_IN).
    const sync = host.syncInputs;
    if (sync) {
      const sio = mcu.sio;
      const read = sio.readUint32.bind(sio);
      sio.readUint32 = (offset: number) => {
        if (offset === 0x004) sync();
        return read(offset);
      };
    }
  }

  get timeNs(): number {
    return this.clock.nanos;
  }

  runUntil(ns: number): void {
    const { mcu, clock } = this;
    this.refresh();
    this.feed();
    while (clock.nanos < ns) {
      if (mcu.core.waiting) {
        const toAlarm = clock.nanosToNextAlarm;
        const left = ns - clock.nanos;
        clock.tick(toAlarm > 0 && toAlarm < left ? toAlarm : left);
      } else {
        const cycles = mcu.core.executeInstruction();
        clock.tick((cycles * 1e9) / mcu.clkSys);
      }
      if (this.dirty) this.refresh();
    }
    this.refresh();
  }

  setInput(pin: number, level: Level): void {
    const gpio = this.mcu.gpio[pin];
    if (!gpio) return;
    // Floating: a pull-up / pull-down on the pad decides, else read the last level (bus keeper-ish).
    const v = level === null ? (gpio.pullupEnabled ? true : gpio.pulldownEnabled ? false : null) : level === 1;
    if (v !== null) gpio.setInputValue(v);
  }

  drive(pin: number): PinDrive {
    return this.drives[pin] as PinDrive;
  }

  uartReceive(port: number, byte: number): void {
    const q = this.rx[port];
    if (!q || q.length >= RX_BACKLOG) return;
    q.push(byte & 0xff);
    this.feed();
  }

  /** Move queued input bytes into the UART / USB FIFOs as they make room. */
  private feed(): void {
    for (let port = 0; port < 2; port++) {
      const q = this.rx[port];
      const uart = this.mcu.uart[port];
      while (q.length && uart.enabled && uart.rxEnabled && !(uart.flags & RXFF)) {
        const b = q.shift()!;
        uart.feedByte(b);
        this.host.uartRx?.(port, b, this.clock.nanos);
      }
    }
    const usb = this.rx[USB_PORT];
    const fifo = this.cdc.txFIFO;
    while (usb.length && !fifo.full) this.cdc.sendSerialByte(usb.shift()!);
  }

  private onGpio(): void {
    this.dirty = true;
  }

  private compute(i: number): PinDrive {
    const gpio = this.mcu.gpio[i];
    switch (gpio.functionSelect) {
      case F_UART:
        return UART_TX.has(i) ? PIN_HIGH : gpio.pullupEnabled ? PIN_PULLUP : PIN_Z;
      case F_I2C:
        return PIN_PULLUP; // open drain, idle high (transfers are transaction level)
      case F_SPI:
        return (i & 3) === 0 ? PIN_Z : PIN_LOW; // RX is an input; SCK / TX / CSn idle low
      case F_PWM:
      case F_SIO:
      case F_PIO0:
      case F_PIO1:
      default:
        switch (gpio.value as number) {
          case GpioState.High:
            return PIN_HIGH;
          case GpioState.Low:
            return PIN_LOW;
          case GpioState.InputPullUp:
            return PIN_PULLUP;
          case GpioState.InputPullDown:
            return PIN_PULLDOWN;
          default:
            return PIN_Z;
        }
    }
  }

  /** Recompute every pin's drive and report the ones that changed. */
  private refresh(): void {
    this.dirty = false;
    const changed = this.refreshing ? [] : this.changed;
    changed.length = 0;
    for (let i = 0; i < GPIO_COUNT; i++) {
      const d = this.compute(i);
      if (d === this.drives[i]) continue;
      this.drives[i] = d;
      changed.push(i);
    }
    if (!changed.length) return;
    const outer = !this.refreshing;
    this.refreshing = true;
    try {
      this.host.outputs(this.clock.nanos, changed);
    } finally {
      if (outer) this.refreshing = false;
    }
  }
}
