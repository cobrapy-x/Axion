// SPDX-License-Identifier: Apache-2.0
import type { Diagram } from '../core/diagram';
import type { Snapshot } from '../core/engine';

/** Messages from the UI to the simulation worker. */
export type ToWorker =
  | { type: 'start'; diagram: Diagram; firmware: Record<string, string> }
  | { type: 'stop' }
  | { type: 'input'; part: string; event: string; data?: unknown };

/** Messages from the simulation worker to the UI. */
export type FromWorker =
  | { type: 'snapshot'; snapshot: Snapshot; speed: number }
  | { type: 'error'; message: string }
  | { type: 'stopped' };
