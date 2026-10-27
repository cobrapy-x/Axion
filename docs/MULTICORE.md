# Multi-core simulation

CPU emulation is most of the cost of a simulation: an emulated 16 MHz AVR runs at roughly
1.5× real time on one core, and the circuit solver needs much less. So a circuit with several
boards runs its microcontrollers **on several cores**. The circuit and every other part stay in
one place, and the MCUs advance in **conservative lock-step**, using the same 50 µs quanta as
the single-threaded engine.

Code: `src/mcu/runtime.ts` (the chip-independent runtime interface), `src/mcu/board.ts` (the
board model on top of it), `src/sim/mc-*.ts` (coordinator, MCU executor, shared-memory channel,
worker loop) and `src/sim/worker.ts` (when to use it). Tests: `tests/multicore.test.ts`.

## When it is used

| Condition | Result |
|---|---|
| 2+ MCU parts with firmware, `crossOriginIsolated`, `navigator.hardwareConcurrency` ≥ 2 | multi-core; the status line shows e.g. `100% speed · 2 cores` |
| 1 MCU, 1 core, not cross-origin isolated, no `Worker` / `Atomics.wait` in workers | single-threaded, as before (`· 1 core`) |
| an MCU worker fails to load, or does not start within 5 s | single-threaded (a warning goes to the console) |
| `?cores=N` in the page URL | at most N cores (`?cores=1` forces single-threaded: handy for A/B tests) |

Cross-origin isolation needs two response headers, which `vite.config.ts` sets on the dev and
preview servers: `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. Axion loads nothing from other origins (icons are
inline SVG, the favicon is a `data:` URI, fonts are system fonts), so `require-corp` costs nothing.
Any other host (a static server) must send the same headers, or Axion runs on one core; hover
the status line to see why. The desktop app serves its pages from `http://127.0.0.1:47819`
(tauri-plugin-localhost) with these headers, because webviews do not isolate the default
`tauri://` scheme. On Linux, WebKitGTK still does not provide `SharedArrayBuffer`, so the Linux
desktop app runs on one core; macOS (WebKit) and Windows (WebView2) use all cores.

## Architecture

```
┌──────────── Page (main thread) ────────────┐
│  UI, views, serial monitor                 │  snapshots / serial / state: unchanged
└──────────────────▲─────────────────────────┘
                   │ postMessage (~60/s)
┌──────────────────┴── Simulation worker = coordinator ─────────────────┐
│  Engine: nets, solver, every non-MCU part, timers                     │
│  MCU boards (board.ts) with RemoteRuntime stand-ins                   │
│  lane 0: runs some MCUs inline, polls the other lanes between chunks  │
└───────▲───────────────────────────────────────▲───────────────────────┘
        │ SharedArrayBuffer + Atomics           │
┌───────┴── MCU worker (lane 1) ──┐   ┌─────────┴── MCU worker (lane 2) …
│  McuExecutor → AvrRuntime       │   │  McuExecutor → AvrRuntime
└─────────────────────────────────┘   └──────────────────────────────
```

### The runtime seam

A board model (`src/mcu/board.ts`) knows pins, nets and parts; a runtime knows registers and
instructions. Everything that crosses between them goes through two small interfaces in
`src/mcu/runtime.ts`:

- **`McuRuntime`** (driven by the board): `runUntil(ns)`, `setInput(pin, level)`, `drive(pin)`,
  `uartReceive(port, byte)`, `timeNs`.
- **`McuHost`** (called by the runtime, always with the MCU's own clock): `outputs(t, pins)` when
  pin drives change, `uartTx` / `uartRx`, `analogRead(channel, t)` → volts, `i2c` / `spi`
  controllers (served by `buses.ts`), and the optional `syncInputs()` (see below).

A runtime is built from an **`McuDescriptor`** (`{ family, pins, config }`, plain data that can be
posted to a worker) by the registry in `src/mcu/families.ts`. `avrBoard()` turns an Arduino part's
pin map into a descriptor for `AvrRuntime` plus a `BoardSpec` for the board model. The part contract
is unchanged: `src/parts/arduino-*/model.ts` still `export default avrBoard({...})`.

When the engine has an `McuOffload` (the coordinator), `ctx.attachMcu(descriptor, host)` returns a
**RemoteRuntime**: it mirrors the remote MCU's pin drives (so `drive()`, `state()` and LED13 work
as before), records input levels and UART bytes, and its `runUntil` does nothing. Otherwise the
board builds the runtime in-process, exactly as before the refactor.

### Lanes: where MCUs run

The coordinator runs **lane 0 itself** and starts one worker per other lane:
`lanes = min(MCUs, cores)`, and MCUs are dealt round-robin, worker lanes first. So with 2 boards on
2 cores, one MCU runs in the coordinator's thread and one in a worker. With 4 boards on 2 cores,
each lane runs two MCUs one after another. Lane 0 also carries the circuit, so it gets the fewest
MCUs.

Why not literally one worker per MCU, with the coordinator only serving? Each quantum is ~35 µs of
CPU work per MCU. Waking a thread that sleeps in `Atomics.wait` costs about the same (37 µs
measured, see below). So every thread must busy-wait briefly instead of sleeping, and that only
works with no more busy threads than cores. One worker per MCU plus a serving coordinator is
N + 1 busy threads. On the 2-core test machine that layout runs **slower than single-threaded**
(0.65–0.98×). It is still available (`inline: false`, `threads: N`) and makes sense with many spare
cores.

## Synchronisation protocol (per quantum)

The engine's `stepTo()` computes each quantum as before, `[start, next]` with
`next = min(target, start + 50 µs, next scheduled timer)`. Then it calls
`offload.runQuantum(start, next)` before stepping the other parts:

1. **Begin.** For each MCU, the coordinator writes the input levels its RemoteRuntime recorded
   and any pending UART bytes into the MCU's channel, sets the target time and bumps `GO`
   (with `Atomics.notify`).
2. **Run.** All lanes run their MCUs to `next` in parallel. Output changes do not touch the
   circuit. They go into the MCU's **ring buffer** as timestamped events: `PIN(pin, drive)`,
   `TX(byte)`, `RX(byte)`.
3. **Requests.** A call that needs an answer now blocks the MCU: it writes the request into
   its channel, bumps `REQ`, rings the coordinator's doorbell and waits for `REP`. The calls
   are `analogRead` voltage, I²C start / address / write / read / stop, SPI byte, and
   *read-after-write* sync. The coordinator serves the request while it waits for the barrier.
   It first **applies that MCU's own queued events** (so a pin it just set is seen by the device
   or the ADC), then answers, then passes back any input changes those events caused. The inline
   lane polls the doorbell every 5 µs of simulated time, between chunks of its own MCUs.
4. **Barrier.** When every MCU reports `DONE`, the coordinator applies the remaining events of all
   MCUs **in time order** (ties: board order). Pin changes with one timestamp become one solve.
   Each event goes through the board's host with its exact time (`ctx.advanceTime`), just as an
   in-process MCU reports it. Then other parts step (encoders) and timers run, as before.

Shared memory per MCU (`mc-channel.ts`): an Int32 header (sequence numbers, request fields, ring
indices), a few Float64 slots, a 4096-event single-producer / single-consumer ring, the input
level vector and a UART byte area. The coordinator drains rings while it waits, so a full ring
(which makes the MCU ask for a flush) is rare. The in-process and inline paths use the same
layout over a plain `ArrayBuffer`, so tests exercise the same encode / decode code.

Waiting is **spin, then sleep**: a thread polls the word it waits on for ~20 000 iterations
(tens of µs), then falls back to `Atomics.wait`. Measured on the 2-core sandbox (Node 22): an
Atomics ping-pong round trip takes 37.6 µs when the other thread sleeps, 0.9 µs with a
1 000-iteration spin.

### Start-up

Browsers deliver `postMessage` to a nested worker **through its parent's event loop**, so the
coordinator must never block before every worker has its MCUs. The start is therefore
asynchronous. `McuCoordinator.start()` spawns the workers and waits for `loaded`. `engine.load()`
attaches the MCUs, which posts `add` messages with the descriptor, firmware and channel.
`await co.ready()` posts `run` and polls (with `setTimeout`) until every worker has built its
runtime. Only then does the first quantum run. If `ready()` fails (an MCU cannot be built), the
worker reloads the circuit single-threaded, so a corrupt firmware shows the usual error.

## Accuracy and determinism

- **Same quantum, same latency.** Input changes caused by other parts or other MCUs reach an MCU
  at the next quantum boundary (≤ 50 µs). This is the latency the single-threaded loop already
  had for everything that runs after the MCUs (encoders, other boards' outputs, UI input).
- **An MCU's own outputs feed back immediately.** On a PIN register read, if the MCU changed an
  output since its last exchange, it does a *read-after-write* sync: its events are applied and
  the resulting input levels come back before the read completes. So keypad scanning (drive a
  row, read the columns 10 µs later), loopback wires and logic gates in a feedback path behave
  exactly as in-process. The sync costs one round trip and only happens after outputs changed.
- **`schedule()`** still splits quanta exactly, for every MCU: the ultrasonic echo is measured to
  the same centimetre.
- **UART between MCUs** stays transaction-level: a byte sent in quantum *q* is delivered at the
  start of *q + 1*. That is ≤ 50 µs later on a 1 ms (9600 baud) byte.
- **Deterministic.** Results do not depend on thread timing. Events are applied in a fixed order,
  and an MCU only learns about other MCUs' changes at quantum boundaries. The one exception is two
  MCUs coupled within a quantum, both making requests: say board A drives a pin that board B reads
  through a read-after-write sync in the same 50 µs. B may or may not see A's change, depending
  on which request was served first. Real hardware has the same race.

`tests/multicore.test.ts` runs the multi-MCU examples single-threaded, with the in-process
transport and on real `worker_threads`. It asserts identical serial output and part states (within
2%) and checks that two threaded runs are identical. The circuits:

- `two-unos-serial`
- a 4-board circuit: UART pair + HC-SR04 + keypad lock
- a 3-board bus circuit: I²C LCD + encoder motor with `analogRead` + servo

Node cannot load the TypeScript worker directly, so the test bundles `src/sim/mcu-thread-node.ts`
with Vite first (≈0.5 s).

## Performance

The 2-core sandbox, Node 22, `worker_threads` (`tests/multicore.test.ts`, best of a few runs, with
another agent's tests running alongside):

| Circuit | Single-threaded | Multi-core (2 cores) | One worker per MCU |
|---|---|---|---|
| two-unos-serial, 2 s | 2355 ms | 1321 ms (**1.78×**) | 3598 ms (0.65×) |
| 3 boards: I²C LCD, encoder + ADC, servo, 2.4 s | 5840 ms | 2434 ms (**2.40×**) | 5952 ms (0.98×) |
| 4 boards: UART pair, sonar, keypad, 3.1 s | 8976 ms | 5135 ms (**1.75×**) | 10928 ms (0.82×) |

The bus circuit gains more than 2×: a worker that runs only AVR code keeps monomorphic, well-JITed
code and its own heap. Single-MCU circuits never use this path; their speed is unchanged (A/B
against the pre-change tree: within ±3%).

In Chrome (headless, same machine) `two-unos-serial` runs at 100% real-time speed on 2 cores, with
~35% of the coordinator's time spent running its own MCU and ~12% waiting at the barrier.

## Adding an MCU family

1. Implement `McuRuntime` for the chip. Call `host.outputs(t, pins)` when pin drives change,
   `host.uartTx` for transmitted bytes, `host.analogRead` for conversions and `host.i2c` /
   `host.spi` for bus transfers. If the runtime can intercept GPIO input reads cheaply, call
   `host.syncInputs?.()` before them.
2. Register it in `src/mcu/families.ts`: `registerFamily('rp2040', (config, firmware, host) => …)`.
   The config must be structured-cloneable, because it is posted to the MCU worker.
3. Write the board: a `BoardSpec` (pin names, analog channels, power pins, UART / I²C / SPI pins,
   and `vcc: 3.3` for 3.3 V boards, which sets the output drives and input thresholds; `logic`
   overrides the thresholds with datasheet values) plus a
   descriptor, through `mcuBoard(spec, descriptor)`. The board then works single-threaded and
   multi-core with no further code.

**Raspberry Pi Pico (rp2040js, MIT)**, done in v0.5 (`src/mcu/rp2040-runtime.ts`). A JS emulator,
so it runs in a worker like the AVR. GPIO listeners mark the pins dirty and drives are
recomputed from each pin's function select and pulls; UART0/1 are ports 0/1 and the USB serial
(CDC, the runtime plays the USB host) is port 2; I²C0 / SPI0 complete each step synchronously
through `host.i2c` / `host.spi`; ADC channels 0–3 call `host.analogRead`; SIO `GPIO_IN` reads
call `host.syncInputs`. `runUntil(ns)` executes instructions at `clk_sys` and skips ahead to the
next timer alarm while the core sleeps (WFI/WFE), so an idle Pico costs little. The board sets
`vcc: 3.3`, `logic: { vih: 2, vil: 0.8 }` and `console: 2`. rp2040js emulates core 0 only.
UART input bytes cross to workers with their port number (`rx` holds `(port << 8) | byte`).

**ESP32 via Espressif's QEMU (GPL-2.0, separate process).** The runtime becomes a thin bridge to a
native QEMU process. It must never be linked into Axion. In the Tauri app a sidecar starts QEMU,
and the runtime talks to it over a local socket. `runUntil(ns)` sends "run until ns" (QEMU with
`-icount` gives a deterministic virtual clock) and receives timestamped GPIO / UART events, which
map one-to-one onto the ring events above. Synchronous requests (ADC, I²C reads) are answered
inside QEMU's I/O callbacks while the bridge waits. The lock-step protocol is the same as for a
worker, only one process boundary further. A browser cannot spawn processes, so the ESP32 needs
the desktop app or a local helper service (like the compile service). Expect a larger quantum
there: IPC round trips cost more than `Atomics`.

## Limitations and next steps

- **Request round trips.** I²C, SPI, `analogRead` and read-after-write syncs cost ~1–5 µs of real
  time each in a worker lane. A sketch that bit-bangs a protocol (write a pin, read a pin, in a
  tight loop) makes one round trip per iteration and runs slower in a worker. An AVR conversion
  (104 µs) and an I²C byte at 100 kHz (90 µs) last longer than a quantum. So these could become
  asynchronous: post the request as a ring event and read the result at the next boundary,
  before the peripheral completes. They are synchronous today, which is simpler and always
  correct.
- **Self-triggered interrupts** (an output wired to the same MCU's interrupt pin, no PIN read in
  between) fire at the next quantum boundary instead of immediately.
- **Spinning** keeps up to `lanes` cores busy while the simulation runs ahead of real time between
  slices (after ~20 000 iterations a thread sleeps).
- **Hosting.** Multi-core needs cross-origin isolation (headers above) and nested workers (all
  current engines). Without them Axion runs single-threaded.
