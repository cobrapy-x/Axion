// SPDX-License-Identifier: Apache-2.0
/**
 * Firmware strings. A microcontroller's firmware travels through the engine (and to MCU
 * workers) as one string. It is either:
 *   - an Intel HEX file (starts with ':'), what arduino-cli produces for AVR boards, or
 *   - a binary flash image, `bin:<base64>` (e.g. a Pico .bin), or a UF2 file, `uf2:<base64>`, or
 *   - a packed bundle, `axion-fw:{json}`, with an image plus extras, e.g. MicroPython firmware
 *     plus the user's main.py, which the board model types into the REPL.
 */

export interface FirmwareBundle {
  /** The flash image: Intel HEX, `bin:` or `uf2:`. */
  image: string;
  /** MicroPython source to run once the interpreter is up. */
  python?: string;
}

const BUNDLE = 'axion-fw:';

export function packFirmware(bundle: FirmwareBundle): string {
  return bundle.python === undefined ? bundle.image : BUNDLE + JSON.stringify(bundle);
}

export function unpackFirmware(firmware: string): FirmwareBundle {
  if (!firmware.startsWith(BUNDLE)) return { image: firmware };
  const b = JSON.parse(firmware.slice(BUNDLE.length)) as FirmwareBundle;
  return { image: String(b.image ?? ''), python: typeof b.python === 'string' ? b.python : undefined };
}

// atob / btoa exist in browsers, workers and Node ≥ 16.
export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** UF2 block → (target address, payload). See https://github.com/microsoft/uf2. */
export function* uf2Blocks(data: Uint8Array): Generator<{ address: number; payload: Uint8Array }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let off = 0; off + 512 <= data.length; off += 512) {
    if (view.getUint32(off, true) !== 0x0a324655 || view.getUint32(off + 4, true) !== 0x9e5d5157) continue;
    const flags = view.getUint32(off + 8, true);
    if (flags & 1) continue; // "not main flash"
    const address = view.getUint32(off + 12, true);
    const size = view.getUint32(off + 16, true);
    yield { address, payload: data.subarray(off + 32, off + 32 + Math.min(size, 476)) };
  }
}
