// SPDX-License-Identifier: Apache-2.0
/**
 * Chip-independent microcontroller board model: power pins, GPIO, analogRead(), Serial,
 * I²C / SPI and the on-board L / TX / RX LEDs, on top of an McuRuntime (runtime.ts).
 *
 * The runtime is created in-process (families.ts) unless the engine runs MCUs on other
 * cores: then `ctx.attachMcu()` returns a stand-in that mirrors the remote MCU's pins
 * (src/sim/mc-coordinator.ts). Either way this model and the part contract are the same.
 */
import type { Drive, ModelFactory, PartContext } from '../core/types';
import { I2CController, SPIController, type I2CPins, type SPIPins } from './buses';
import { createRuntime } from './families';
import { PIN_HIGH, type I2CBus, type McuDescriptor, type McuHost, type McuRuntime, type SPIBus } from './runtime';

export interface BoardSpec {
  /** GPIO pin names; the position is the runtime pin index. */
  pins: string[];
  /** Analog input channel → pin name (A0, A1, …). */
  analog: string[];
  /** Power and reset pins and how they are driven. */
  power: Record<string, Drive>;
  /** Pin with the "L" LED (default "13"). */
  ledPin?: string;
  /** Pins of UART 0 (Serial). */
  uart?: { rx: string; tx: string };
  /** Board pins of the I²C bus. Header aliases join via part.json `internal`. */
  i2c?: I2CPins;
  /** Board pins of the hardware SPI bus. */
  spi?: SPIPins;
  /** Net drive for each PinDrive code (z, low, high, pullup, pulldown). Default: 5 V logic. */
  drives?: readonly Drive[];
}

const LED_FLASH_NS = 30_000_000; // TX/RX LEDs stay lit 30 ms after a byte
const DRIVES_5V: readonly Drive[] = ['z', 'low', 'high', 'pullup', 'pulldown'];

function i2cBus(ctx: PartContext, pins: I2CPins): I2CBus {
  const c = new I2CController(ctx, pins);
  // Devices see the MCU's exact time in ctx.now().
  return {
    start: (t) => (ctx.advanceTime(t), c.start()),
    connect: (t, address, read) => (ctx.advanceTime(t), c.connect(address, read)),
    write: (t, byte) => (ctx.advanceTime(t), c.write(byte)),
    read: (t, ack) => (ctx.advanceTime(t), c.read(ack)),
    stop: (t) => (ctx.advanceTime(t), c.stop()),
  };
}

function spiBus(ctx: PartContext, pins: SPIPins): SPIBus {
  const c = new SPIController(ctx, pins);
  return { transfer: (t, byte) => (ctx.advanceTime(t), c.transfer(byte)) };
}

export function mcuBoard(board: BoardSpec, descriptor: McuDescriptor): ModelFactory {
  const index = new Map(board.pins.map((p, i) => [p, i]));
  const power = new Map(Object.entries(board.power));
  const table = board.drives ?? DRIVES_5V;
  const ledIndex = index.get(board.ledPin ?? '13') ?? -1;
  const rxPin = board.uart?.rx;
  const txPin = board.uart?.tx;

  return (ctx) => {
    let serialOut = '';
    let txUntil = 0;
    let rxUntil = 0;
    let rt: McuRuntime | null = null;

    if (ctx.firmware) {
      const host: McuHost = {
        outputs(t) {
          ctx.advanceTime(t);
          ctx.invalidate();
        },
        uartTx(_port, byte, t) {
          serialOut += String.fromCharCode(byte);
          txUntil = t + LED_FLASH_NS;
          ctx.advanceTime(t);
          if (txPin) ctx.sendData(txPin, 'uart', byte); // TX pin → whatever is wired to it
        },
        uartRx(_port, _byte, t) {
          rxUntil = t + LED_FLASH_NS;
        },
        analogRead(channel) {
          const pin = board.analog[channel];
          return (pin && ctx.voltage(pin)) || 0;
        },
        i2c: board.i2c ? i2cBus(ctx, board.i2c) : undefined,
        spi: board.spi ? spiBus(ctx, board.spi) : undefined,
      };
      rt = ctx.attachMcu?.(descriptor, host) ?? createRuntime(descriptor, ctx.firmware, host);
    }

    return {
      drive(pin) {
        const p = power.get(pin);
        if (p !== undefined) return p;
        const i = index.get(pin);
        return rt && i !== undefined ? table[rt.drive(i)] : 'z';
      },

      onPinChange(pin, level) {
        const i = index.get(pin);
        if (rt && i !== undefined) rt.setInput(i, level);
      },

      onData(pin, channel, value) {
        if (rt && pin === rxPin && channel === 'uart') rt.uartReceive(0, value);
      },

      step(timeNs) {
        rt?.runUntil(timeNs);
      },

      input(event, data) {
        if (rt && event === 'serial' && typeof data === 'string') {
          for (const ch of data) rt.uartReceive(0, ch.charCodeAt(0) & 0xff);
        }
      },

      state() {
        if (serialOut) {
          ctx.emit('serial', serialOut);
          serialOut = '';
        }
        const now = ctx.now();
        return {
          ledPower: true,
          led13: !!rt && ledIndex >= 0 && rt.drive(ledIndex) === PIN_HIGH,
          ledTX: now < txUntil,
          ledRX: now < rxUntil,
          running: !!rt,
        };
      },
    };
  };
}
