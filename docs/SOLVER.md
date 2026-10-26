# The analog solver

Axion simulates microcontroller circuits, so most signals are digital and most nets carry no
analog element at all. The solver keeps those on a fast path and runs a small
**Modified Nodal Analysis (MNA)** only where resistors, capacitors, diodes and transistors are.

Code: `src/core/engine.ts` (nets, drives, clusters, time stepping) and `src/core/analog/`
(`solver.ts`: elements and the cluster solve, `constants.ts`: every number below,
`units.ts`: "4.7k" / "100nF" parsing).

## From pins to clusters

1. **Nets.** Wires, `internal` pin groups and closed `switches()` join pins into nets (union-find),
   exactly as before. Nets made only of model-less pins (empty breadboard strips) are pruned.
2. **Drives become sources.** Every `drive(pin)` is read on every solve:

   | Drive | Model |
   |---|---|
   | number (power pins, batteries, L298N outputs) | **stiff** source: the net is *fixed* at that voltage |
   | `'high'` / `'low'` | VCC (5 V) / 0 V behind 25 Ω (AVR: VOH ≈ 4.5 V at 20 mA) |
   | `'pullup'` / `'pulldown'` | VCC / 0 V behind 35 kΩ (AVR datasheet: 20–50 kΩ) |
   | `{ volts, ohms }` | `volts` behind `ohms` (0 or omitted = stiff); < 1 kΩ counts as strong |
   | `'z'` | nothing |

   Non-stiff drives are Norton sources (conductance + current) on their net.
3. **Fast path.** A net that no analog element touches is solved as before: a strong drive
   wins, otherwise the pulls (Thevenin average); two strong drives that disagree by more
   than 0.05 V are a short circuit (`null` + "Short circuit: different voltages driven together…").
4. **Clusters.** Nets linked by elements are grouped by a union-find over the elements, *cut at
   fixed nets*: GND, 5V and battery terminals are known voltages on the edge of a cluster, not
   unknowns. So all the LEDs going to GND are not one big system: an LED + resistor on a pin is
   a 2-node cluster, a potentiometer on 5V/GND a 1-node one. An element whose terminals are all
   fixed forms a cluster with no unknowns (its current is still computed).
5. **Dirty tracking.** On every solve the engine polls drives and `elements()` and compares
   them with the stored values. Only clusters whose inputs changed (a Norton source, a fixed
   neighbour's voltage, an element value) are re-solved. Changes of structure (a net becoming
   fixed, a part returning a different set of elements) rebuild the clusters.

## Elements

Pin names are the part's own pins. `ctx.current(id)` returns the current of the element with
that `id`, in amps, as of the last solve (0 if not conducting).

| Kind | Fields | Model | Current sign |
|---|---|---|---|
| `R` | `a b ohms` | conductance | a → b |
| `C` | `a b farads` | backward-Euler companion (`C/h` ∥ source); starts uncharged | a → b (charging current) |
| `L` | `a b henries` | backward-Euler companion (`h/L` ∥ source); starts at 0 A | a → b |
| `V` | `p n volts ohms?` | ideal source (extra MNA row) or Thevenin if `ohms > 0` | p → through the source → n (negative while delivering power) |
| `D` | `anode cathode vf ohms? zener?` | off / on (`vf` + `ohms`, default 1 Ω) / reverse breakdown at `zener` | anode → cathode (negative in breakdown) |
| `SW` | `a b closed ohms?` | `ohms` (default 0.05 Ω) when closed, open otherwise | a → b |
| `BJT` | `type b c e beta?` | cutoff / active (IC = β·IB, VBE = 0.65 V + 10 Ω) / saturation (VCE = 0.2 V + 1 Ω); β default 100 | into the collector (negative for a conducting PNP) |
| `FET` | `type g d s vth rdsOn?` | switch: `rdsOn` (default 0.1 Ω) when VGS (n) / VSG (p) > `vth`, open otherwise; the gate draws no current | drain → source |

**Nonlinear elements** are piecewise linear. A solve starts from the previous states (so an
unchanged circuit converges in one pass), solves, checks every diode / transistor against its
own conditions (on: current ≥ 0; off: voltage below the knee; saturation: IC ≤ β·IB …), flips
the inconsistent ones and solves again. After 6 rounds only the most violated element flips per
round, which stops flip-flopping; the cap is 40 rounds.

"Off" elements and open switches keep a 1 nS leakage so every matrix stays regular.

## Floating nets

A node with no conductive path to a source reads `null`, so digital inputs read as floating and
the voltmeter shows `--`. Two passes decide it:

- before the solve, nodes that no element at all (leakage included) connects to a fixed net or a
  drive are left out of the matrix;
- after the solve, a node is reported only if it is connected to a source through elements that
  actually conduct: resistors, inductors, sources, closed switches, capacitors, diodes and
  transistor junctions carrying more than 50 nA (more than leakage). A cathode hanging on a
  transistor that is off is therefore `null`, as is the far side of a reversed LED.

A capacitor connects for this purpose (it holds its charge: a capacitor on a pin switched to
`INPUT` keeps its voltage and `analogRead()` sees it), except to a net made only of capacitor
terminals (the free leg of an otherwise unconnected capacitor stays `null`).

## Time: capacitors and inductors

A cluster with C or L is a **reactive cluster** with its own state (capacitor voltages, inductor
currents) at time `t`.

- **When an input changes** at time `now`, the cluster is first integrated from `t` to `now`
  under the *old* inputs, then solved with the new inputs using a 1 ns step: capacitor voltages
  and inductor currents cannot jump.
- **Stepping.** It then schedules itself with `schedule()` (so microcontrollers are advanced to
  exactly that moment). Each tick integrates to the tick time with adaptive internal steps
  (backward Euler, local truncation error ≤ 1 mV / 10 µA + 0.1 %, steps between 1 µs and 0.25 s,
  rejected and halved when the error is too large). The next tick comes after a node voltage has
  moved ≈ 5 mV (one ADC step at 5 V), between 10 µs and 0.25 s.
- **Settling.** From the decay of each capacitor's dV/dt (or inductor's dI/dt) between ticks the
  solver estimates the remaining change (rate × time constant). When it is below 0.2 mV (1 µA)
  everywhere the cluster stops scheduling ticks: **a settled RC circuit costs nothing** until
  one of its inputs changes again.

Accuracy: RC and RL curves are within ~1 % of `1 − e^(−t/τ)` for τ ≥ 1 ms (the RC timing example
measures 999–1003 ms for 10 kΩ × 100 µF plus the pin's 25 Ω). Faster time constants are stable
but coarse below ~50 µs, the engine's quantum. Parts are notified when their pin voltage changes
by more than 10 mV; `ctx.voltage()` always returns the latest solved value.

## Shorts

- Two strong drives that disagree on one net: short (as before), the net reads `null`.
- An element other than a capacitor carrying more than 1 A: "Short circuit: 9.0 A through r1 (1–2)".
- Ideal voltage sources fighting (a loop of ideal sources or one across two fixed nets with a
  different voltage): "Short circuit: voltage sources fighting through …".

Because stiff sources are fixed nets rather than huge conductances, a short never makes a matrix
ill-conditioned.

## LEDs

LEDs (`src/physics/lamp.ts`) are `D` elements with `vf` by colour (red 1.8 V, orange / yellow
2.0 V, green 2.1 V, blue / white / purple 3.0 V) and 5 Ω series resistance: 220 Ω on 5 V gives
≈ 14 mA and ≈ 1.87 V across a red LED. Brightness is proportional to the current, full at 20 mA,
and averaged per frame so PWM and multiplexing dim it. Above 30 mA the part warns once:
"LED led1 has no current-limiting resistor (107 mA)". The RGB LED and the 7-segment display use
the same rules per channel / segment.

## Performance

- Matrices are dense, preallocated per cluster and reused (no allocation per solve); clusters
  are tiny, so dense Gaussian elimination with partial pivoting beats a sparse solver.
- Only dirty clusters are solved; fast-path nets never build a matrix.
- `elements()` is polled on every solve: return the same array while nothing changes and
  update element values in place (see the potentiometer), so polling allocates nothing.
- The examples run as fast as with the previous drive-strength model (`tests/` benchmark and the
  numbers in the v0.4 report); the AVR emulation dominates.

## Adding analog behaviour to a part

```ts
import type { AnalogElement, ModelFactory } from '../../core/types';

// A photoresistor: resistance from the light level, changed live from the inspector.
const create: ModelFactory = (ctx) => {
  const r = { kind: 'R', a: '1', b: '2', ohms: 10_000, id: 'r' } satisfies AnalogElement;
  const els: AnalogElement[] = [r];
  return {
    elements: () => els,
    input(event, data) {
      if (event !== 'prop') return;
      r.ohms = 500 + 1e6 / (1 + Number((data as { value: number }).value));
      ctx.invalidate();
    },
    state: () => ({ mA: ctx.current('r') * 1000 }),
  };
};
export default create;
```

- Keep pins and kinds stable; change values in place and call `ctx.invalidate()`.
- Prefer elements over computing voltages in `drive()`: a wiper that "drives" a number is a
  stiff source and ignores the load on it.
- Behavioural outputs (motor drivers, regulators) can stay numeric drives: they are ideal
  sources and cut clusters, which keeps everything fast.

## Limits and future work

- Logic levels are per part: each part turns voltages into levels with its own thresholds,
  5 V CMOS by default (HIGH ≥ 3 V, LOW ≤ 1.5 V). A board sets `vcc` in its `BoardSpec`: its
  `'high'` / `'pullup'` drives, input thresholds (`cmosLogic(vcc)`: 0.6 / 0.3 × VCC, or fixed
  datasheet values through `logic`) and ADC reference follow. Other parts call
  `ctx.setLogic(…)`. Parts without a supply pin (logic gates, sensors) still assume 5 V.
- Diodes are piecewise linear (no exponential curve, no temperature); BJTs have no Early effect,
  no reverse-active mode, and VBE is fixed at 0.65 V + 10 Ω; FETs are switches without a linear
  region.
- An inductor whose current is interrupted with no flyback path produces a huge (leakage-limited)
  voltage spike for one step; add a diode, as in a real circuit.
- Voltmeter is ideal (no load). Capacitors start uncharged at load time.
