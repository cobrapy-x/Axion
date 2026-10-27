// SPDX-License-Identifier: Apache-2.0
/**
 * Load an Intel HEX file (the output of avr-gcc / arduino-cli) into a byte array.
 * `offset` is the address of target[0] (e.g. 0x10000000 for the RP2040's flash).
 */
export function loadHex(source: string, target: Uint8Array, offset = 0): void {
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
        const dest = base + addr + i - offset;
        if (dest < 0 || dest >= target.length) throw new Error('Firmware is too large for this microcontroller');
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

/** Encode a binary image as Intel HEX (16-byte records, extended linear addresses), starting at `base`. */
export function binToHex(data: Uint8Array, base = 0): string {
  const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  const record = (type: number, addr: number, bytes: ArrayLike<number>) => {
    let sum = bytes.length + ((addr >> 8) & 0xff) + (addr & 0xff) + type;
    let line = ':' + hex2(bytes.length) + hex2((addr >> 8) & 0xff) + hex2(addr & 0xff) + hex2(type);
    for (let i = 0; i < bytes.length; i++) {
      sum += bytes[i];
      line += hex2(bytes[i]);
    }
    return line + hex2((0x100 - (sum & 0xff)) & 0xff);
  };
  const lines: string[] = [];
  let upper = -1;
  for (let off = 0; off < data.length; off += 16) {
    const addr = base + off;
    const hi = Math.floor(addr / 0x10000) & 0xffff;
    if (hi !== upper) {
      upper = hi;
      lines.push(record(4, 0, [hi >> 8, hi & 0xff]));
    }
    lines.push(record(0, addr & 0xffff, data.subarray(off, Math.min(off + 16, data.length))));
  }
  lines.push(':00000001FF');
  return lines.join('\n') + '\n';
}
