# Axion

**A lightweight, offline, open-source simulator for circuits and microcontrollers.**

Wire up Arduinos, LEDs, buttons and more, write your sketch, and run it on your own computer. You don't need an internet connection, don't wait in a compile queue, and don't need an account.

- **Offline and fast.** Sketches compile locally with arduino-cli, and builds are cached, so re-running an unchanged sketch is instant.
- **Lightweight.** The whole app is about 170 KB (about 50 KB gzipped). The simulation runs in a background thread so the UI stays smooth.
- **Multiple microcontrollers.** Several boards run together in lock-step and can talk to each other over wires (UART today).
- **Modular parts.** Each part is one folder: `part.json` + `model.ts` (behaviour) + `view.ts` (animation). Drop a folder in and it appears in the palette.
- **No lock-in.** Axion reads and writes Wokwi-compatible `diagram.json` files.

> Status: early (v0.1). Parts so far: Arduino Uno, LED (with PWM brightness), pushbutton, resistor. See the [roadmap](docs/ARCHITECTURE.md#roadmap).

## Getting started

You need [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The bundled examples come with prebuilt firmware, so they run right away.

To compile your own sketches, install **arduino-cli** once:

| OS | Command |
|---|---|
| macOS | `brew install arduino-cli` |
| Windows | `winget install ArduinoSA.CLI` (or the .msi from [the Arduino docs](https://docs.arduino.cc/arduino-cli/installation)) |
| Linux | `curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh \| sh` |

Then run:

```sh
npm run setup   # downloads the Arduino AVR core once; offline after that
```

The toolbar shows **Compiler: ready** when everything is in place.

Other commands:

- `npm start`: optimized build, served locally with the compiler
- `npm test`: engine and firmware tests (runs in Node, no browser needed)

## Using the editor

| Action | How |
|---|---|
| Add a part | Click it in the left palette, or drag it onto the canvas |
| Wire | Click a pin, click empty space to add bends, click another pin to finish (Esc cancels) |
| Move, rotate, delete | Drag a part · select it and press **R** · select it and press **Delete** |
| Pan and zoom | Drag the background · scroll wheel · **Fit** button |
| Run | **▶ Start** (or F5 / Ctrl+Enter). Each microcontroller has its own code tab and serial monitor |
| Prebuilt firmware | **Load .hex** runs any Intel HEX file on the selected board |
| Share | **Save** writes an `.axion.json` project (circuit + code). **Export diagram** writes a Wokwi-compatible `diagram.json` |

## Project layout

```
src/core/      engine (nets, solver, time), part contract, diagram format
src/mcu/       microcontroller wrappers (ATmega328P on avr8js)
src/parts/     one folder per part, auto-discovered
src/sim/       Web Worker that runs the engine
src/editor/    the canvas editor
server/        local compile service (calls arduino-cli)
examples/      example circuits with prebuilt .hex
docs/          architecture and how to write parts
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works, and [docs/WRITING_PARTS.md](docs/WRITING_PARTS.md) to add a part.

## Do I need Docker?

No. The simulator is plain TypeScript, so it runs the same on every OS. The only native piece is the compiler, and arduino-cli already ships for Windows, macOS and Linux and downloads the right toolchain for your machine. Docker is optional for contributors who want an identical build environment.

## License

Axion is licensed under the [Apache License 2.0](LICENSE). Third-party components are listed in [NOTICE](NOTICE). All bundled dependencies are MIT or BSD. arduino-cli (GPL-3.0) is used as a separate program and is not distributed with Axion.
