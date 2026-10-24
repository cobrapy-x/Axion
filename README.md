# Axion

**A lightweight, offline, open-source simulator for circuits and microcontrollers.**

Wire up Arduinos, LEDs, buttons and more, write your sketch, and run it on your own computer. You don't need an internet connection, don't wait in a compile queue, and don't need an account.

- **Offline and fast.** Sketches compile locally with arduino-cli, and builds are cached, so re-running an unchanged sketch is instant.
- **Lightweight.** The whole app is about 300 KB (about 90 KB gzipped). The simulation runs in a background thread so the UI stays smooth.
- **Multiple microcontrollers.** Several boards run together in lock-step and can talk to each other over wires (UART today).
- **Modular parts.** Each part is one folder: `part.json` + `model.ts` (behaviour) + `view.ts` (animation). Drop a folder in and it appears in the palette.
- **No lock-in.** Axion reads and writes Wokwi-compatible `diagram.json` files.

> Status: early (v0.2). See the [roadmap](docs/ARCHITECTURE.md#roadmap).

## Parts

| Category | Parts |
|---|---|
| Microcontrollers | Arduino Uno, Arduino Nano, Arduino Mega 2560 |
| Actuators | DC motor, DC motor with quadrature encoder, L298N motor driver, servo (SG90) |
| Input | Pushbutton, potentiometer |
| Output | LED (with PWM brightness) |
| Passive and power | Resistor, battery |

Examples: blink and button, two Unos over serial, servo and potentiometer, encoder motor speed control, Mega driving two encoder motors.

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
npm run setup   # downloads the Arduino AVR core and the Servo library once; offline after that
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
| Interact | While running, press buttons and drag potentiometer knobs |
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


## License

Axion is licensed under the [Apache License 2.0](LICENSE). Third-party components are listed in [NOTICE](NOTICE). All bundled dependencies are MIT or BSD. arduino-cli (GPL-3.0) is used as a separate program and is not distributed with Axion.
