// SPDX-License-Identifier: Apache-2.0
/** Bundled examples, auto-discovered from /examples/<name>/. */
import { parseDiagram, type Project } from '../core/diagram';

interface ExampleMeta {
  name: string;
  description?: string;
  sketches: Record<string, string>;
}

const metas = import.meta.glob<ExampleMeta>('../../examples/*/example.json', { eager: true, import: 'default' });
const diagrams = import.meta.glob<unknown>('../../examples/*/diagram.json', { eager: true, import: 'default' });
const sources = import.meta.glob<string>(['../../examples/*/*.ino', '../../examples/*/*.py'], { eager: true, query: '?raw', import: 'default' });
// Firmware is loaded on demand: each .hex becomes its own small chunk, outside the main bundle.
const hexes = import.meta.glob<string>('../../examples/*/*.hex', { query: '?raw', import: 'default' });

export interface Example {
  key: string;
  name: string;
  description?: string;
  project: Project;
  /** Prebuilt firmware loaders per MCU id, so examples run without a compiler installed. */
  prebuilt: Record<string, () => Promise<string>>;
}

const dir = (p: string) => p.split('/').slice(-2, -1)[0];

export const examples: Example[] = Object.entries(metas)
  .map(([path, meta]) => {
    const key = dir(path);
    const base = path.slice(0, path.lastIndexOf('/') + 1);
    const sketches: Record<string, string> = {};
    const prebuilt: Record<string, () => Promise<string>> = {};
    for (const [mcu, file] of Object.entries(meta.sketches)) {
      // A .py file is MicroPython code for that board (see usesPython in main.ts).
      if (file.endsWith('.py')) {
        sketches[`${mcu}:main.py`] = sources[base + file] ?? '';
        continue;
      }
      sketches[mcu] = sources[base + file] ?? '';
      const hex = hexes[base + file.replace(/\.ino$/, '.hex')];
      if (hex) prebuilt[mcu] = hex;
    }
    const project: Project = {
      format: 'axion-project',
      version: 1,
      name: meta.name,
      diagram: parseDiagram(diagrams[base + 'diagram.json']),
      sketches,
    };
    return { key, name: meta.name, description: meta.description, project, prebuilt };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
