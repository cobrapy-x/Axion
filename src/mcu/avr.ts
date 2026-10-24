// SPDX-License-Identifier: Apache-2.0
/**
 * AVR microcontrollers built on avr8js (MIT, by Uri Shaked).
 * This file only describes each chip (memory sizes, register addresses, interrupt
 * vectors) and wires avr8js peripherals together; the CPU emulation itself is avr8js.
 */
import {
  ADCMuxInputType,
  ADCReference,
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portAConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  portEConfig,
  portFConfig,
  portGConfig,
  portHConfig,
  portJConfig,
  portKConfig,
  portLConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js';
import type { ADCConfig, ADCMuxConfiguration, AVRExternalInterrupt, AVRPinChangeInterrupt, AVRPortConfig, AVRTimerConfig } from 'avr8js';
import { loadHex } from './intelhex';

export { PinState };

export interface AvrChip {
  name: string;
  flashBytes: number;
  /** Size of the data space above the 0x100 register file, as avr8js expects. */
  sramBytes: number;
  ports: Record<string, AVRPortConfig>;
  timers: AVRTimerConfig[];
  usart: typeof usart0Config;
  adc: ADCConfig;
}

// ───────────────────────────── ATmega328P (Uno, Nano) ─────────────────────────────

export const ATMEGA328P: AvrChip = {
  name: 'ATmega328P',
  flashBytes: 0x8000,
  sramBytes: 8192,
  ports: { B: portBConfig, C: portCConfig, D: portDConfig },
  timers: [timer0Config, timer1Config, timer2Config],
  usart: usart0Config,
  adc: adcConfig,
};

// ───────────────────────────── ATmega2560 (Mega) ─────────────────────────────
// Register addresses and vector numbers come from avr-libc's iomxx0_1.h.
// avr8js wants interrupt *word* addresses: vector n lives at n * 2.

const vec = (n: number) => n * 2;

const extInt = (n: number): AVRExternalInterrupt => ({
  EICR: n < 4 ? 0x69 : 0x6a, // EICRA / EICRB
  EIMSK: 0x3d,
  EIFR: 0x3c,
  index: n,
  iscOffset: (n % 4) * 2,
  interrupt: vec(n + 1), // INT0_vect = 1 … INT7_vect = 8
});

const pcint = (n: 0 | 2): AVRPinChangeInterrupt => ({
  PCIE: n,
  PCICR: 0x68,
  PCIFR: 0x3b,
  PCMSK: 0x6b + n,
  pinChangeInterrupt: vec(9 + n), // PCINT0_vect = 9, PCINT2_vect = 11
  mask: 0xff,
  offset: 0,
});

const megaPorts: Record<string, AVRPortConfig> = {
  A: portAConfig,
  B: { ...portBConfig, pinChange: pcint(0) },
  C: portCConfig,
  D: { ...portDConfig, pinChange: undefined, externalInterrupts: [extInt(0), extInt(1), extInt(2), extInt(3)] },
  E: { ...portEConfig, externalInterrupts: [null, null, null, null, extInt(4), extInt(5), extInt(6), extInt(7)] },
  F: portFConfig,
  G: portGConfig,
  H: portHConfig,
  J: portJConfig,
  K: { ...portKConfig, pinChange: pcint(2) },
  L: portLConfig,
};

const PORT = (p: string) => megaPorts[p].PORT;

/** 16-bit timers 1, 3, 4, 5 share one layout; only addresses, vectors and output pins differ. */
function timer16(base: number, timsk: number, tifr: number, firstVector: number, pins: Array<[string, number]>): AVRTimerConfig {
  return {
    ...timer1Config,
    captureInterrupt: vec(firstVector),
    compAInterrupt: vec(firstVector + 1),
    compBInterrupt: vec(firstVector + 2),
    compCInterrupt: vec(firstVector + 3),
    ovfInterrupt: vec(firstVector + 4),
    TCCRA: base,
    TCCRB: base + 1,
    TCCRC: base + 2,
    TCNT: base + 4,
    ICR: base + 6,
    OCRA: base + 8,
    OCRB: base + 10,
    OCRC: base + 12,
    TIMSK: timsk,
    TIFR: tifr,
    compPortA: PORT(pins[0][0]),
    compPinA: pins[0][1],
    compPortB: PORT(pins[1][0]),
    compPinB: pins[1][1],
    compPortC: PORT(pins[2][0]),
    compPinC: pins[2][1],
    externalClockPort: 0,
    externalClockPin: 0,
  };
}

const megaAdcChannels: ADCMuxConfiguration = {};
for (let i = 0; i < 8; i++) {
  megaAdcChannels[i] = { type: ADCMuxInputType.SingleEnded, channel: i };
  megaAdcChannels[0x20 + i] = { type: ADCMuxInputType.SingleEnded, channel: 8 + i };
}
megaAdcChannels[0x1e] = { type: ADCMuxInputType.Constant, voltage: 1.1 };
megaAdcChannels[0x1f] = { type: ADCMuxInputType.Constant, voltage: 0 };

export const ATMEGA2560: AvrChip = {
  name: 'ATmega2560',
  flashBytes: 0x40000,
  sramBytes: 0x2100, // RAMEND = 0x21FF (8 KB SRAM after 0x200 bytes of registers)
  ports: megaPorts,
  timers: [
    {
      ...timer0Config,
      compAInterrupt: vec(21),
      compBInterrupt: vec(22),
      ovfInterrupt: vec(23),
      compPortA: PORT('B'),
      compPinA: 7,
      compPortB: PORT('G'),
      compPinB: 5,
      externalClockPort: PORT('D'),
      externalClockPin: 7,
    },
    { ...timer16(0x80, 0x6f, 0x36, 16, [['B', 5], ['B', 6], ['B', 7]]), externalClockPort: PORT('D'), externalClockPin: 6 },
    {
      ...timer2Config,
      compAInterrupt: vec(13),
      compBInterrupt: vec(14),
      ovfInterrupt: vec(15),
      compPortA: PORT('B'),
      compPinA: 4,
      compPortB: PORT('H'),
      compPinB: 6,
    },
    timer16(0x90, 0x71, 0x38, 31, [['E', 3], ['E', 4], ['E', 5]]),
    timer16(0xa0, 0x72, 0x39, 41, [['H', 3], ['H', 4], ['H', 5]]),
    timer16(0x120, 0x73, 0x3a, 46, [['L', 3], ['L', 4], ['L', 5]]),
  ],
  usart: { ...usart0Config, rxCompleteInterrupt: vec(25), dataRegisterEmptyInterrupt: vec(26), txCompleteInterrupt: vec(27) },
  adc: {
    ...adcConfig,
    adcInterrupt: vec(29),
    numChannels: 16,
    muxInputMask: 0x3f,
    muxChannels: megaAdcChannels,
    adcReferences: [ADCReference.AREF, ADCReference.AVCC, ADCReference.Internal1V1, ADCReference.Internal2V56],
  },
};

// ───────────────────────────── runtime ─────────────────────────────

export class AvrMcu {
  readonly frequency = 16_000_000;
  readonly cpu: CPU;
  readonly ports: Record<string, AVRIOPort> = {};
  readonly usart: AVRUSART;
  readonly adc: AVRADC;
  readonly timers: AVRTimer[];

  constructor(readonly chip: AvrChip, hex: string) {
    const flash = new Uint8Array(chip.flashBytes);
    loadHex(hex, flash);
    this.cpu = new CPU(new Uint16Array(flash.buffer), chip.sramBytes);
    this.timers = chip.timers.map((c) => new AVRTimer(this.cpu, c));
    for (const [name, cfg] of Object.entries(chip.ports)) this.ports[name] = new AVRIOPort(this.cpu, cfg);
    this.usart = new AVRUSART(this.cpu, chip.usart, this.frequency);
    this.adc = new AVRADC(this.cpu, chip.adc);
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
