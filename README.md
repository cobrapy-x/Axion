# Axion

**A lightweight, offline, open-source simulator for circuits and microcontrollers.**

Wire up Arduinos, a Raspberry Pi Pico, LEDs, motors, sensors and more, write your code in Arduino C++ or MicroPython, and run it on your own computer. You don't need an internet connection, don't wait in a compile queue, and don't need an account.

- **Desktop app or browser.** Install Axion for Windows, macOS or Linux (about 3 MB), or run it from source in your browser.
- **Offline and fast.** Sketches compile locally with arduino-cli, and builds are cached, so re-running an unchanged sketch is instant. MicroPython needs no compiler at all.
- **Lightweight.** About 1 MB of JavaScript (300 KB gzipped); example firmware and MicroPython load only when used. The simulation runs in background threads so the UI stays smooth.
- **Real circuits, not just logic.** An analog solver handles voltage dividers, RC and RL timing, diodes, zeners, transistors, MOSFETs and motors (which draw real current and need flyback diodes), and warns about missing resistors and short circuits ([how it works](docs/SOLVER.md)).
- **Multiple microcontrollers, multiple cores.** Several boards run together in lock-step and talk over UART, I²C and SPI. With two or more boards, each group of MCUs runs on its own CPU core ([details](docs/MULTICORE.md)).
- **Modular parts.** Each part is one folder: `part.json` + `model.ts` (behaviour) + `view.ts` (animation). Drop a folder in and it appears in the palette.
- **No lock-in.** Axion reads and writes Wokwi-compatible `diagram.json` files.

> Status: early (v0.5). See the [changelog](CHANGELOG.md) and the [roadmap](docs/ARCHITECTURE.md#roadmap).

## Parts

| Category | Parts |
|---|---|
| Prototyping | Breadboard (full 830, half 400, mini 170): parts plugged in connect automatically |
| Microcontrollers | Arduino Uno, Arduino Nano, Arduino Mega 2560 (avr8js); Raspberry Pi Pico in Arduino C++ or MicroPython (rp2040js, 3.3 V) |
| Actuators | DC motor and DC motor with quadrature encoder (electrical model: stall current, back-EMF, inductance), L298N motor driver, servo (SG90) |
| Input | Pushbutton, slide switch, 8-way DIP switch, 4×4 membrane keypad, potentiometer, slide potentiometer, trimmer potentiometer |
| Output | LED (PWM brightness), RGB LED, 7-segment display, 16×2 LCD (I²C backpack or parallel 4-bit), piezo buzzer (with sound) |
| Sensors | HC-SR04 ultrasonic distance sensor, photoresistor (LDR) and LDR module: distance and light level are live sliders |
| Logic | AND, OR, NAND, NOR, XOR, XNOR and NOT gates, 74HC595 shift register |
| Switches and relays | 5 V relay module |
| Passive | Resistor, ceramic and electrolytic capacitors, inductor, rheostat (variable resistor) |
| Semiconductors | Diodes (1N4148, 1N4007, 1N5819 Schottky, zener), NPN (2N2222), PNP (2N2907) and Darlington (TIP120) transistors, MOSFETs (2N7000, IRLZ44N, P-channel) |
| Power | 9 V battery, AA cells, CR2032 coin cell: select one and use the **−/+ stepper** (or the + / − keys) to put several in series |
| Instruments | Voltmeter |

30 examples (**File → Examples**), all of which run without a compiler:

- **Basics:** blink and button, LED on a breadboard, RGB LED fade, buzzer melody, 7-segment counter, DIP switch binary readout, trimpot LED dimmer
- **Analog:** voltage divider, RC charging, RL circuit, zener regulator, light-activated night light (LDR)
- **Transistors and power:** transistor switch, MOSFET motor driver, relay blink
- **Buses:** LCD hello (I²C), LCD potentiometer meter, Mega with an I²C LCD, keypad door lock, shift register LEDs (`shiftOut` and hardware SPI), logic gates
- **Motors and sensors:** servo and potentiometer, encoder motor speed control, Mega driving two encoder motors, ultrasonic distance meter
- **Multiple boards:** two Unos over serial
- **Raspberry Pi Pico:** button and LED (Arduino C++), I²C LCD (Arduino C++), LED dimmer (MicroPython)

## Getting started

### Desktop app

Download the installer for your system from the [Releases](https://github.com/cobrapy-x/Axion/releases) page (`.dmg` for macOS, `.msi` / `.exe` for Windows, `.AppImage` / `.deb` for Linux). The installers are not code-signed yet: on macOS, open the app once from **System Settings › Privacy & Security**; on Windows, choose **More info › Run anyway**.

To compile your own Arduino code, install **arduino-cli** (table below), then click the **Compiler** badge at the bottom of the window to download the Arduino cores once. Examples, starter sketches and MicroPython work without it.

### From source (browser)

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
npm run setup   # downloads the Arduino AVR and Raspberry Pi Pico cores, Servo and LCD libraries once; offline after that
```

The toolbar shows **Compiler: ready** when everything is in place. (`npm run setup -- --no-pico` skips the ~300 MB Pico core.)

Other commands:

- `npm start`: optimized build, served locally with the compiler
- `npm test`: engine and firmware tests (runs in Node, no browser needed)
- `npm run check:examples`: compiles every example with your arduino-cli, to check your setup (add `-- --write` to refresh the prebuilt `.hex` files)
- `npm run desktop`: the desktop app in development mode; `npm run desktop:build` builds an installer for your system (needs [Rust](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/))

## Using the editor

| Action | How |
|---|---|
| Add a part | Click it in the **Components** panel on the right, or drag it onto the canvas. The panel opens on **Basic** parts; switch to **All** or a category, or search |
| Breadboard | Drop parts onto a breadboard: their legs snap into the holes (green rings) and connect automatically. Moving the breadboard moves everything plugged into it |
| Wire | Click a pin (or breadboard hole), click empty space to add bends, click another pin to finish (Esc cancels). Pick the colour from the toolbar swatch |
| Edit | Toolbar buttons or shortcuts: copy **Ctrl/⌘+C**, paste **Ctrl/⌘+V**, duplicate **Ctrl/⌘+D**, delete **Del**, undo **Ctrl/⌘+Z**, redo **Ctrl/⌘+Shift+Z**, rotate **R** |
| Pan and zoom | Drag the background · scroll wheel · **Fit** button |
| Code | **Code** opens the editor: one tab per microcontroller, compiler output and the serial monitor. For a Pico, choose **Code: arduino** or **micropython** in its inspector; MicroPython code is `main.py` and the serial monitor becomes its REPL once the program ends |
| Run | **Start Simulation** (or F5 / Ctrl+Enter) |
| Interact | While running, press buttons and keypad keys, flip slide and DIP switches, and drag potentiometer knobs. Select a sensor, LDR or rheostat to move its slider in the inspector live |
| Prebuilt firmware | **Load .hex** runs any Intel HEX file on the selected board (a `.uf2` or `.bin` on the Pico) |
| Files | **File** menu: New, Open, Save, Export, Examples. **Save** writes an `.axion.json` project (circuit + code). **Export diagram** writes a Wokwi-compatible `diagram.json` |

## Project layout

```
src/core/      engine (nets, time), part contract, diagram format
src/core/analog/  the MNA circuit solver (R, C, L, diodes, BJTs, MOSFETs)
src/mcu/       chip-independent MCU runtime: AVR (avr8js) and RP2040 (rp2040js) families, board model, I²C/SPI buses, MicroPython runner
src/physics/   shared helpers (electrical motor model, PWM duty, frequency, part drawings)
src/parts/     one folder per part, auto-discovered
src/sim/       simulation worker, multi-core coordinator and MCU workers
src/editor/    the canvas editor (wires, snapping, breadboard connections, undo)
src/ui/        toolbar, components panel, menus, icons
server/        local compile service for the browser version (calls arduino-cli)
src-tauri/     the desktop app (Tauri 2, Rust): compile service, native Save dialog
public/        the MicroPython firmware for the Pico (loaded on demand)
examples/      example circuits with prebuilt .hex
docs/          architecture, solver, multi-core, how to write parts
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works, [docs/SOLVER.md](docs/SOLVER.md) and [docs/MULTICORE.md](docs/MULTICORE.md) for the details, and [docs/WRITING_PARTS.md](docs/WRITING_PARTS.md) to add a part.

## License

Axion is licensed under the [Apache License 2.0](LICENSE). Third-party components are listed in [NOTICE](NOTICE). Bundled code is MIT, BSD or Apache-2.0 (plus a few unmodified MPL-2.0 Rust crates in the desktop app). arduino-cli (GPL-3.0) is used as a separate program and is not distributed with Axion. The prebuilt example firmware contains the Arduino AVR and arduino-pico cores and libraries (LGPL-2.1); the MicroPython firmware is MIT.
