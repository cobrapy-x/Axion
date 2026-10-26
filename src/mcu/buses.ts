// SPDX-License-Identifier: Apache-2.0
/**
 * Transaction-level I²C and SPI controllers, shared by every microcontroller model
 * (AVR today; RP2040 and ESP32 later).
 *
 * The MCU side only knows the board pin names of its bus signals. On each transaction
 * the controller looks up the devices on those nets with `ctx.peers()` and calls their
 * `I2CDevice` / `SPIDevice` hooks (see core/types.ts) synchronously. No bit edges are
 * simulated: a whole byte is exchanged at once, the MCU peripheral adds the byte time.
 *
 * Multi-core note: these controllers always run next to the devices, in the coordinator.
 * A runtime in an MCU worker reaches them through synchronous requests (McuHost.i2c / spi,
 * see docs/MULTICORE.md). The MCU peripherals complete transfers *later* (after the byte
 * time), so those requests could become asynchronous if round trips ever matter.
 */
import type { I2CDevice, PartContext, Peer, SPIDevice } from '../core/types';

export interface I2CPins {
  sda: string;
  scl: string;
}

export interface SPIPins {
  mosi: string;
  miso: string;
  sck: string;
}

/** Ids of other parts that have a pin on the net of `pin`. */
function partsOn(ctx: PartContext, pin: string): Set<string> {
  const ids = new Set<string>();
  for (const p of ctx.peers(pin)) if (p.id !== ctx.id) ids.add(p.id);
  return ids;
}

/** Devices of one kind on the net of `pin` (one entry per part), excluding the MCU itself. */
function devicesOn<T>(ctx: PartContext, pin: string, pick: (p: Peer) => T | undefined): Array<{ id: string; dev: T }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; dev: T }> = [];
  for (const p of ctx.peers(pin)) {
    if (p.id === ctx.id || seen.has(p.id)) continue;
    const dev = pick(p);
    if (!dev) continue;
    seen.add(p.id);
    out.push({ id: p.id, dev });
  }
  return out;
}

/** Normalise an address property like "0x27", "39" or 39 to a 7-bit number. */
export function parseI2CAddress(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 0 && n < 128 ? n : fallback;
}

/**
 * I²C controller (master). Mirrors the events of a hardware I²C peripheral:
 * start → connect(address) → write/read bytes → stop. Pull-ups are assumed present.
 */
export class I2CController {
  private target: I2CDevice | null = null;

  constructor(
    private ctx: PartContext,
    private pins: I2CPins,
  ) {}

  /** (Repeated) START. A repeated start ends the current transfer without a STOP. */
  start(): void {
    this.target = null;
  }

  /**
   * Address phase. Returns true (ACK) if a device on both SDA and SCL nets answers
   * to `address`; otherwise NACK, as on a real bus.
   */
  connect(address: number, read: boolean): boolean {
    this.target = null;
    const onScl = partsOn(this.ctx, this.pins.scl);
    for (const { id, dev } of devicesOn(this.ctx, this.pins.sda, (p) => p.model.i2c)) {
      if (!onScl.has(id) || !dev.addresses().includes(address)) continue;
      if (dev.start(address, read)) {
        this.target = dev;
        return true;
      }
    }
    return false;
  }

  write(byte: number): boolean {
    return this.target ? this.target.write(byte & 0xff) : false;
  }

  /** Read a byte; `ack` tells the device whether more bytes will follow. Idle bus reads 0xFF. */
  read(ack: boolean): number {
    return this.target ? this.target.read(ack) & 0xff : 0xff;
  }

  stop(): void {
    this.target?.stop();
    this.target = null;
  }
}

/**
 * SPI controller (master). Each byte goes to every device on the MOSI net that is also
 * clocked by our SCK and whose chip-select is active. The reply comes from the selected
 * devices that drive our MISO net (wired-AND; an undriven MISO reads 0xFF).
 */
export class SPIController {
  constructor(
    private ctx: PartContext,
    private pins: SPIPins,
  ) {}

  transfer(byte: number): number {
    const devices = devicesOn(this.ctx, this.pins.mosi, (p) => p.model.spi);
    if (!devices.length) return 0xff;
    const onSck = partsOn(this.ctx, this.pins.sck);
    const onMiso = partsOn(this.ctx, this.pins.miso);
    let reply = 0xff;
    for (const { id, dev } of devices as Array<{ id: string; dev: SPIDevice }>) {
      if (!onSck.has(id) || !dev.selected()) continue;
      const r = dev.transfer(byte & 0xff) & 0xff;
      if (onMiso.has(id)) reply &= r;
    }
    return reply;
  }
}
