#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Compiles every example sketch and every board's starter sketch with the real arduino-cli,
// using the same command as the local compile service (server/compile.ts).
//
//   npm run check:examples              compile and report
//   npm run check:examples -- --write   also replace the prebuilt .hex files with the new builds
//
// Run `npm run setup` first. Set ARDUINO_CLI=/path/to/arduino-cli if it is not on PATH.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.ARDUINO_CLI || 'arduino-cli';
const write = process.argv.includes('--write');

try {
  console.log(execFileSync(cli, ['version'], { stdio: 'pipe' }).toString().trim());
} catch {
  console.error('arduino-cli was not found. Install it and run "npm run setup" first (see README).');
  process.exit(1);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Same as src/mcu/intelhex.ts binToHex: 16-byte records with extended linear addresses. */
function binToHex(data, base) {
  const h = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  const rec = (type, addr, bytes) => {
    let sum = bytes.length + ((addr >> 8) & 0xff) + (addr & 0xff) + type;
    let line = ':' + h(bytes.length) + h((addr >> 8) & 0xff) + h(addr & 0xff) + h(type);
    for (const b of bytes) (sum += b), (line += h(b));
    return line + h((0x100 - (sum & 0xff)) & 0xff);
  };
  const lines = [];
  let upper = -1;
  for (let off = 0; off < data.length; off += 16) {
    const addr = base + off;
    const hi = Math.floor(addr / 0x10000) & 0xffff;
    if (hi !== upper) lines.push(rec(4, 0, [hi >> 8, (upper = hi) & 0xff]));
    lines.push(rec(0, addr & 0xffff, [...data.subarray(off, off + 16)]));
  }
  return lines.join('\n') + '\n:00000001FF\n';
}

/** Part type → part.json, for every part folder. */
const parts = new Map();
for (const dir of readdirSync(join(root, 'src/parts'))) {
  try {
    const m = readJson(join(root, 'src/parts', dir, 'part.json'));
    parts.set(m.type, { ...m, dir });
  } catch {
    // not a part folder
  }
}

/** Everything to compile: { label, fqbn, source, hex (prebuilt file to compare / replace) }. */
const jobs = [];
for (const name of readdirSync(join(root, 'examples')).sort()) {
  const dir = join(root, 'examples', name);
  let meta;
  try {
    meta = readJson(join(dir, 'example.json'));
  } catch {
    continue;
  }
  const diagram = readJson(join(dir, 'diagram.json'));
  for (const [id, file] of Object.entries(meta.sketches ?? {})) {
    if (file.endsWith('.py')) continue; // MicroPython: nothing to compile
    const type = diagram.parts.find((p) => p.id === id)?.type;
    const fqbn = parts.get(type)?.mcu?.fqbn;
    if (!fqbn) {
      jobs.push({ label: `${name}/${file}`, error: `no board with id "${id}" in diagram.json` });
      continue;
    }
    jobs.push({ label: `${name}/${file}`, fqbn, source: readFileSync(join(dir, file), 'utf8'), hex: join(dir, file.replace(/\.ino$/, '.hex')) });
  }
}
for (const p of parts.values()) {
  if (p.mcu?.template && !p.hidden) {
    jobs.push({ label: `${p.dir} (starter sketch)`, fqbn: p.mcu.fqbn, source: p.mcu.template, hex: join(root, 'src/parts', p.dir, 'template.hex') });
  }
}

const work = mkdtempSync(join(tmpdir(), 'axion-check-'));
let failed = 0;
for (const job of jobs) {
  if (job.error) {
    failed++;
    console.log(`FAIL  ${job.label}: ${job.error}`);
    continue;
  }
  const sketchDir = join(work, 'sketch');
  const outDir = join(work, 'out');
  rmSync(sketchDir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(sketchDir, { recursive: true });
  writeFileSync(join(sketchDir, 'sketch.ino'), job.source);
  const r = spawnSync(cli, ['compile', '--fqbn', job.fqbn, '--warnings', 'default', '--output-dir', outDir, sketchDir], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.log(`FAIL  ${job.label} (${job.fqbn})\n${(r.stdout + r.stderr).trim().replace(/^/gm, '      ')}`);
    continue;
  }
  const size = /Sketch uses (\d+) bytes/.exec(r.stdout)?.[1];
  console.log(`ok    ${job.label}${size ? `  (${size} bytes)` : ''}`);
  if (write) {
    // AVR builds have a .hex; RP2040 builds have a .bin, stored as Intel HEX at the flash address.
    try {
      copyFileSync(join(outDir, 'sketch.ino.hex'), job.hex);
    } catch {
      writeFileSync(job.hex, binToHex(readFileSync(join(outDir, 'sketch.ino.bin')), 0x10000000));
    }
  }
}
rmSync(work, { recursive: true, force: true });

console.log(`\n${jobs.length - failed} of ${jobs.length} sketches compiled.${write && !failed ? ' Prebuilt .hex files updated.' : ''}`);
if (failed) process.exit(1);
