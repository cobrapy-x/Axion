// SPDX-License-Identifier: Apache-2.0
/**
 * Runs the user's MicroPython code on a board running the MicroPython firmware, the way
 * `mpremote run main.py` does: through the raw REPL on the serial console.
 *
 *   Ctrl-C Ctrl-C        stop whatever runs, back to the >>> prompt
 *   Ctrl-A               enter the raw REPL ("raw REPL; CTRL-B to exit\r\n>")
 *   <code> Ctrl-D        compile and run; the board answers "OK", the program's output, Ctrl-D,
 *                        any error (traceback), Ctrl-D, ">"
 *   Ctrl-B               back to the normal >>> REPL, so the user can keep typing
 *
 * The protocol chatter is hidden: the serial monitor shows the program's output, errors, and
 * then the interactive REPL.
 */

const RAW_PROMPT = 'raw REPL; CTRL-B to exit\r\n>';
/** If the firmware never reaches the raw REPL, give up hiding its output after this much of it. */
const MAX_HIDDEN = 8192;

type Phase = 'boot' | 'ack' | 'stdout' | 'stderr' | 'repl';

export class MicroPythonRunner {
  private phase: Phase = 'boot';
  private hidden = '';

  /** `send` delivers bytes (0–255, as a string) to the board's console input. */
  constructor(
    private readonly code: string,
    private readonly send: (bytes: string) => void,
  ) {}

  /** Call once the board exists: interrupt anything running and enter the raw REPL. */
  start(): void {
    this.send('\r\x03\x03\x01');
  }

  /** Feed one byte of console output; returns the text to show (often ''). */
  output(byte: number): string {
    const ch = String.fromCharCode(byte);
    switch (this.phase) {
      case 'boot':
        this.hidden += ch;
        if (this.hidden.endsWith(RAW_PROMPT)) {
          this.hidden = '';
          this.phase = 'ack';
          this.send(utf8(this.code.replace(/\r\n?/g, '\n')) + '\x04');
        } else if (this.hidden.length > MAX_HIDDEN) {
          const shown = this.hidden;
          this.phase = 'repl';
          this.hidden = '';
          return shown;
        }
        return '';
      case 'ack':
        this.hidden += ch;
        if (this.hidden.endsWith('OK')) {
          this.hidden = '';
          this.phase = 'stdout';
        }
        return '';
      case 'stdout':
        if (byte === 4) {
          this.phase = 'stderr';
          return '';
        }
        return ch;
      case 'stderr':
        if (byte === 4) {
          // Program finished: leave the raw REPL. MicroPython prints its banner and ">>> ".
          this.phase = 'repl';
          this.send('\x02');
          return '';
        }
        return ch;
      case 'repl':
        return byte === 4 || (byte === 0x3e && this.swallowRawPrompt()) ? '' : ch;
    }
  }

  /** The raw REPL's trailing ">" right after the second Ctrl-D is protocol, not output. */
  private swallowedPrompt = false;
  private swallowRawPrompt(): boolean {
    if (this.swallowedPrompt) return false;
    this.swallowedPrompt = true;
    return true;
  }

  /** Text typed in the serial monitor: MicroPython's REPL wants Enter as '\r'. */
  input(text: string): string {
    return utf8(text.replace(/\r?\n/g, '\r'));
  }
}

/** UTF-8 encode, one byte per char code (what uartReceive takes). */
function utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x4000) out += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return out;
}
