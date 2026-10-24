# Architecture

```
┌──────────────────────── Page (main thread) ────────────────────────┐
│  Palette   Workspace (parts, wires, pan/zoom)   Code + Serial      │
│               │  views animate from state ▲                        │
│               ▼ user input                │ snapshots (~60/s)      │
├──────────────────────── Web Worker ────────────────────────────────┤
│  Engine: nets ⇄ part models ⇄ MCU emulators (avr8js)               │
│  paced to real time, event-driven circuit solving                  │
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
| `src/core/engine.ts` | Netlist + solver + time stepping. No DOM, runs in Node for tests |
| `src/core/diagram.ts` | `diagram.json` (Wokwi-compatible) + project format, wire routes |
| `src/mcu/` | CPU wrappers (`avr.ts` = ATmega328P on avr8js) |
| `src/parts/<name>/` | One folder per part: `part.json`, `model.ts`, `view.ts` |
| `src/sim/` | Worker entry + message protocol + main-thread client |
| `src/editor/workspace.ts` | The canvas editor |
| `server/compile.ts` | Local compile service used by `npm run dev` / `npm start` |
| `examples/` | Example circuits with prebuilt `.hex` so they run without a compiler |

## The electrical model

Axion uses a **digital model with drive strengths**, which is fast and good enough for most microcontroller circuits:

1. Wires, a part's internal connections and closed switches join pins into **nets** (union-find).
2. Each pin drives `high`, `low`, `pullup`, `pulldown` or `z`. On a net, strong beats weak; a strong HIGH together with a strong LOW is reported as a **short circuit**.
3. Resistors join nets *weakly*: a net with no strong driver takes its level from a strongly driven neighbour through a resistor, and that beats an MCU's internal pull-up.
4. The engine is **event-driven**: it re-solves only when a part reports a change (`invalidate`), and only notifies parts whose pin levels changed.

Planned next: an analog layer (voltages, currents) that parts can opt into. A potentiometer feeding `analogRead()`, an LED that burns out without a resistor and a motor's back-EMF all need it. Parts that only need logic levels will keep using the fast digital path.

## Time and multiple MCUs

- Each MCU runs on its own clock (`cycles / frequency`). Before reporting a pin change it calls `ctx.advanceTime(ns)`, so other parts (an LED measuring PWM duty, for example) see exact timestamps.
- The engine advances all MCUs in **quanta of 50 µs**, so several boards stay in lock-step.
- MCU↔MCU links (UART today) use **transaction-level** messages (`sendData` / `onData`): a whole byte is delivered instead of simulating every bit edge. This is much faster and is what lets many boards run together.
- The worker paces simulated time to real time. If the circuit is too heavy it runs slower than real time and the toolbar shows the real speed percentage.

**Scaling plan:** today all parts share one worker thread. The next step is one worker per MCU with a shared quantum barrier (the approach Renode uses), so a circuit with N boards uses N CPU cores.

## Why these choices

| Goal | Choice |
|---|---|
| Lightweight | Plain TypeScript + Vite, no UI framework. The production build is ~170 KB (~50 KB gzipped). Tauri (planned) wraps it in a ~10 MB desktop app |
| Offline | Everything runs locally. arduino-cli downloads a board's toolchain once, then compiles offline. Builds are cached by content hash |
| No fragmentation | Wokwi-compatible `diagram.json`, a stable part contract, parts as self-contained folders |
| Don't reinvent | avr8js (CPU), wokwi-elements (visuals), arduino-cli (compiler) |
| Apache-2.0 | Every dependency is MIT/BSD. GPL tools (arduino-cli, later QEMU for ESP32) run as separate processes, never linked in |

## Roadmap

1. ~~Uno + LED + button + resistor, wiring editor, local compile, multi-MCU UART~~ ✅
2. More parts: potentiometer + analog layer, DC motor, motor with quadrature encoder, servo, buzzer, 16×2 LCD (I2C), 7-segment
3. I2C/SPI transaction links between MCUs and peripherals
4. One worker per MCU, multi-core
5. Raspberry Pi Pico (rp2040js, MIT)
6. Tauri desktop app (Windows/macOS/Linux installers built by CI)
7. ESP32 via Espressif's QEMU (GPL-2.0, run as a separate process)
8. A part registry: install community parts from a Git URL
