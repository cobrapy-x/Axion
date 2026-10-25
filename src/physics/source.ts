// SPDX-License-Identifier: Apache-2.0
import type { ModelFactory } from '../core/types';

/**
 * An ideal fixed-voltage source between '+' and '-' (batteries, cells, packs).
 * All grounds in Axion share 0 V, so '-' drives 0 V and '+' drives `volts`.
 */
export function fixedSource(volts: number): ModelFactory {
  return () => ({
    drive: (pin) => (pin === '+' ? volts : pin === '-' ? 0 : 'z'),
  });
}
