# Axion

**A lightweight, offline, open-source simulator for circuits and microcontrollers.**

Wire up Arduinos, LEDs, buttons and more, write your sketch, and run it on your own computer. You don't need an internet connection, don't wait in a compile queue, and don't need an account.

- **Offline and fast.** Sketches compile locally with arduino-cli, and builds are cached, so re-running an unchanged sketch is instant.
- **Lightweight.** The whole app is under 500 KB (about 130 KB gzipped). The simulation runs in a background thread so the UI stays smooth.
- **Multiple microcontrollers.** Several boards run together in lock-step and can talk to each other over wires (UART today).
- **Modular parts.** Each part is one folder: `part.json` + `model.ts` (behaviour) + `view.ts` (animation). Drop a folder in and it appears in the palette.
- **No lock-in.** Axion reads and writes Wokwi-compatible `diagram.json` files.

> Status: early (v0.3). See the [roadmap](docs/ARCHITECTURE.md#roadmap).

## Parts

| Category | Parts |
|---|---|
| Prototyping | Breadboard (full 830, half 400, mini 170): parts plugged in connect automatically |
| Microcontrollers | Arduino Uno, Arduino Nano, Arduino Mega 2560 |
| Actuators | DC motor, DC motor with quadrature encoder, L298N motor driver, servo (SG90) |
| Input | Pushbutton, slide switch, potentiometer |
| Output | LED (PWM brightness), RGB LED, 7-segment display, piezo buzzer (with sound) |
| Passive | Resistor, ceramic and electrolytic capacitors |
| Semiconductors | NPN (2N2222) and PNP (2N2907) transistors (switching model) |
| Power | 9 V battery, AA cells, CR2032 coin cell: select one and use the **−/+ stepper** (or the + / − keys) to put several in series |
| Instruments | Voltmeter |

Examples: blink and button, LED and button on a breadboard, two Unos over serial, servo and potentiometer, encoder motor speed control, Mega driving two encoder motors, RGB LED fade, buzzer melody, 7-segment counter, transistor switch.

## Getting started

You need [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The bundled examples, and the starter sketch of every new board, come with prebuilt firmware, so they run right away. Editing code needs the compiler (below).

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
| Add a part | Click it in the **Components** panel on the right, or drag it onto the canvas. The panel opens on **Basic** parts; switch to **All** or a category, or search |
| Breadboard | Drop parts onto a breadboard: their legs snap into the holes (green rings) and connect automatically. Moving the breadboard moves everything plugged into it |
| Wire | Click a pin (or breadboard hole), click empty space to add bends, click another pin to finish (Esc cancels). Pick the colour from the toolbar swatch |
| Edit | Toolbar buttons or shortcuts: copy **Ctrl/⌘+C**, paste **Ctrl/⌘+V**, duplicate **Ctrl/⌘+D**, delete **Del**, undo **Ctrl/⌘+Z**, redo **Ctrl/⌘+Shift+Z**, rotate **R** |
| Pan and zoom | Drag the background · scroll wheel · **Fit** button |
| Code | **Code** opens the editor: one tab per microcontroller, compiler output and the serial monitor |
| Run | **Start Simulation** (or F5 / Ctrl+Enter) |
| Interact | While running, press buttons, flip slide switches and drag potentiometer knobs |
| Prebuilt firmware | **Load .hex** runs any Intel HEX file on the selected board |
| Files | **File** menu: New, Open, Save, Export, Examples. **Save** writes an `.axion.json` project (circuit + code). **Export diagram** writes a Wokwi-compatible `diagram.json` |

## Project layout

```
src/core/      engine (nets, solver, time), part contract, diagram format
src/mcu/       microcontroller chips and the shared Arduino board model (on avr8js)
src/physics/   shared helpers (motor dynamics, PWM duty, frequency, part drawings)
src/parts/     one folder per part, auto-discovered
src/sim/       Web Worker that runs the engine
src/editor/    the canvas editor (wires, snapping, breadboard connections, undo)
src/ui/        toolbar, components panel, menus, icons
server/        local compile service (calls arduino-cli)
examples/      example circuits with prebuilt .hex
docs/          architecture and how to write parts
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works, and [docs/WRITING_PARTS.md](docs/WRITING_PARTS.md) to add a part.


## License

Axion is licensed under the [Apache License 2.0](LICENSE). Third-party components are listed in [NOTICE](NOTICE). All bundled dependencies are MIT or BSD. arduino-cli (GPL-3.0) is used as a separate program and is not distributed with Axion.
