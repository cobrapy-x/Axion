// SPDX-License-Identifier: Apache-2.0
/**
 * Client for the local compile service, with an in-memory cache. In the browser that is the
 * Node service (server/compile.ts) at /api; in the desktop app the same two calls go to the
 * Rust side (src-tauri/src/lib.rs) through Tauri's IPC.
 */

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
/** Tauri injects this into its webview; the @tauri-apps/api package is a thin wrapper around it. */
const tauri = (globalThis as { __TAURI_INTERNALS__?: { invoke: TauriInvoke } }).__TAURI_INTERNALS__;
/** True inside the Axion desktop app. */
export const isDesktop = !!tauri;

export interface CompileOutcome {
  ok: boolean;
  hex?: string;
  log: string;
}

/** A firmware, or a loader for one (prebuilt files are fetched only when they are run). */
export type FirmwareSource = string | (() => Promise<string>);

const cache = new Map<string, FirmwareSource>();

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cacheKey = (fqbn: string, source: string) => digest(`${fqbn}\n${source}`);

/** Seed the cache with a prebuilt firmware (examples ship one, so they run with no compiler). */
export async function addPrebuilt(fqbn: string, source: string, hex: FirmwareSource): Promise<void> {
  cache.set(await cacheKey(fqbn, source), hex);
}

export async function compile(fqbn: string, source: string): Promise<CompileOutcome> {
  const key = await cacheKey(fqbn, source);
  const hit = cache.get(key);
  if (hit) {
    const hex = typeof hit === 'string' ? hit : await hit();
    cache.set(key, hex);
    return { ok: true, hex, log: 'Up to date (cached build).' };
  }
  if (tauri) {
    try {
      const out = (await tauri.invoke('compile', { fqbn, files: { 'sketch.ino': source } })) as CompileOutcome;
      if (out.ok && out.hex) cache.set(key, out.hex);
      return out;
    } catch (err) {
      return { ok: false, log: `The desktop compiler failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  let res: Response;
  try {
    res = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Axion': '1' },
      body: JSON.stringify({ fqbn, files: { 'sketch.ino': source } }),
    });
  } catch {
    return { ok: false, log: 'The local compiler service is not reachable. Start Axion with "npm run dev" or "npm start".' };
  }
  if (!res.ok && res.status === 404) {
    return { ok: false, log: 'This build has no compiler service. Start Axion with "npm run dev" or "npm start", or load a .hex file.' };
  }
  const out = (await res.json()) as CompileOutcome;
  if (out.ok && out.hex) cache.set(key, out.hex);
  return out;
}

export interface CompilerHealth {
  arduinoCli: string | null;
  cores: string[];
  ready: boolean;
}

export async function health(): Promise<CompilerHealth | null> {
  if (tauri) {
    try {
      return (await tauri.invoke('health')) as CompilerHealth;
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch('/api/health', { headers: { 'X-Axion': '1' } });
    return res.ok ? ((await res.json()) as CompilerHealth) : null;
  } catch {
    return null;
  }
}

/** Desktop app only: install the Arduino cores and libraries (like `npm run setup`). */
export async function setupCompiler(pico = true): Promise<CompileOutcome> {
  if (!tauri) return { ok: false, log: 'Run "npm run setup" in a terminal.' };
  try {
    return (await tauri.invoke('setup', { pico })) as CompileOutcome;
  } catch (err) {
    return { ok: false, log: String(err) };
  }
}

/** Desktop app only: save a text file with the native "Save as" dialog. Returns the path, null if cancelled. */
export async function saveFileDesktop(name: string, contents: string): Promise<string | null> {
  if (!tauri) throw new Error('not the desktop app');
  return (await tauri.invoke('save_file', { name, contents })) as string | null;
}
