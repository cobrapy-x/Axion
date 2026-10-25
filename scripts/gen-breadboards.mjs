// SPDX-License-Identifier: Apache-2.0
/**
 * Writes the breadboard part.json files (including the `internal` connection
 * groups) from src/parts/breadboard/layout.ts. Run after changing the layout:
 *   node scripts/gen-breadboards.mjs
 * (Node ≥ 22.18 runs the TypeScript layout module directly.)
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BREADBOARDS, groups } from '../src/parts/breadboard/layout.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const meta = {
  'wokwi-breadboard': {
    folder: 'breadboard',
    name: 'Breadboard',
    description:
      'Full-size solderless breadboard (830 tie points): 63 columns of 5 connected holes on each side of the centre channel, plus two + and − power rails along the top and bottom. Parts dropped on it snap to the holes and connect automatically.',
    tags: ['basic'],
  },
  'wokwi-breadboard-half': {
    folder: 'breadboard-half',
    name: 'Half breadboard',
    description:
      'Half-size solderless breadboard (400 tie points): 30 columns of 5 connected holes on each side of the centre channel, plus + and − power rails along the top and bottom. Parts dropped on it snap to the holes and connect automatically.',
    tags: ['basic'],
  },
  'wokwi-breadboard-mini': {
    folder: 'breadboard-mini',
    name: 'Mini breadboard',
    description:
      'Mini solderless breadboard (170 tie points): 17 columns of 5 connected holes on each side of the centre channel, no power rails. Parts dropped on it snap to the holes and connect automatically.',
    tags: [],
  },
};

for (const [type, spec] of Object.entries(BREADBOARDS)) {
  const m = meta[type];
  const manifest = {
    type,
    name: m.name,
    category: 'Prototyping',
    description: m.description,
    version: '1.0.0',
    license: 'Apache-2.0',
    idPrefix: 'bb',
    carrier: true,
    ...(m.tags.length ? { tags: m.tags } : {}),
    internal: groups(spec),
  };
  // One group per line keeps the file readable and diffs small.
  const json = JSON.stringify(manifest, null, 2).replace(
    /"internal": \[[\s\S]*\]\n\}$/,
    `"internal": [\n${manifest.internal.map((g) => '    ' + JSON.stringify(g)).join(',\n')}\n  ]\n}`,
  );
  writeFileSync(resolve(root, 'src/parts', m.folder, 'part.json'), json + '\n');
  console.log(`${type}: ${manifest.internal.flat().length} tie points, ${manifest.internal.length} groups`);
}
