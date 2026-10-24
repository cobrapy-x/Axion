// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';
import { compilerPlugin } from './server/compile.ts';

export default defineConfig({
  plugins: [compilerPlugin()],
  // Bind to localhost only: the compile endpoint must never be exposed to the network.
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 5173 },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', testTimeout: 30_000 },
});
