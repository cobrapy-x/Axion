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
| `drive(pin)` | every circuit solve | say how the part drives a pin: `'high'`, `'low'`, `'pullup'`, `'pulldown'`, `'z'` |
| `switches()` | when topology changes | return pin pairs currently connected (switches, relays) |
| `resistors()` | when topology changes | return pin pairs linked by a resistor |
| `onPinChange(pin, level)` | a net attached to the part changed level | react to inputs (`ctx.now()` gives the exact time) |
| `onData(pin, channel, value)` | another part sent data on the same net | UART bytes today; I2C/SPI later |
| `step(timeNs)` | every 50 µs of simulated time | advance internal physics or a CPU |
| `input(event, data)` | the user interacted with the view | button press, slider value… |
| `state()` | ~60×/second | return what the view needs to draw |

Call `ctx.invalidate()` whenever the result of `drive()` changes, and `ctx.invalidate(true)` when `switches()` or `resistors()` change.

Example: a DC motor with direction and PWM speed control.

```ts
import type { ModelFactory } from '../../core/types';

const create: ModelFactory = (ctx) => {
  let angle = 0;   // degrees
  let dir = 0;     // -1, 0, +1
  let last = ctx.now();
  const maxDegPerNs = (Number(ctx.props.rpm) * 360) / 60e9;

  // Rotate by however long the motor has been spinning in its current direction.
  const integrate = () => {
    const now = ctx.now();
    angle = (angle + dir * maxDegPerNs * (now - last)) % 360;
    last = now;
  };

  return {
    onPinChange() {
      integrate();   // finish the previous interval with the old direction
      const a = ctx.level('IN1'), b = ctx.level('IN2');
      dir = a === 1 && b === 0 ? 1 : a === 0 && b === 1 ? -1 : 0;
    },
    step: integrate,  // PWM edges average out into a lower speed automatically
    state: () => ({ angle }),
  };
};
export default create;
```

## 3. `view.ts`

```ts
import type { PartView } from '../../core/types';

const view: PartView = {
  create() {
    const el = document.createElement('div');
    el.innerHTML = `<svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="36" fill="#666"/>
      <g class="rotor"><rect x="38" y="8" width="4" height="32" fill="#fc0"/></g>
    </svg>`;
    return el;
  },
  update(el, s) {
    el.querySelector<SVGGElement>('.rotor')!.style.transform = `rotate(${s.angle}deg)`;
    el.querySelector<SVGGElement>('.rotor')!.style.transformOrigin = '40px 40px';
  },
  pins: () => [
    { name: 'IN1', x: 30, y: 80 },
    { name: 'IN2', x: 50, y: 80 },
  ],
};
export default view;
```

- `pins()` returns pin positions in CSS px relative to the element's top-left corner. Parts built on [wokwi-elements](https://github.com/wokwi/wokwi-elements) (MIT) already expose `pinInfo`, so you can skip `pins()`.
- Animate with CSS transforms or SVG attributes in `update()`. Only touch the DOM when a value actually changes if the part is heavy (e.g. an LCD).
- `attach(el, send)` wires up interaction: `send('press')` reaches the model's `input()`.

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
