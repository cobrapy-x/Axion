# Architecture

```
┌──────────────────────── Page (main thread) ────────────────────────┐
│  Palette   Workspace (parts, wires, pan/zoom)   Code + Serial      │
│               │  views animate from state ▲                        │
│               ▼ user input                │ snapshots (~60/s)      │
├──────────────────────── Web Worker ────────────────────────────────┤
│  Engine: nets ⇄ analog solver ⇄ part models ⇄ MCU runtimes         │
│  paced to real time, event-driven; MCU workers on other cores      │
└────────────────────────────────────────────────────────────────────┘
           ▲ firmware (.hex)
┌──────────┴──────── Local compile service (Node) ───────────────────┐
│  /api/compile → arduino-cli (separate process) → cache ~/.axion    │
└────────────────────────────────────────────────────────────────────┘
```

## Folders

| Path | What it is |
|---|---|
| `src/core/types.ts` | The part contract: `PartManifest`, `PartModel`, `PartView` |
| `src/core/engine.ts` | Netlist + time stepping. No DOM, runs in Node for tests |
| `src/core/analog/` | The MNA circuit solver and unit parsing ([SOLVER.md](SOLVER.md)) |
| `src/core/diagram.ts` | `diagram.json` (Wokwi-compatible) + project format, wire routes |
| `src/mcu/` | Chip-independent MCU runtime (`runtime.ts`, `board.ts`, `families.ts`), the AVR family on avr8js (ATmega328P, ATmega2560) and the I²C / SPI bus models |
| `src/physics/` | Shared physics and drawing helpers (DC motor dynamics) |
| `src/parts/<name>/` | One folder per part: `part.json`, `model.ts`, `view.ts` |
| `src/sim/` | Simulation worker, message protocol, main-thread client, multi-core coordinator and MCU workers ([MULTICORE.md](MULTICORE.md)) |
| `src/editor/workspace.ts` | The canvas editor: parts, wires, snapping, undo/redo, clipboard |
| `src/editor/breadboard.ts` | DOM-free geometry: which part pins sit in which breadboard holes |
| `src/ui/` | Toolbar, components panel (live thumbnails), menus, icons |
| `server/compile.ts` | Local compile service used by `npm run dev` / `npm start` |
| `examples/` | Example circuits with prebuilt `.hex` so they run without a compiler |

## The electrical model

Axion keeps a fast digital path and adds a small **analog solver** only where analog parts are (details in [SOLVER.md](SOLVER.md)):

1. Wires, a part's internal connections and closed `switches()` join pins into **nets** (union-find).
2. Each pin applies a drive. A number (power pins, batteries, motor driver outputs) is a **stiff source**: its net is *fixed* at that voltage. `'high'` / `'low'` are the MCU's supply / 0 V behind the pin's ~25 Ω output resistance, `'pullup'` / `'pulldown'` sit behind ~35 kΩ, `'z'` drives nothing. Sources carry their own voltage (`{ volts, ohms }` drives exist for 3.3 V boards).
3. A net with no analog element on it takes the **fast path**: the strong drive wins, else the pulls; two different strong voltages on one net are a **short circuit**. A blinking pin wired to another MCU input never touches a matrix.
4. Parts describe analog behaviour with `elements()`: resistors, capacitors, inductors, voltage sources, diodes / LEDs (with zener), switches, BJTs and MOSFETs. Nets linked by elements form **clusters**, cut at fixed nets, so a typical cluster has 2–10 nodes (an LED + resistor on a pin is 2). Each cluster is solved with **Modified Nodal Analysis**; diodes and transistors are piecewise linear and iterated until consistent. Only clusters whose inputs changed are re-solved.
5. **Time**: capacitors and inductors use backward-Euler companion models. A cluster that holds them is stepped by scheduled events (finely right after a change, coarser as it settles) and **stops stepping once settled**, so an idle RC circuit costs nothing. `ctx.current(id)` reads an element's current (LED brightness, overcurrent warnings).
6. A net with no conductive path to any source is **floating** (`null`): digital inputs read as floating and the voltmeter shows `--`. Logic levels come from voltages through each part's thresholds: for 5 V parts ≥ 3 V is HIGH, ≤ 1.5 V is LOW, in between is undefined. A 3.3 V board (`vcc: 3.3` in its `BoardSpec`) drives 3.3 V and reads HIGH from 1.98 V (`ctx.setLogic`).
7. The engine is **event-driven**: it re-solves only when a part reports a change (`invalidate`) or a capacitor / inductor cluster steps. After each solve, parts whose pin voltage changed by more than 10 mV are notified, and the solve repeats until nothing changes. This lets signals ripple through behavioural parts (MCU pin → L298N input → L298N output → motor) without any part needing a clock.

`analogRead()` samples the pin's latest solved voltage at the moment of the conversion, so a potentiometer loaded by a resistor, a voltage divider or a charging capacitor read realistically.

**Motors** use a first-order model: speed approaches `rpm × V / Vrated` with a time constant (0.12 s while driven, 0.4 s while coasting). Between pin changes the voltage is constant, so the motor is advanced with the exact solution of that equation. PWM averages out naturally, and an idle motor costs nothing.

## Breadboards

Breadboards are **carrier** parts (`"carrier": true` in part.json) with no model; their internal strips are `internal` groups, generated by `scripts/gen-breadboards.mjs`. Pin names and hole positions match Wokwi's breadboards, so Wokwi projects import with the same connections.

When a part is dropped so one of its legs is within a few pixels of a hole, the editor snaps it into place. Before the simulation starts, `Workspace.connectionsForSimulation()` adds an implicit connection for every leg sitting in a hole. Like Wokwi, these are saved in diagram.json with the route `["$bb"]` and are not drawn. The engine prunes nets that contain only model-less pins, so empty breadboard strips cost nothing per solve.

## Time and multiple MCUs

- Each MCU runs on its own clock (`cycles / frequency`). Before reporting a pin change it calls `ctx.advanceTime(ns)`, so other parts (an LED measuring PWM duty, for example) see exact timestamps.
- The engine advances all MCUs in **quanta of 50 µs**, so several boards stay in lock-step. MCUs run first in each quantum, then parts with their own physics (e.g. encoders), so those see MCU pin changes with exact timestamps. A part's `schedule()` ends a quantum early, so that event happens at exactly the right time for every MCU.
- Encoders check their position once per quantum, so edges are accurate to 50 µs. That is plenty for typical gear motors (a few thousand edges per second).
- MCU↔MCU and MCU↔peripheral links use **transaction-level** messages: UART delivers whole bytes (`sendData` / `onData`), and I²C / SPI deliver whole transfers to `I2CDevice` / `SPIDevice` parts (LCD backpack, 74HC595), instead of simulating every bit edge. This is much faster and is what lets many boards run together.
- **MCU runtimes** are chip-independent (`src/mcu/runtime.ts`): a board model (`src/mcu/board.ts`) drives an `McuRuntime` (`AvrRuntime` on avr8js today) through a narrow interface: GPIO events, input levels, `analogRead`, UART bytes, I²C / SPI calls. New families (rp2040js, an out-of-process QEMU bridge for the ESP32) plug in there.
- **Multi-core**: with 2+ MCUs and cross-origin isolation, the MCUs run on several cores. The simulation worker keeps the circuit and every other part and becomes the coordinator. It runs one lane of MCUs itself, and MCU workers run the others, in lock-step over SharedArrayBuffer ring buffers with `Atomics`. Outputs come back as timestamped events applied in time order. Requests that need an answer (I²C, SPI, `analogRead`, read-after-write) block the MCU until the coordinator serves them. Results match the single-threaded engine, and the status line shows the number of cores. Details, measurements and fallbacks: [MULTICORE.md](MULTICORE.md).
- The worker paces simulated time to real time. If the circuit is too heavy it runs slower than real time and the toolbar shows the real speed percentage.

## Why these choices

| Goal | Choice |
|---|---|
| Lightweight | Plain TypeScript + Vite, no UI framework. The production build is under 1 MB (~260 KB gzipped). Tauri (planned) wraps it in a ~10 MB desktop app |
| Offline | Everything runs locally. arduino-cli downloads a board's toolchain once, then compiles offline. Builds are cached by content hash |
| No fragmentation | Wokwi-compatible `diagram.json`, a stable part contract, parts as self-contained folders |
| Don't reinvent | avr8js (CPU), wokwi-elements (visuals), arduino-cli (compiler) |
| Apache-2.0 | Every dependency is MIT/BSD. GPL tools (arduino-cli, later QEMU for ESP32) run as separate processes, never linked in |

## Roadmap

1. ~~Uno + LED + button + resistor, wiring editor, local compile, multi-MCU UART~~ ✅ (v0.1)
2. ~~Analog layer, potentiometer, servo, DC motor, encoder motor, L298N, battery, Arduino Nano and Mega~~ ✅ (v0.2)
3. ~~New UI layout, breadboards, slide switch, capacitors, batteries, RGB LED, buzzer, 7-segment, transistors, voltmeter~~ ✅ (v0.3)
4. ~~More parts: 16×2 LCD (I²C), ultrasonic sensor, photoresistor, relay, diodes, MOSFETs, inductor, keypad, DIP switch, logic gates; voltage dividers and RC / RL timing in the solver~~ ✅ (v0.4)
5. ~~I²C / SPI transaction links between MCUs and peripherals~~ ✅ (v0.4)
6. ~~Multi-core: MCUs on their own cores, chip-independent MCU runtime~~ ✅ (v0.4, [MULTICORE.md](MULTICORE.md))
7. ~~Accuracy pass, part 1: per-board logic thresholds (3.3 V ready), real-compiler check script, `pulseIn` timing confirmed~~ ✅ (v0.4.1)
8. Raspberry Pi Pico (rp2040js, MIT): a new `McuRuntime` family, 3.3 V I/O (v0.5)
9. DC motor as an electrical load (current, back-EMF, flyback)
10. Tauri desktop app (Windows/macOS/Linux installers built by CI); split the bundle so parts load on demand
11. ESP32 via Espressif's QEMU (GPL-2.0, run as a separate process behind an `McuRuntime` bridge)
12. A part registry: install community parts from a Git URL
