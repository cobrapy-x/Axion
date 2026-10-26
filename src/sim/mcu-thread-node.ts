// SPDX-License-Identifier: Apache-2.0
/**
 * Node worker_threads entry for one MCU lane. Not part of the app: tests bundle it and run
 * the coordinator against real threads (tests/multicore.test.ts).
 */
import { parentPort } from 'node:worker_threads';
import { laneThread, type ThreadMsg } from './mc-thread';

const port = parentPort!;
const handle = laneThread(() => port.close());
port.on('message', (msg: ThreadMsg) => handle(msg));
port.postMessage({ type: 'loaded' });
