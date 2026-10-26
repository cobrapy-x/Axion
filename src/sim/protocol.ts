// SPDX-License-Identifier: Apache-2.0
import type { Diagram } from '../core/diagram';
import type { Snapshot } from '../core/engine';

/** Messages from the UI to the simulation worker. */
export type ToWorker =
  /** `maxCores` caps the threads used for microcontrollers (1 = single-threaded); default: all cores. */
  | { type: 'start'; diagram: Diagram; firmware: Record<string, string>; maxCores?: number }
  | { type: 'stop' }
  | { type: 'input'; part: string; event: string; data?: unknown };

/** Messages from the simulation worker to the UI. */
export type FromWorker =
  | { type: 'snapshot'; snapshot: Snapshot; speed: number }
  /** The simulation is running; `cores` = threads running microcontrollers in parallel (1 = single-threaded). */
  | { type: 'started'; cores: number }
  | { type: 'error'; message: string }
  | { type: 'stopped' };
