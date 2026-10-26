# Changelog

All notable changes to Axion. Versions follow [Semantic Versioning](https://semver.org); before 1.0, any release may change the part contract.

## [0.4.1] - 2026-10-26

### Added

- **Per-board logic levels (3.3 V ready).** Each part now turns voltages into HIGH / LOW with its own input thresholds (`ctx.setLogic`, `cmosLogic(vcc)`). A board sets `vcc` in its `BoardSpec`, and its output-high level, pull-ups, input thresholds and ADC reference follow (3.3 V: HIGH from 1.98 V, LOW below 0.99 V). This prepares for the Raspberry Pi Pico and ESP32.
- `npm run check:examples`: compiles every example and every board's starter sketch with the real arduino-cli and reports the result. `-- --write` also replaces the prebuilt `.hex` files with the new builds.
- `newAttrs` in part.json: attributes for a part freshly added from the components panel.

### Changed

- An LCD 16×2 added from the components panel now starts with the I²C backpack (4 pins), the most common module. Wokwi diagrams keep their meaning: a missing `pins` attribute still means the 16-pin parallel interface.
- **Fit** now includes wire bends, so long wires are no longer cut off.

### Fixed

- `pulseIn()` was listed as "reads 0.7 % short". This is not an emulator bug: with interrupts off, `pulseIn()` is cycle-exact (23 201 µs for a 23 200 µs pulse). The ~0.6 % comes from the `millis()` timer interrupt stealing cycles from the counting loop, which happens the same way on a real Uno. A new test covers both cases.

## [0.4.0] - 2026-10-26

### Added

- **Analog solver** (Modified Nodal Analysis, [docs/SOLVER.md](docs/SOLVER.md)): resistors, capacitors, inductors, voltage sources, diodes (with zener breakdown), switches, BJTs and MOSFETs. Nets are split into small clusters, only changed clusters are re-solved, and purely digital nets keep a fast path.
  - Voltage dividers, loaded potentiometers and `analogRead()` of real node voltages.
  - RC and RL timing with backward-Euler companion models; adaptive time steps that stop once the circuit settles.
  - LEDs: per-colour forward voltage, brightness from current, warning when there is no series resistor.
- **I²C and SPI** at transaction level between MCUs and peripherals (`I2CDevice` / `SPIDevice` in the part API), alongside UART.
- **Multi-core simulation** ([docs/MULTICORE.md](docs/MULTICORE.md)): with 2+ MCUs, microcontrollers run on several cores in 50 µs lock-step over SharedArrayBuffer; results match the single-threaded engine. About 2× faster for two boards on two cores. `?cores=1` forces one thread, and the status line shows the core count.
- **Chip-independent MCU runtime** (`McuRuntime`, `AvrRuntime`, board model, chip families), ready for the Raspberry Pi Pico and ESP32.
- **New parts**
  - Input: 8-way DIP switch, 4×4 membrane keypad, slide potentiometer, trimmer potentiometer
  - Output: 16×2 LCD (HD44780; I²C PCF8574 backpack or parallel 4-bit)
  - Sensors: HC-SR04 ultrasonic sensor, photoresistor (LDR), LDR module
  - Logic: AND, OR, NAND, NOR, XOR, XNOR, NOT gates; 74HC595 shift register
  - Switches and relays: 5 V relay module
  - Passive: inductor, rheostat (variable resistor)
  - Semiconductors: 1N4148, 1N4007, 1N5819 Schottky and zener diodes; TIP120 Darlington; 2N7000, IRLZ44N and P-channel MOSFETs
- **Live sliders**: sensor distance, light level and rheostat value can be changed in the inspector while the simulation runs.
- 17 new examples (27 in total), including voltage divider, RC timing, RL circuit, zener regulator, LDR night light, LCD (I²C), keypad lock, shift registers (`shiftOut` and SPI), logic gates, relay, MOSFET motor and ultrasonic distance.
- `npm run setup` also installs the LiquidCrystal and LiquidCrystal I2C libraries.

### Changed

- Logic levels are derived from solved voltages (≥ 3 V HIGH, ≤ 1.5 V LOW, in between undefined).
- `PartContext` gained `peers()`, `schedule()`, `current()` and `warn()`.

### Fixed

- Resistor colour bands for values such as `4.7k`.
- Parts can be selected (and their inspector opened) while the simulation runs.
- Vitest's module cache hid newly added parts; it is now disabled.

### Known issues

- The DC motor has no electrical model yet, so it draws no current (no flyback in the MOSFET motor example).
- Logic thresholds are fixed for 5 V; 3.3 V boards will need per-MCU input thresholds. *(Fixed in 0.4.1.)*
- `pulseIn()` reads about 0.7 % short. *(Not a bug: real Arduinos do the same; see 0.4.1.)*
- An LCD added from the panel defaults to the parallel interface; switch it to I²C in the inspector. *(Fixed in 0.4.1.)*
- The P-channel MOSFET is a generic model.
- MCUs are grouped onto `min(MCUs, cores)` threads, not strictly one worker per MCU.
- **Fit** ignores wire bends *(fixed in 0.4.1)*; the main bundle is over 500 KB (Vite prints a warning).

## [0.3.0] - 2026-10-25

### Added

- Tinkercad-style layout: toolbar, components panel with live thumbnails, Code panel, floating inspector.
- Breadboards (full, half, mini) with Wokwi pin names; parts snap into holes and connect automatically (`["$bb"]` routes).
- Slide switch, ceramic and electrolytic capacitors, RGB LED, piezo buzzer with sound, 7-segment display, NPN and PNP transistors, voltmeter.
- Batteries: 9 V, AA and CR2032, with a −/+ stepper to put several cells in series.
- Undo/redo, copy/paste, duplicate, rotate.
- Prebuilt starter firmware for every board, so new circuits run without a compiler.

## [0.2.0] - 2026-10-24

### Added

- Analog layer (first version), potentiometer, servo (SG90), DC motor, DC motor with encoder, L298N driver, battery.
- Arduino Nano and Arduino Mega 2560.

## [0.1.0] - 2026-10-24

### Added

- First release: Arduino Uno on avr8js, LED, pushbutton, resistor.
- Wiring editor, Wokwi-compatible `diagram.json`.
- Local compile service with arduino-cli and a build cache.
- Several boards in lock-step, talking over UART.
