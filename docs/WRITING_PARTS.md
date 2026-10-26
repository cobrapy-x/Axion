# Writing a part

Every part lives in its own folder under `src/parts/`. Axion discovers it automatically. You don't register it anywhere.

```
src/parts/my-part/
  part.json   metadata: name, category, pins that are joined inside the part, properties
  model.ts    behaviour (runs in the simulation worker, no DOM)
  view.ts     drawing + animation (runs in the page)
```

The model and view never talk to each other directly. The model produces a small **state** object about 60 times per second; the view turns that state into pixels. This keeps the simulation fast and the animation smooth, and means a slow animation can never slow down the simulation.

## 1. `part.json`

```json
{
  "type": "axion-dc-motor",
  "name": "DC motor",
  "category": "Actuators",
  "description": "Brushed DC motor driven by two pins.",
  "version": "1.0.0",
  "license": "Apache-2.0",
  "idPrefix": "m",
  "internal": [],
  "props": {
    "rpm": { "type": "number", "label": "No-load speed (RPM)", "default": 200 }
  }
}
```

- `type`: a unique id. Reuse the Wokwi type (e.g. `wokwi-servo`) when the part is the same, so Wokwi diagrams import cleanly. Use the `axion-` prefix for new parts.
- `internal`: groups of pins that are always connected inside the part (e.g. both GND pins).
- `interactive: true`: the user clicks the part while the simulation runs (buttons, switches, pots).
- `mcu`: only for programmable boards (see `src/parts/arduino-uno/part.json`).

## 2. `model.ts`

A model is a function that receives a `PartContext` and returns any of these optional hooks:

| Hook | When it is called | Use it to |
|---|---|---|
| `drive(pin)` | every circuit solve | say how the part drives a pin: `'high'` (5 V behind ~25 Ω), `'low'` (0 V), a number of volts (a stiff source: power pins, batteries), `'pullup'`, `'pulldown'` (~35 kΩ), `{ volts, ohms }`, or `'z'` (not driving) |
| `switches()` | when topology changes | return pin pairs currently connected (switches, relays) |
| `resistors()` | when topology changes | legacy: pin pairs linked by a 1 kΩ resistor; use `elements()` instead |
| `elements()` | every circuit solve (return the same array while nothing changes) | describe the part's analog circuit: `R`, `C`, `L`, `V`, `D` (LED, zener), `SW`, `BJT`, `FET` between its pins, e.g. `[{ kind: 'R', a: '1', b: '2', ohms: 220, id: 'r' }]`; read an element's current with `ctx.current(id)`. See [SOLVER.md](SOLVER.md) |
| `onPinChange(pin, level)` | the voltage on one of the part's pins changed | react to inputs (`ctx.now()` gives the exact time) |
| `onData(pin, channel, value)` | another part sent data on the same net | UART bytes today; I2C/SPI later |
| `step(timeNs)` | every 50 µs of simulated time | only for parts that must produce events on their own (CPUs, encoders) |
| `input(event, data)` | the user interacted with the view | button press, knob value… |
| `state()` | ~60×/second | return what the view needs to draw |

Useful context functions: `ctx.voltage(pin)` (volts or `null` if floating), `ctx.level(pin)` (`1`, `0` or `null`), `ctx.props` (values from `part.json` / the inspector), `ctx.now()` (ns).

**Outputs that depend on inputs need no events.** `drive()` is re-evaluated after every change, so a logic gate is just:

```ts
import type { ModelFactory } from '../../core/types';

const create: ModelFactory = (ctx) => ({
  drive: (pin) => (pin === 'Y' ? (ctx.level('A') === 1 ? 'low' : 'high') : 'z'), // NOT gate
});
export default create;
```

Call `ctx.invalidate()` when `drive()` would change for a reason the engine can't see (a button press, a timer inside the part), and `ctx.invalidate(true)` when `switches()` or `resistors()` change.

**Prefer lazy physics over `step()`.** Most moving parts can compute their state from timestamps when something happens. The DC motor (`src/parts/dc-motor/model.ts`) updates its speed only in `onPinChange` and `state()`, using the shared helper in `src/physics/motor.ts`:

```ts
const create: ModelFactory = (ctx) => {
  const motor = new MotorPhysics({ rpm: Number(ctx.props.rpm), ratedVoltage: Number(ctx.props.ratedVoltage) }, ctx.now());
  return {
    onPinChange() {
      motor.setVoltage(across(ctx.voltage('+'), ctx.voltage('-')), ctx.now());
    },
    state() {
      motor.advance(ctx.now());
      return { angle: motor.angle % 360, rpm: Math.round(motor.rpm) };
    },
  };
};
```

The servo (`src/parts/servo/model.ts`) works the same way: it timestamps the rising and falling edges on its PWM pin, turns the pulse width into a target angle, and moves toward it at a realistic speed.

## 3. `view.ts`

```ts
import type { PartView } from '../../core/types';

const view: PartView = {
  create() {
    const el = document.createElement('div');
    el.innerHTML = `<svg width="80" height="96" viewBox="0 0 80 96">
      <circle cx="40" cy="40" r="36" fill="#666"/>
      <g class="rotor"><rect x="38" y="8" width="4" height="32" fill="#fc0"/></g>
    </svg>`;
    return el;
  },
  update(el, s) {
    el.querySelector('.rotor')!.setAttribute('transform', `rotate(${s.angle} 40 40)`);
  },
  pins: () => [
    { name: '+', x: 30, y: 96 },
    { name: '-', x: 50, y: 96 },
  ],
};
export default view;
```

- `pins()` returns pin positions in CSS px relative to the element's top-left corner. Put pins on an edge (usually the bottom) so wires don't cross the drawing. Parts built on [wokwi-elements](https://github.com/wokwi/wokwi-elements) (MIT) already expose `pinInfo`, so you can skip `pins()`.
- Animate with SVG attributes or CSS transforms in `update()`. `src/physics/motor-view.ts` has helpers for motor faces and labelled header pins.
- `attach(el, send)` wires up interaction: `send('press')` reaches the model's `input()`. A `send('value', n)` while the simulation is stopped is saved as the part's `value` property (used by the potentiometer).

## 4. Test it

Add a case to `tests/` that loads a small diagram, runs the engine and checks levels or state. The engine runs in plain Node, so tests are fast and need no browser:

```ts
const e = new Engine(loadPartTypes());
e.load(parseDiagram(diagram), { uno: hexText });
e.stepTo(500e6);                         // 500 ms of simulated time
expect(e.snapshot().states.m1.angle).toBeGreaterThan(0);
```

## Licensing your part

Put an SPDX line at the top of each file and set `license` in `part.json`. Code copied from elsewhere must have a compatible license (MIT, BSD, Apache-2.0, ISC, Zlib). GPL code cannot be copied into Axion; run a GPL program as a separate process instead, the way Axion uses arduino-cli.
