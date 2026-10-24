// SPDX-License-Identifier: Apache-2.0
/** Load an Intel HEX file (the output of avr-gcc / arduino-cli) into a byte array. */
export function loadHex(source: string, target: Uint8Array): void {
  let base = 0;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith(':')) continue;
    const bytes = line.slice(1).match(/../g)!.map((h) => parseInt(h, 16));
    const [count, addrHi, addrLo, type] = bytes;
    const addr = (addrHi << 8) | addrLo;
    const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0);
    if (sum !== 0) throw new Error(`Corrupt HEX file (bad checksum at line "${line}")`);
    if (type === 0) {
      for (let i = 0; i < count; i++) {
        const dest = base + addr + i;
        if (dest >= target.length) throw new Error('Firmware is too large for this microcontroller');
        target[dest] = bytes[4 + i];
      }
    } else if (type === 2) {
      base = ((bytes[4] << 8) | bytes[5]) << 4; // extended segment address
    } else if (type === 4) {
      base = ((bytes[4] << 8) | bytes[5]) << 16; // extended linear address
    } else if (type === 1) {
      break; // end of file
    }
  }
}
