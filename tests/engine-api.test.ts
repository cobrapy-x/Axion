// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/core/diagram';
import { Engine, type PartType } from '../src/core/engine';
import type { ModelFactory, PartContext } from '../src/core/types';

const manifest = (type: string) => ({ type, name: type, category: 'test', version: '1', license: 'Apache-2.0' });

describe('engine API for parts', () => {
  it('schedule() runs callbacks at exact times, in order', () => {
    const log: Array<[string, number]> = [];
    let ctxRef: PartContext | undefined;
    const timerPart: ModelFactory = (ctx) => {
      ctxRef = ctx;
      ctx.schedule(1_234, () => log.push(['a', ctx.now()]));
      ctx.schedule(777, () => {
        log.push(['b', ctx.now()]);
        ctx.schedule(ctx.now() + 100_003, () => log.push(['c', ctx.now()]));
      });
      return { state: () => ({}) };
    };
    const e = new Engine(new Map<string, PartType>([['t', { manifest: manifest('t'), model: timerPart }]]));
    e.load(parseDiagram({ version: 1, parts: [{ type: 't', id: 't1', top: 0, left: 0 }], connections: [] }));
    e.stepTo(1e6);
    expect(log).toEqual([
      ['b', 777],
      ['a', 1_234],
      ['c', 100_780],
    ]);
    expect(ctxRef!.now()).toBe(1e6);
  });

  it('peers() lists the other pins on a net', () => {
    let peersOf: (pin: string) => string[] = () => [];
    const a: ModelFactory = (ctx) => {
      peersOf = (pin) => ctx.peers(pin).map((p) => `${p.id}:${p.pin}`);
      return { state: () => ({}) };
    };
    const b: ModelFactory = () => ({ i2c: { addresses: () => [0x27], start: () => true, write: () => true, read: () => 0, stop: () => {} } });
    const e = new Engine(
      new Map<string, PartType>([
        ['a', { manifest: manifest('a'), model: a }],
        ['b', { manifest: manifest('b'), model: b }],
      ]),
    );
    e.load(
      parseDiagram({
        version: 1,
        parts: [
          { type: 'a', id: 'x', top: 0, left: 0 },
          { type: 'b', id: 'y', top: 0, left: 0 },
          { type: 'b', id: 'z', top: 0, left: 0 },
        ],
        connections: [
          ['x:SDA', 'y:SDA', '', []],
          ['y:SDA', 'z:SDA', '', []],
        ],
      }),
    );
    expect(peersOf('SDA').sort()).toEqual(['y:SDA', 'z:SDA']);
    expect(peersOf('SCL')).toEqual([]);
  });
});
