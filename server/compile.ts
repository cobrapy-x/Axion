// SPDX-License-Identifier: Apache-2.0
/**
 * Local compiler service: turns sketches into firmware using arduino-cli
 * (GPL-3.0, invoked as a separate program — nothing from it is bundled).
 *
 * Exposed by the Vite dev/preview server on 127.0.0.1 only:
 *   GET  /api/health   → { arduinoCli, cores, ready }
 *   POST /api/compile  { fqbn, files: { "sketch.ino": "..." } } → { ok, hex?, log }
 *
 * Results are cached by content hash in ~/.axion/cache, so re-running an
 * unchanged sketch is instant and works with no compiler installed.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const CLI = process.env.ARDUINO_CLI || 'arduino-cli';
const CACHE_DIR = process.env.AXION_CACHE || join(homedir(), '.axion', 'cache');
const FQBN_RE = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+(:[A-Za-z0-9_.=,-]+)?$/;
const FILE_RE = /^[A-Za-z0-9_-]+\.(ino|h|hpp|c|cpp)$/;
const MAX_BODY = 1_000_000;

export interface CompileRequest {
  fqbn: string;
  files: Record<string, string>;
}
export interface CompileResult {
  ok: boolean;
  hex?: string;
  log: string;
  cached?: boolean;
}

function run(cmd: string, args: string[], timeout = 180_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 10_000_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      const missing = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
      resolve({ code: missing ? 127 : code, out: missing ? `"${cmd}" was not found.` : `${stdout}${stderr}` });
    });
  });
}

export async function health() {
  const v = await run(CLI, ['version'], 15_000);
  if (v.code !== 0) return { arduinoCli: null, cores: [] as string[], ready: false };
  const cores = await run(CLI, ['core', 'list', '--format', 'json'], 30_000);
  const ids = [...cores.out.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  return { arduinoCli: v.out.trim(), cores: ids, ready: ids.includes('arduino:avr') };
}

let queue: Promise<unknown> = Promise.resolve();

export function compileSketch(req: CompileRequest): Promise<CompileResult> {
  // One compile at a time: arduino-cli is CPU and disk heavy.
  const job = queue.then(() => doCompile(req));
  queue = job.catch(() => undefined);
  return job;
}

async function doCompile({ fqbn, files }: CompileRequest): Promise<CompileResult> {
  if (!FQBN_RE.test(fqbn)) return { ok: false, log: `Invalid board id "${fqbn}"` };
  if (typeof files?.['sketch.ino'] !== 'string') return { ok: false, log: 'Missing sketch.ino' };
  for (const name of Object.keys(files)) {
    if (!FILE_RE.test(name)) return { ok: false, log: `Invalid file name "${name}"` };
  }

  const hash = createHash('sha256')
    .update(JSON.stringify([fqbn, Object.entries(files).sort()]))
    .digest('hex')
    .slice(0, 32);
  const cached = join(CACHE_DIR, `${hash}.hex`);
  try {
    return { ok: true, hex: await readFile(cached, 'utf8'), log: 'Using cached build.', cached: true };
  } catch {
    /* not cached */
  }

  const work = join(tmpdir(), `axion-${hash}`);
  const sketchDir = join(work, 'sketch');
  const outDir = join(work, 'out');
  try {
    await mkdir(sketchDir, { recursive: true });
    for (const [name, text] of Object.entries(files)) await writeFile(join(sketchDir, name), text);
    const r = await run(CLI, ['compile', '--fqbn', fqbn, '--warnings', 'default', '--output-dir', outDir, sketchDir]);
    if (r.code === 127) {
      return { ok: false, log: `${r.out}\nInstall arduino-cli and run "npm run setup" (see README).` };
    }
    if (r.code !== 0) return { ok: false, log: r.out };
    const hex = await readFile(join(outDir, 'sketch.ino.hex'), 'utf8');
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cached, hex);
    return { ok: true, hex, log: r.out };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!req.url?.startsWith('/api/')) return next();
  // Only accept requests from the Axion page itself: the custom header forces a
  // CORS preflight (which we never answer), and the Host check blocks DNS rebinding.
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (req.headers['x-axion'] !== '1' || !['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    return json(res, 403, { ok: false, log: 'Forbidden' });
  }
  try {
    if (req.url === '/api/health' && req.method === 'GET') return json(res, 200, await health());
    if (req.url === '/api/compile' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as CompileRequest;
      return json(res, 200, await compileSketch(body));
    }
    json(res, 404, { ok: false, log: 'Not found' });
  } catch (err) {
    json(res, 500, { ok: false, log: err instanceof Error ? err.message : String(err) });
  }
}

export function compilerPlugin(): Plugin {
  return {
    name: 'axion-compiler',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}
