// SPDX-License-Identifier: Apache-2.0
import { defineConfig, type Plugin } from 'vitest/config';
import { compilerPlugin } from './server/compile.ts';

/**
 * Cross-origin isolation: SharedArrayBuffer (multi-core simulation, docs/MULTICORE.md) is only
 * available to cross-origin isolated pages. The app loads nothing from other origins, so
 * require-corp costs nothing. Set on every response, including the compile API.
 */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

function isolationPlugin(): Plugin {
  // Must return nothing: a function returned from configureServer would run as a late middleware.
  const use = (server: { middlewares: { use: (fn: (req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => void) => void } }): void => {
    server.middlewares.use((_req, res, next) => {
      for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v);
      next();
    });
  };
  return { name: 'axion-cross-origin-isolation', configureServer: use, configurePreviewServer: use };
}

export default defineConfig({
  plugins: [isolationPlugin(), compilerPlugin()],
  // Bind to localhost only: the compile endpoint must never be exposed to the network.
  server: { host: '127.0.0.1', port: 5173, headers: isolation },
  preview: { host: '127.0.0.1', port: 5173, headers: isolation },
  worker: { format: 'es' },
  // Source maps for the web build; the desktop app (built by the Tauri CLI) ships without them.
  build: { target: 'es2022', sourcemap: !process.env.TAURI_ENV_PLATFORM },
  test: {
    environment: 'node',
    testTimeout: 30_000,
    // Parts are discovered with import.meta.glob; a persistent module cache would hide newly added parts.
    fsModuleCache: false,
  },
});
