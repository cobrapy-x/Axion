// SPDX-License-Identifier: Apache-2.0
/** Client for the local compile service (server/compile.ts), with an in-memory cache. */

export interface CompileOutcome {
  ok: boolean;
  hex?: string;
  log: string;
}

const cache = new Map<string, string>();

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cacheKey = (fqbn: string, source: string) => digest(`${fqbn}\n${source}`);

/** Seed the cache with a prebuilt firmware (examples ship one, so they run with no compiler). */
export async function addPrebuilt(fqbn: string, source: string, hex: string): Promise<void> {
  cache.set(await cacheKey(fqbn, source), hex);
}

export async function compile(fqbn: string, source: string): Promise<CompileOutcome> {
  const key = await cacheKey(fqbn, source);
  const hit = cache.get(key);
  if (hit) return { ok: true, hex: hit, log: 'Up to date (cached build).' };
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
  try {
    const res = await fetch('/api/health', { headers: { 'X-Axion': '1' } });
    return res.ok ? ((await res.json()) as CompilerHealth) : null;
  } catch {
    return null;
  }
}
