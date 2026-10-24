// SPDX-License-Identifier: Apache-2.0
import type { Diagram } from '../core/diagram';
import type { Snapshot } from '../core/engine';
import type { FromWorker, ToWorker } from './protocol';

/** Main-thread handle to the simulation worker. */
export class SimClient {
  private worker: Worker;
  running = false;
  onSnapshot: (s: Snapshot, speed: number) => void = () => {};
  onError: (message: string) => void = () => {};
  onStopped: () => void = () => {};

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'snapshot' && this.running) this.onSnapshot(m.snapshot, m.speed);
      else if (m.type === 'error') {
        this.running = false;
        this.onError(m.message);
      } else if (m.type === 'stopped') this.onStopped();
    };
    this.worker.onerror = (e) => {
      this.running = false;
      this.onError(e.message || 'Simulation worker crashed');
    };
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  start(diagram: Diagram, firmware: Record<string, string>) {
    this.running = true;
    this.send({ type: 'start', diagram, firmware });
  }

  stop() {
    this.running = false;
    this.send({ type: 'stop' });
  }

  input(part: string, event: string, data?: unknown) {
    if (this.running) this.send({ type: 'input', part, event, data });
  }
}
