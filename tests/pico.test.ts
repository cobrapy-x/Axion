// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/core/diagram';
import { Engine } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import { bytesToBase64, packFirmware } from '../src/mcu/firmware';
import { binToHex, loadHex } from '../src/mcu/intelhex';
import { MicroPythonRunner } from '../src/mcu/micropython';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const MS = 1e6;
const types = loadPartTypes();

function example(name: string, firmware: Record<string, string>): Engine {
  const e = new Engine(types);
  e.load(parseDiagram(JSON.parse(read(`examples/${name}/diagram.json`))), firmware);
  return e;
}

/** Run to `ms`, collecting serial output of `part`. */
function run(e: Engine, ms: number, part = 'pico', out = { text: '' }): string {
  for (let t = Math.ceil(e.time / MS / 20) * 20; t <= ms; t += 20) {
    e.stepTo(t * MS);
    out.text += e
      .snapshot()
      .events.filter((x) => x.part === part && x.event === 'serial')
      .map((x) => x.data)
      .join('');
  }
  return out.text;
}

const lcdText = (e: Engine, id: string) => {
  const chars = (e.snapshot().states[id]?.chars as number[] | undefined) ?? [];
  return [String.fromCharCode(...chars.slice(0, 16)), String.fromCharCode(...chars.slice(16, 32))];
};

const micropython = () => 'bin:' + bytesToBase64(new Uint8Array(readFileSync(resolve(__dirname, '../public/firmware/micropython-rpi-pico.bin'))));

describe('Raspberry Pi Pico (rp2040js)', () => {
  it('Intel HEX round trip at the flash base address', () => {
    const data = new Uint8Array(70_000).map((_, i) => (i * 7) & 0xff);
    const flash = new Uint8Array(1 << 21);
    loadHex(binToHex(data, 0x10000000), flash, 0x10000000);
    expect([...flash.subarray(0, data.length)]).toEqual([...data]);
  });

  it('starter sketch: USB serial and the on-board LED, outputs at 3.3 V', () => {
    const e = new Engine(types);
    e.load(
      parseDiagram({
        version: 1,
        parts: [
          { type: 'wokwi-pi-pico', id: 'pico', top: 0, left: 0 },
          { type: 'wokwi-resistor', id: 'probe', top: 0, left: 0 },
        ],
        connections: [['pico:GP25', 'probe:1', '', []]],
      }),
      { pico: read('src/parts/pi-pico/template.hex') },
    );
    const out = run(e, 700);
    expect(out).toContain('Hello from the Pico!');
    const led = [e.snapshot().states.pico.led13];
    run(e, 1300);
    led.push(e.snapshot().states.pico.led13);
    expect(led).toContain(true);
    expect(led).toContain(false);
  });

  it('pico-button-led: the button toggles the LED and prints the count', () => {
    const e = example('pico-button-led', { pico: read('examples/pico-button-led/sketch.hex') });
    const out = { text: '' };
    run(e, 400, 'pico', out);
    expect(out.text).toContain('Press the button!');
    expect(e.voltage('pico', 'GP15')).toBeLessThan(0.1);
    e.input('btn1', 'press');
    run(e, 500, 'pico', out);
    e.input('btn1', 'release');
    run(e, 600, 'pico', out);
    expect(out.text).toContain('Presses: 1');
    // 3.3 V logic: GP15 HIGH, minus the LED's drop through 220 Ω
    expect(e.voltage('pico', 'GP15')).toBeGreaterThan(3.1);
    expect(e.voltage('pico', 'GP15')).toBeLessThanOrEqual(3.3);
    // ~6 mA from 3.3 V through 220 Ω: visibly dimmer than on a 5 V Uno (~13 mA), as in real life.
    expect(Number(e.snapshot().states.led1.brightness)).toBeGreaterThan(0.2);
  });

  it('pico-lcd: I²C0 on GP4/GP5 drives the LCD backpack', () => {
    const e = example('pico-lcd', { pico: read('examples/pico-lcd/sketch.hex') });
    run(e, 600);
    const [l1, l2] = lcdText(e, 'lcd1');
    expect(l1).toBe('Hello, Pico!   \x00');
    expect(l2).toMatch(/^Uptime:\s+0s$/);
  });

  it('MicroPython: runs main.py through the raw REPL, shows output and errors, then the REPL', () => {
    const e = new Engine(types);
    e.load(parseDiagram({ version: 1, parts: [{ type: 'wokwi-pi-pico', id: 'pico', top: 0, left: 0, attrs: { language: 'micropython' } }], connections: [] }), {
      pico: packFirmware({ image: micropython(), python: 'print("sum", 2 + 3)\nimport machine\nprint(machine.freq())\nraise ValueError("oops")\n' }),
    });
    const out = run(e, 1500);
    expect(out).toContain('sum 5\r\n125000000');
    expect(out).toContain('ValueError: oops');
    expect(out).not.toContain('raw REPL');
    expect(out).toMatch(/>>> $/);
    // The REPL is live: typed text is evaluated.
    e.input('pico', 'serial', '6*7\n');
    expect(run(e, 1800)).toContain('42');
  });

  it('pico-micropython-dimmer: ADC on GP26 sets the PWM brightness', () => {
    const e = example('pico-micropython-dimmer', { pico: packFirmware({ image: micropython(), python: read('examples/pico-micropython-dimmer/main.py') }) });
    const out = { text: '' };
    e.input('pot1', 'value', 768); // 75 %
    run(e, 1600, 'pico', out);
    const m = [...out.text.matchAll(/pot: (\d+) +brightness: (\d+) %/g)].at(-1);
    expect(m).toBeTruthy();
    expect(Number(m![2])).toBeGreaterThanOrEqual(74);
    expect(Number(m![2])).toBeLessThanOrEqual(76);
    // 75 % duty of a yellow LED's ~5.5 mA (3.3 V, 220 Ω)
    const b = Number(e.snapshot().states.led1.brightness);
    expect(b).toBeGreaterThan(0.15);
    expect(b).toBeLessThan(0.3);
  });

  it('MicroPythonRunner hides the protocol', () => {
    const sent: string[] = [];
    const r = new MicroPythonRunner('print(1)', (s) => sent.push(s));
    r.start();
    const feed = (s: string) => [...s].map((c) => r.output(c.charCodeAt(0))).join('');
    expect(feed('MicroPython v1\r\n>>> raw REPL; CTRL-B to exit\r\n>')).toBe('');
    expect(sent.at(-1)).toBe('print(1)\x04');
    expect(feed('OK1\r\n\x04\x04>')).toBe('1\r\n');
    expect(sent.at(-1)).toBe('\x02');
    expect(feed('\r\nMicroPython v1\r\n>>> ')).toBe('\r\nMicroPython v1\r\n>>> ');
  });
});
