// SPDX-License-Identifier: Apache-2.0
/**
 * Auto-discovers part models (worker side). Adding a folder under src/parts/
 * with a part.json + model.ts is all it takes to register a new part.
 */
import type { PartType } from './engine';
import type { ModelFactory, PartManifest } from './types';

const manifests = import.meta.glob<PartManifest>('../parts/*/part.json', { eager: true, import: 'default' });
const models = import.meta.glob<ModelFactory>('../parts/*/model.ts', { eager: true, import: 'default' });

const folder = (path: string) => path.split('/').slice(-2, -1)[0];

export function loadPartTypes(): Map<string, PartType> {
  const byFolder = new Map<string, ModelFactory>();
  for (const [path, model] of Object.entries(models)) byFolder.set(folder(path), model);
  const types = new Map<string, PartType>();
  for (const [path, manifest] of Object.entries(manifests)) {
    types.set(manifest.type, { manifest, model: byFolder.get(folder(path)) });
  }
  return types;
}
