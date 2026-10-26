// SPDX-License-Identifier: Apache-2.0
/**
 * Hitachi HD44780 character LCD controller (and its many clones), modelled at the
 * level of its bus: the host puts RS / RW / D0-D7 on the pins and pulses E; the
 * controller latches on the falling edge of E.
 *
 * Covers what Arduino libraries use: 8-bit and 4-bit interfaces (including the
 * "0x3, 0x3, 0x3, 0x2" resynchronisation at start-up), clear, home, entry mode,
 * display on/off with cursor and blink, cursor / display shift, function set
 * (1 or 2 lines), DDRAM and CGRAM addressing (custom characters), and reading the
 * busy flag / address counter or data. Instruction execution times are not
 * enforced (the controller is never busy).
 *
 * Used by the 16×2 LCD part in both its parallel and its I²C (PCF8574) variant.
 */

const COLS = 40; // DDRAM columns per line in 2-line mode

export class HD44780 {
  /** DDRAM indexed by its address (0x00-0x4F in 1-line mode; 0x00-0x27 / 0x40-0x67 in 2-line mode). */
  readonly ddram = new Uint8Array(0x80);
  /** CGRAM: 8 custom characters × 8 rows, 5 low bits per row (bit 4 = leftmost pixel). */
  readonly cgram = new Uint8Array(64);
  /** Address counter. */
  ac = 0;
  /** True when the address counter points into CGRAM (after "set CGRAM address"). */
  cgMode = false;
  increment = true;
  shiftOnWrite = false;
  displayOn = false;
  cursorOn = false;
  blinkOn = false;
  eightBit = true;
  twoLines = false;
  /** Display shift in characters (positive = content moved left). */
  shift = 0;
  /** Bumped on every change that can alter what is shown (cheap change detection for views). */
  version = 0;
  /** In 4-bit mode: the first (high) nibble while waiting for the second. */
  private pending: number | null = null;
  /** Next nibble for a 4-bit read: 0 = high, 1 = low. */
  private readPhase = 0;

  constructor() {
    this.reset();
  }

  /** Power-on reset state (datasheet "Initializing by internal reset circuit"). */
  reset(): void {
    this.ddram.fill(0x20);
    this.cgram.fill(0);
    this.ac = 0;
    this.cgMode = false;
    this.increment = true;
    this.shiftOnWrite = false;
    this.displayOn = false;
    this.cursorOn = false;
    this.blinkOn = false;
    this.eightBit = true;
    this.twoLines = false;
    this.shift = 0;
    this.pending = null;
    this.readPhase = 0;
    this.version++;
  }

  /**
   * Falling edge of E. `data` is the bus as D7..D0; in 4-bit mode only D7..D4 are used.
   * Unconnected data pins should be passed as 0.
   */
  strobe(rs: boolean, rw: boolean, data: number): void {
    if (rw) {
      this.endRead(rs);
      return;
    }
    if (this.eightBit) {
      this.execute(rs, data & 0xff);
      return;
    }
    const nibble = (data >> 4) & 0x0f;
    if (this.pending === null) {
      this.pending = nibble;
      return;
    }
    const byte = (this.pending << 4) | nibble;
    this.pending = null;
    this.execute(rs, byte);
  }

  /**
   * What the controller drives on D7..D0 while RW = 1 and E is high: the busy flag
   * (always 0) and address counter when RS = 0, otherwise the RAM byte at AC.
   * In 4-bit mode the current nibble is on D7..D4.
   */
  busOutput(rs: boolean): number {
    const byte = rs ? this.ramAt() : this.ac & 0x7f;
    if (this.eightBit) return byte;
    return this.readPhase === 0 ? byte & 0xf0 : (byte << 4) & 0xf0;
  }

  private endRead(rs: boolean): void {
    if (!this.eightBit && this.readPhase === 0) {
      this.readPhase = 1;
      return;
    }
    this.readPhase = 0;
    if (rs) this.stepAddress(this.increment); // reading data moves AC like writing
  }

  private ramAt(): number {
    return this.cgMode ? this.cgram[this.ac & 0x3f] : this.ddram[this.ac & 0x7f];
  }

  private execute(rs: boolean, b: number): void {
    this.readPhase = 0;
    this.version++;
    if (rs) {
      this.writeData(b);
      return;
    }
    if (b & 0x80) {
      // Set DDRAM address
      this.cgMode = false;
      this.ac = b & 0x7f;
    } else if (b & 0x40) {
      // Set CGRAM address
      this.cgMode = true;
      this.ac = b & 0x3f;
    } else if (b & 0x20) {
      // Function set: DL (bit 4), N (bit 3), F (bit 2, 5×10 font, ignored)
      const eight = !!(b & 0x10);
      if (eight !== this.eightBit) this.pending = null;
      this.eightBit = eight;
      this.twoLines = !!(b & 0x08);
    } else if (b & 0x10) {
      // Cursor or display shift: S/C (bit 3), R/L (bit 2)
      const right = !!(b & 0x04);
      if (b & 0x08) this.shift += right ? -1 : 1;
      else this.stepAddress(right);
    } else if (b & 0x08) {
      // Display control: D, C, B
      this.displayOn = !!(b & 0x04);
      this.cursorOn = !!(b & 0x02);
      this.blinkOn = !!(b & 0x01);
    } else if (b & 0x04) {
      // Entry mode set: I/D, S
      this.increment = !!(b & 0x02);
      this.shiftOnWrite = !!(b & 0x01);
    } else if (b & 0x02) {
      // Return home
      this.cgMode = false;
      this.ac = 0;
      this.shift = 0;
    } else if (b & 0x01) {
      // Clear display
      this.ddram.fill(0x20);
      this.cgMode = false;
      this.ac = 0;
      this.shift = 0;
      this.increment = true;
    }
  }

  private writeData(b: number): void {
    if (this.cgMode) {
      this.cgram[this.ac & 0x3f] = b & 0x1f;
      this.ac = (this.ac + (this.increment ? 1 : -1)) & 0x3f;
      return;
    }
    this.ddram[this.ac & 0x7f] = b;
    this.stepAddress(this.increment);
    if (this.shiftOnWrite) this.shift += this.increment ? 1 : -1;
  }

  /** Move the address counter by one, wrapping like the real DDRAM layout. */
  private stepAddress(up: boolean): void {
    if (this.cgMode) {
      this.ac = (this.ac + (up ? 1 : -1)) & 0x3f;
      return;
    }
    if (!this.twoLines) {
      this.ac = (this.ac + (up ? 1 : 79)) % 80;
      return;
    }
    if (up) this.ac = this.ac === 0x27 ? 0x40 : this.ac >= 0x67 ? 0x00 : this.ac + 1;
    else this.ac = this.ac === 0x40 ? 0x27 : this.ac === 0x00 ? 0x67 : this.ac - 1;
  }

  private address(line: number, col: number): number {
    if (!this.twoLines) return line === 0 ? (((col + this.shift) % 80) + 80) % 80 : -1;
    return line * 0x40 + ((((col + this.shift) % COLS) + COLS) % COLS);
  }

  /** Character codes shown on a `cols` × `rows` glass (row-major). Blank (0x20) when the display is off. */
  visible(cols = 16, rows = 2): number[] {
    const out: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // A 4-line glass shows lines 0/1 on rows 0/1 and their continuation (column + cols) on rows 2/3.
        const a = this.address(r % 2, c + (r >= 2 ? cols : 0));
        out.push(this.displayOn && a >= 0 ? this.ddram[a] : 0x20);
      }
    }
    return out;
  }

  /** Cursor position on the glass, or null when it is off screen or in CGRAM. */
  cursorAt(cols = 16, rows = 2): { x: number; y: number } | null {
    if (this.cgMode) return null;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.address(r % 2, c + (r >= 2 ? cols : 0)) === this.ac) return { x: c, y: r };
      }
    }
    return null;
  }

  /** Visible text as one string per row; custom characters (codes 0-15) appear as their code. */
  lines(cols = 16, rows = 2): string[] {
    const v = this.visible(cols, rows);
    return Array.from({ length: rows }, (_, r) => String.fromCharCode(...v.slice(r * cols, (r + 1) * cols)));
  }
}

/**
 * Glyph rows of the 8 custom characters in wokwi-elements font order
 * (bit 0 = leftmost pixel), for codes 0-7 and their mirrors 8-15.
 */
export function cgramGlyphs(cgram: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i++) {
    const row = cgram[i] & 0x1f;
    let mirrored = 0;
    for (let b = 0; b < 5; b++) if (row & (1 << b)) mirrored |= 1 << (4 - b);
    out.push(mirrored);
  }
  return out;
}
