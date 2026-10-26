// SPDX-License-Identifier: Apache-2.0
/** I²C / SPI buses, the HD44780 LCD and the 74HC595 shift register. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/core/diagram';
import { Engine } from '../src/core/engine';
import { loadPartTypes } from '../src/core/parts-models';
import { HD44780 } from '../src/parts/lcd1602/hd44780';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const MS = 1e6;

function load(diagram: unknown, firmware: Record<string, string> = {}) {
  const e = new Engine(loadPartTypes());
  e.load(parseDiagram(diagram), firmware);
  return e;
}

const example = (name: string) => JSON.parse(read(`examples/${name}/diagram.json`));
const hex = (name: string) => read(`examples/${name}/sketch.hex`);

/** The two rows of an LCD part's state as text (custom characters show as \x00-\x07). */
function lcdText(e: Engine, id: string): string[] {
  const chars = (e.snapshot().states[id]?.chars as number[] | undefined) ?? [];
  if (!chars.length) return ['', ''];
  return [String.fromCharCode(...chars.slice(0, 16)), String.fromCharCode(...chars.slice(16, 32))];
}

/** Drive an HD44780 in 4-bit mode like LiquidCrystal does (data on D7..D4). */
function lcd4(): { lcd: HD44780; cmd: (b: number) => void; data: (s: string | number[]) => void } {
  const lcd = new HD44780();
  const nibble = (rs: boolean, n: number) => lcd.strobe(rs, false, (n & 0x0f) << 4);
  const send = (rs: boolean, b: number) => {
    nibble(rs, b >> 4);
    nibble(rs, b);
  };
  // Datasheet "initializing by instruction" sequence for 4-bit mode
  nibble(false, 0x3);
  nibble(false, 0x3);
  nibble(false, 0x3);
  nibble(false, 0x2);
  send(false, 0x28); // 4-bit, 2 lines
  send(false, 0x0c); // display on
  send(false, 0x06); // entry mode: increment
  send(false, 0x01); // clear
  return {
    lcd,
    cmd: (b) => send(false, b),
    data: (s) => {
      for (const c of typeof s === 'string' ? [...s].map((ch) => ch.charCodeAt(0)) : s) send(true, c);
    },
  };
}

describe('HD44780 controller', () => {
  it('starts in 8-bit mode with the display off', () => {
    const lcd = new HD44780();
    expect(lcd.eightBit).toBe(true);
    expect(lcd.displayOn).toBe(false);
    expect(lcd.lines()).toEqual([' '.repeat(16), ' '.repeat(16)]);
  });

  it('initialises 4-bit mode and prints text', () => {
    const { lcd, data } = lcd4();
    expect(lcd.eightBit).toBe(false);
    expect(lcd.twoLines).toBe(true);
    data('Hello, Axion!');
    expect(lcd.lines()[0]).toBe('Hello, Axion!   ');
    expect(lcd.cursorAt()).toEqual({ x: 13, y: 0 });
  });

  it('resynchronises when the nibble phase is off at start-up', () => {
    const lcd = new HD44780();
    lcd.strobe(false, false, 0x20); // 8-bit "function set 4-bit": now in 4-bit mode
    lcd.strobe(false, false, 0x30); // a stray first nibble
    const { lcd: ref } = lcd4();
    // Run the standard init on the out-of-phase controller
    for (const n of [0x3, 0x3, 0x3, 0x2]) lcd.strobe(false, false, n << 4);
    for (const b of [0x28, 0x0c, 0x06, 0x01, 0x41]) {
      const rs = b === 0x41;
      lcd.strobe(rs, false, b & 0xf0);
      lcd.strobe(rs, false, (b << 4) & 0xf0);
    }
    expect(lcd.eightBit).toBe(false);
    expect(lcd.lines()[0]).toBe('A' + ' '.repeat(15));
    expect(ref.eightBit).toBe(false);
  });

  it('setCursor addresses the second line at 0x40, clear and home reset', () => {
    const { lcd, cmd, data } = lcd4();
    cmd(0x80 | 0x40 | 3);
    data('row 2');
    expect(lcd.lines()).toEqual([' '.repeat(16), '   row 2        ']);
    cmd(0x02); // home
    expect(lcd.cursorAt()).toEqual({ x: 0, y: 0 });
    data('X');
    cmd(0x01); // clear
    expect(lcd.lines()).toEqual([' '.repeat(16), ' '.repeat(16)]);
    expect(lcd.ac).toBe(0);
  });

  it('wraps from the end of line 1 (0x27) to line 2 (0x40)', () => {
    const { lcd, cmd, data } = lcd4();
    cmd(0x80 | 0x26);
    data('ab');
    expect(lcd.ac).toBe(0x40);
    expect(lcd.ddram[0x27]).toBe('b'.charCodeAt(0));
  });

  it('display control: off blanks the glass, cursor and blink flags', () => {
    const { lcd, cmd, data } = lcd4();
    data('hi');
    cmd(0x08);
    expect(lcd.visible().every((c) => c === 0x20)).toBe(true);
    cmd(0x0f);
    expect(lcd.lines()[0].startsWith('hi')).toBe(true);
    expect(lcd.cursorOn && lcd.blinkOn).toBe(true);
  });

  it('shifts the display and the cursor', () => {
    const { lcd, cmd, data } = lcd4();
    data('ABC');
    cmd(0x18); // display shift left
    expect(lcd.lines()[0].slice(0, 3)).toBe('BC ');
    cmd(0x1c); // display shift right
    cmd(0x1c);
    expect(lcd.lines()[0].slice(0, 4)).toBe(' ABC');
    cmd(0x10); // cursor left
    expect(lcd.ac).toBe(2);
  });

  it('entry mode decrement writes right to left', () => {
    const { lcd, cmd, data } = lcd4();
    cmd(0x04); // decrement, no shift
    cmd(0x80 | 5);
    data('abc');
    expect(lcd.lines()[0].slice(3, 6)).toBe('cba');
  });

  it('createChar stores glyphs in CGRAM and prints them by code', () => {
    const { lcd, cmd, data } = lcd4();
    const heart = [0, 10, 31, 31, 31, 14, 4, 0];
    cmd(0x40 | (2 << 3));
    data(heart);
    expect([...lcd.cgram.slice(16, 24)]).toEqual(heart);
    cmd(0x80);
    data([2, 10]); // code 10 mirrors slot 2
    expect(lcd.visible().slice(0, 2)).toEqual([2, 10]);
  });

  it('reads the address counter and data back in 4-bit mode', () => {
    const { lcd, cmd, data } = lcd4();
    data('Q');
    // busy flag + AC: high nibble, then low nibble
    expect(lcd.busOutput(false)).toBe(0x00);
    lcd.strobe(false, true, 0);
    expect(lcd.busOutput(false)).toBe(0x10);
    lcd.strobe(false, true, 0);
    cmd(0x80);
    expect(lcd.busOutput(true)).toBe('Q'.charCodeAt(0) & 0xf0);
  });
});

/** Uno + I²C LCD, optionally without the SCL wire / at another address. */
function lcdDiagram(opts: { scl?: boolean; address?: string } = {}) {
  return {
    version: 1,
    parts: [
      { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0 },
      { type: 'wokwi-lcd1602', id: 'lcd', top: 0, left: 0, attrs: { pins: 'i2c', i2cAddress: opts.address ?? '0x27' } },
    ],
    connections: [
      ['uno:GND.1', 'lcd:GND', '', []],
      ['uno:5V', 'lcd:VCC', '', []],
      ['uno:A4', 'lcd:SDA', '', []],
      ...(opts.scl === false ? [] : [['uno:A5', 'lcd:SCL', '', []]]),
    ],
  };
}

describe('I²C LCD (PCF8574 backpack)', () => {
  it('lcd-hello example shows the greeting, the heart and the uptime', () => {
    const e = load(example('lcd-hello'), { uno: hex('lcd-hello') });
    e.stepTo(400 * MS);
    let [l1, l2] = lcdText(e, 'lcd1');
    expect(l1).toBe('Hello, Axion!  \x00');
    expect(l2).toMatch(/^Uptime:\s+0s$/);
    const s = e.snapshot().states.lcd1;
    expect(s.backlight).toBe(true);
    expect((s.cgram as number[]).slice(0, 8)).toEqual([0, 10, 31, 31, 31, 14, 4, 0]);
    e.stepTo(2300 * MS);
    [l1, l2] = lcdText(e, 'lcd1');
    expect(l2).toMatch(/^Uptime:\s+2s$/);
  });

  it('NACKs (shows nothing) at the wrong address', () => {
    const e = load(lcdDiagram({ address: '0x3F' }), { uno: hex('lcd-hello') });
    e.stepTo(400 * MS);
    expect(lcdText(e, 'lcd')[0].trim()).toBe('');
  });

  it('NACKs when SCL is not wired', () => {
    const e = load(lcdDiagram({ scl: false }), { uno: hex('lcd-hello') });
    e.stepTo(400 * MS);
    expect(lcdText(e, 'lcd')[0].trim()).toBe('');
  });

  it('works when wired to the SDA/SCL header pins (A4.2 / A5.2)', () => {
    const d = lcdDiagram();
    d.connections = d.connections.map((c) => [String(c[0]).replace('uno:A4', 'uno:A4.2').replace('uno:A5', 'uno:A5.2'), ...c.slice(1)]) as typeof d.connections;
    const e = load(d, { uno: hex('lcd-hello') });
    e.stepTo(400 * MS);
    expect(lcdText(e, 'lcd')[0]).toBe('Hello, Axion!  \x00');
  });

  it('an I²C scanner finds the backpack, and reads return the PCF8574 port', () => {
    const e = load(lcdDiagram(), { uno: read('tests/fixtures/i2c-scan.hex') });
    let out = '';
    for (let t = 50; t <= 400; t += 50) {
      e.stepTo(t * MS);
      out += e
        .snapshot()
        .events.filter((x) => x.part === 'uno' && x.event === 'serial')
        .map((x) => x.data)
        .join('');
    }
    expect(out).toContain('found: 27\r\n');
    expect(out).toContain('write:0\r\n');
    expect(out).toContain('read:2 F0 F0\r\n');
    expect(out).toContain('missing:0\r\n');
  });

  // Optional check against the real LiquidCrystal_I2C library (not redistributable here):
  // build a sketch with it and point AXION_LCDLIB_HEX at the .hex.
  const libHex = process.env.AXION_LCDLIB_HEX;
  it.runIf(!!libHex && existsSync(libHex))('runs the LiquidCrystal_I2C library', () => {
    const e = load(lcdDiagram(), { uno: readFileSync(libHex!, 'utf8') });
    e.stepTo(1500 * MS);
    const [l1, l2] = lcdText(e, 'lcd');
    expect(l1).toBe('Hello, Axion!   ');
    expect(l2.startsWith('\x00 lib ok')).toBe(true);
    expect(e.snapshot().states.lcd.backlight).toBe(true);
  });
});

/** Uno + bare 16-pin LCD wired like the LiquidCrystal tutorial (RS 12, E 11, D4-D7 = 5-2). */
function parallelDiagram() {
  return {
    version: 1,
    parts: [
      { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0 },
      { type: 'wokwi-lcd1602', id: 'lcd', top: 0, left: 0 },
    ],
    connections: [
      ['uno:GND.1', 'lcd:VSS', '', []],
      ['uno:GND.1', 'lcd:RW', '', []],
      ['uno:5V', 'lcd:VDD', '', []],
      ['uno:12', 'lcd:RS', '', []],
      ['uno:11', 'lcd:E', '', []],
      ['uno:5', 'lcd:D4', '', []],
      ['uno:4', 'lcd:D5', '', []],
      ['uno:3', 'lcd:D6', '', []],
      ['uno:2', 'lcd:D7', '', []],
    ],
  };
}

describe('parallel LCD (pins: full)', () => {
  it('runs the HD44780 from GPIO in 4-bit mode', () => {
    const e = load(parallelDiagram(), { uno: read('tests/fixtures/lcd-parallel.hex') });
    e.stepTo(200 * MS);
    expect(lcdText(e, 'lcd')).toEqual(['Parallel 4-bit  ', '  D4-D7 ok      ']);
    const s = e.snapshot().states.lcd;
    expect(s.backlight).toBe(true); // A/K not wired
    expect(s.cursor).toBe(true);
    expect([s.cx, s.cy]).toEqual([10, 1]);
  });

  it('shows nothing without power', () => {
    const d = parallelDiagram();
    d.connections = d.connections.filter((c) => c[1] !== 'lcd:VDD');
    const e = load(d, { uno: read('tests/fixtures/lcd-parallel.hex') });
    e.stepTo(200 * MS);
    expect(lcdText(e, 'lcd')).toEqual(['', '']);
  });

  // Optional: the real LiquidCrystal library (set AXION_LCDPAR_HEX to a build of it).
  const parHex = process.env.AXION_LCDPAR_HEX;
  it.runIf(!!parHex && existsSync(parHex))('runs the LiquidCrystal library', () => {
    const e = load(parallelDiagram(), { uno: readFileSync(parHex!, 'utf8') });
    e.stepTo(300 * MS);
    expect(lcdText(e, 'lcd')).toEqual(['LiquidCrystal   ', '\x01 scroll        ']);
    expect(e.snapshot().states.lcd.blink).toBe(true);
  });
});

describe('Arduino Mega I²C (pins 20/21)', () => {
  it('mega-lcd example drives the LCD through the TWI on pins 20/21', () => {
    const e = load(example('mega-lcd'), { mega: hex('mega-lcd') });
    e.stepTo(500 * MS);
    const [l1, l2] = lcdText(e, 'lcd1');
    expect(l1).toBe('Arduino Mega    ');
    expect(l2).toMatch(/^I2C 20\/21\s+\d+$/);
    const n1 = Number(l2.slice(10));
    e.stepTo(1000 * MS);
    expect(Number(lcdText(e, 'lcd1')[1].slice(10))).toBeGreaterThan(n1);
  });

  it('also works on the SDA/SCL header pins', () => {
    const d = example('mega-lcd');
    d.connections = d.connections.map((c: string[]) => c.map((x) => (x === 'mega:20' ? 'mega:SDA' : x === 'mega:21' ? 'mega:SCL' : x)));
    const e = load(d, { mega: hex('mega-lcd') });
    e.stepTo(500 * MS);
    expect(lcdText(e, 'lcd1')[0]).toBe('Arduino Mega    ');
  });
});

describe('LCD potentiometer meter', () => {
  it('shows the value and a bar graph of custom characters', () => {
    const e = load(example('lcd-pot-meter'), { uno: hex('lcd-pot-meter') });
    e.stepTo(400 * MS);
    let [l1, l2] = lcdText(e, 'lcd1');
    const v = Number(/A0:\s*(\d+)/.exec(l1)?.[1]);
    expect(v).toBeGreaterThan(500);
    expect(v).toBeLessThan(525);
    // ~half the bar: 8 full blocks (code 5) then a partial or blank
    expect(l2.slice(0, 8)).toBe('\x05'.repeat(8));
    expect(l2.slice(9)).toBe(' '.repeat(7));
    e.input('pot1', 'value', 1023);
    e.stepTo(700 * MS);
    [l1, l2] = lcdText(e, 'lcd1');
    expect(l1).toBe('A0: 1023  100%  ');
    expect(l2).toBe('\x05'.repeat(16));
    const glyphs = e.snapshot().states.lcd1.cgram as number[];
    expect(glyphs.slice(8, 16)).toEqual([0, 16, 16, 16, 16, 16, 16, 0]); // 1 column
  });
});

/** Knight Rider: record which single output is on at each step. */
function knightRider(e: Engine): number[] {
  const seen: number[] = [];
  for (let t = 5; t <= 1300; t += 10) {
    e.stepTo(t * MS);
    const q = e.snapshot().states.sr1.q as number;
    if (q && seen[seen.length - 1] !== q) seen.push(q);
  }
  return seen;
}

describe('74HC595 shift register', () => {
  const pattern = [1, 2, 4, 8, 16, 32, 64, 128, 64, 32, 16, 8, 4, 2, 1];

  it('shift-register-leds: shiftOut() runs the Knight Rider pattern on the LEDs', () => {
    const e = load(example('shift-register-leds'), { uno: hex('shift-register-leds') });
    expect(knightRider(e).slice(0, pattern.length)).toEqual(pattern);
    // While Q3 is on, only LED 3 is lit (through its resistor)
    e.stepTo(1144 * MS + 40 * MS);
    for (let t = e.time / MS; (e.snapshot().states.sr1.q as number) !== 8; t += 2) e.stepTo((t + 2) * MS);
    e.stepTo(e.time + 20 * MS);
    const leds = e.snapshot().states;
    for (let q = 0; q < 8; q++) expect(Number(leds[`led${q}`].brightness) > 0.5).toBe(q === 3);
  });

  it('shift-register-spi: SPI.transfer() gives the same pattern', () => {
    const e = load(example('shift-register-spi'), { uno: hex('shift-register-spi') });
    expect(knightRider(e).slice(0, pattern.length)).toEqual(pattern);
    expect(e.voltage('sr1', 'Q0')).not.toBeNull();
  });

  it('outputs float while OE is HIGH and clear on MR', () => {
    const d = example('shift-register-leds');
    d.connections = d.connections.map((c: string[]) => (c[0] === 'bb1:6t.a' ? ['bb1:6t.a', 'bb1:tp.4', 'red', []] : c));
    const e = load(d, { uno: hex('shift-register-leds') });
    e.stepTo(100 * MS);
    expect(e.snapshot().states.sr1.q).toBe(0);
    expect(e.voltage('sr1', 'Q1')).toBeNull();
    expect(e.snapshot().states.sr1.shift).not.toBe(0);
  });

  /** Uno + two chained 595s (chip 1 Q7S → chip 2 DS). */
  const chain = () =>
    load(
      {
        version: 1,
        parts: [
          { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0 },
          { type: 'axion-74hc595', id: 'a', top: 0, left: 0 },
          { type: 'wokwi-74hc595', id: 'b', top: 0, left: 0 },
        ],
        connections: [
          ...['a', 'b'].flatMap((c) => [
            ['uno:5V', `${c}:VCC`, '', []],
            ['uno:5V', `${c}:MR`, '', []],
            ['uno:GND.1', `${c}:GND`, '', []],
            ['uno:GND.1', `${c}:OE`, '', []],
            ['uno:13', `${c}:SHCP`, '', []],
            ['uno:10', `${c}:STCP`, '', []],
          ]),
          ['uno:11', 'a:DS', '', []],
          ['a:Q7S', 'b:DS', '', []],
        ],
      },
      { uno: read('tests/fixtures/daisy-595.hex') },
    );

  it('daisy-chains through Q7S with shiftOut() and with SPI', () => {
    const e = chain();
    e.stepTo(100 * MS);
    let s = e.snapshot().states;
    expect(s.a.q).toBe(0x3c);
    expect(s.b.q).toBe(0xa5);
    expect(e.level('a', 'Q7S')).toBe(0); // bit 7 of 0x3C
    e.stepTo(300 * MS);
    s = e.snapshot().states;
    expect(s.a.q).toBe(0x42);
    expect(s.b.q).toBe(0x81);
  });

  it('SPI bytes need SCK wired to SHCP', () => {
    const e = load(
      {
        version: 1,
        parts: [
          { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0 },
          { type: 'axion-74hc595', id: 'a', top: 0, left: 0 },
        ],
        connections: [
          ['uno:5V', 'a:VCC', '', []],
          ['uno:GND.1', 'a:GND', '', []],
          ['uno:11', 'a:DS', '', []],
          ['uno:10', 'a:STCP', '', []],
        ],
      },
      { uno: read('tests/fixtures/daisy-595.hex') },
    );
    e.stepTo(300 * MS);
    expect(e.snapshot().states.a.q).toBe(0);
  });
});
