// SPDX-License-Identifier: Apache-2.0
/**
 * MCU runtime families. A board's McuDescriptor names its family; this registry builds the
 * runtime, both in-process (board.ts) and inside an MCU worker (src/sim/mc-thread.ts).
 * A new family (rp2040js, an out-of-process QEMU bridge…) registers one factory here.
 */
import { AvrRuntime, type AvrRuntimeConfig } from './avr-runtime';
import type { McuDescriptor, McuHost, McuRuntime, RuntimeFactory } from './runtime';

const families = new Map<string, RuntimeFactory>([['avr', (config, firmware, host) => new AvrRuntime(config as AvrRuntimeConfig, firmware, host)]]);

export function registerFamily(name: string, factory: RuntimeFactory): void {
  families.set(name, factory);
}

export function createRuntime(desc: McuDescriptor, firmware: string, host: McuHost): McuRuntime {
  const factory = families.get(desc.family);
  if (!factory) throw new Error(`No emulator for microcontroller family "${desc.family}"`);
  return factory(desc.config, firmware, host);
}
