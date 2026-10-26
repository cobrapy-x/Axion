// SPDX-License-Identifier: Apache-2.0
/** Web Worker entry for one MCU lane (multi-core mode, see mc-thread.ts and docs/MULTICORE.md). */
import { laneThread, type ThreadMsg } from './mc-thread';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = laneThread(() => scope.close());
scope.onmessage = (e: MessageEvent<ThreadMsg>) => handle(e.data);
scope.postMessage({ type: 'loaded' });
