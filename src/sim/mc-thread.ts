// SPDX-License-Identifier: Apache-2.0
/**
 * Body of an MCU worker thread ("lane"): builds the McuExecutors it is given, then loops
 * forever on shared memory (no postMessage per quantum). Shared by the browser entry
 * (mcu-worker.ts) and the Node worker_threads entry used by tests (mcu-thread-node.ts).
 */
import type { McuDescriptor } from '../mcu/runtime';
import { CMD_STOP, H_CMD, H_DONE, H_GO, H_REP, H_STATUS, McuChannel, STATUS_FAILED, STATUS_READY, waitChange } from './mc-channel';
import { McuExecutor } from './mc-executor';

export type ThreadMsg =
  | {
      type: 'add';
      id: string;
      buffer: SharedArrayBuffer;
      pins: number;
      descriptor: McuDescriptor;
      firmware: string;
      door: SharedArrayBuffer;
      spin: number;
    }
  | { type: 'run' };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Returns the thread's message handler. `close` ends the thread once it is told to stop. */
export function laneThread(close: () => void): (msg: ThreadMsg) => void {
  const lane: Array<{ ch: McuChannel; exec: McuExecutor | null }> = [];
  let door: Int32Array | null = null;
  let spin = 0;

  const ring = () => {
    Atomics.add(door!, 0, 1);
    Atomics.notify(door!, 0);
  };

  return (msg) => {
    if (msg.type === 'add') {
      const ch = new McuChannel(msg.buffer, msg.pins);
      door = new Int32Array(msg.door);
      spin = msg.spin;
      let exec: McuExecutor | null = null;
      try {
        exec = new McuExecutor(ch, msg.descriptor, msg.firmware, (seq) => {
          ring();
          waitChange(ch.i32, H_REP, (seq - 1) | 0, spin);
        });
        Atomics.store(ch.i32, H_STATUS, STATUS_READY);
      } catch (err) {
        ch.setError(`${msg.id}: ${message(err)}`);
        Atomics.store(ch.i32, H_STATUS, STATUS_FAILED);
      }
      Atomics.notify(ch.i32, H_STATUS);
      lane.push({ ch, exec });
      return;
    }
    if (msg.type === 'run' && door) {
      run();
      close();
    }
  };

  function run(): void {
    const last = lane.map(() => 0);
    for (;;) {
      for (let j = 0; j < lane.length; j++) {
        const m = lane[j];
        const i32 = m.ch.i32;
        waitChange(i32, H_GO, last[j], spin);
        last[j] = Atomics.load(i32, H_GO);
        if (Atomics.load(i32, H_CMD) === CMD_STOP) return;
        if (m.exec) {
          try {
            m.exec.runQuantum();
          } catch (err) {
            m.ch.setError(message(err));
            Atomics.store(i32, H_STATUS, STATUS_FAILED);
            m.exec = null;
          }
        }
        Atomics.store(i32, H_DONE, last[j]);
        ring();
      }
    }
  }
}
