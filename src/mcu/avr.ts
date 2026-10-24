// SPDX-License-Identifier: Apache-2.0
/**
 * ATmega328P (Arduino Uno / Nano) built on avr8js (MIT, by Uri Shaked).
 * This file only wires avr8js peripherals together; the CPU emulation itself is avr8js.
 */
import {
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js';
import { loadHex } from './intelhex';

export { PinState };

const FLASH_BYTES = 0x8000; // 32 KB

export class ATmega328P {
  readonly frequency = 16_000_000;
  readonly cpu: CPU;
  readonly ports: { B: AVRIOPort; C: AVRIOPort; D: AVRIOPort };
  readonly usart: AVRUSART;
  readonly adc: AVRADC;
  readonly timers: AVRTimer[];

  constructor(hex: string) {
    const flash = new Uint8Array(FLASH_BYTES);
    loadHex(hex, flash);
    this.cpu = new CPU(new Uint16Array(flash.buffer));
    this.timers = [timer0Config, timer1Config, timer2Config].map((c) => new AVRTimer(this.cpu, c));
    this.ports = {
      B: new AVRIOPort(this.cpu, portBConfig),
      C: new AVRIOPort(this.cpu, portCConfig),
      D: new AVRIOPort(this.cpu, portDConfig),
    };
    this.usart = new AVRUSART(this.cpu, usart0Config, this.frequency);
    this.adc = new AVRADC(this.cpu, adcConfig);
  }

  /** Simulated time of this CPU in nanoseconds. */
  get timeNs(): number {
    return (this.cpu.cycles * 1e9) / this.frequency;
  }

  /** Run instructions until the CPU clock reaches `ns`. */
  runUntil(ns: number): void {
    const target = (ns * this.frequency) / 1e9;
    const { cpu } = this;
    while (cpu.cycles < target) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
}
