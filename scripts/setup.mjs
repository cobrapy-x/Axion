#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// One-time setup: checks for arduino-cli, installs the Arduino AVR core (Uno/Nano/Mega), the
// arduino-pico core (Raspberry Pi Pico)
// and the libraries most sketches need (Servo, LiquidCrystal I2C / LiquidCrystal for the 16×2 LCD).
// After this, compiling works fully offline.
import { execFileSync, spawnSync } from 'node:child_process';

const cli = process.env.ARDUINO_CLI || 'arduino-cli';

function version() {
  try {
    return execFileSync(cli, ['version'], { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

const v = version();
if (!v) {
  const tips = {
    darwin: '  brew install arduino-cli',
    win32: '  winget install ArduinoSA.CLI\n  (or download the .msi from https://docs.arduino.cc/arduino-cli/installation)',
    linux: '  curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh\n  (then add the created bin/ folder to your PATH)',
  };
  console.error(`arduino-cli was not found.\n\nInstall it with:\n${tips[process.platform] ?? tips.linux}\n\nThen run "npm run setup" again.`);
  console.error('Tip: set ARDUINO_CLI=/path/to/arduino-cli if it is installed somewhere unusual.');
  process.exit(1);
}

console.log(`Found ${v}`);
// Raspberry Pi Pico: Earle Philhower's arduino-pico core (LGPL-2.1), ~300 MB with its toolchain.
// Skip it with `npm run setup -- --no-pico`.
const PICO_INDEX = 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json';
const pico = !process.argv.includes('--no-pico');
const urls = pico ? ['--additional-urls', PICO_INDEX] : [];

for (const args of [
  ['core', 'update-index', ...urls],
  ['core', 'install', 'arduino:avr'],
  ...(pico ? [['core', 'install', 'rp2040:rp2040', ...urls]] : []),
  ['lib', 'install', 'Servo'],
  ['lib', 'install', 'LiquidCrystal I2C'],
  ['lib', 'install', 'LiquidCrystal'],
]) {
  console.log(`\n> ${cli} ${args.join(' ')}`);
  const r = spawnSync(cli, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('\nSetup failed. Check your internet connection (needed once for this download).');
    process.exit(r.status ?? 1);
  }
}
console.log('\nAxion is ready. Start it with:  npm run dev');
