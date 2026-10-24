// SPDX-License-Identifier: Apache-2.0
/** Auto-discovers part manifests + views (main thread side). */
import type { PartManifest, PartView, PinPosition } from './types';

const manifests = import.meta.glob<PartManifest>('../parts/*/part.json', { eager: true, import: 'default' });
const views = import.meta.glob<PartView>('../parts/*/view.ts', { eager: true, import: 'default' });

export interface PartUI {
  manifest: PartManifest;
  view: PartView;
}

const folder = (path: string) => path.split('/').slice(-2, -1)[0];

export const partUIs = new Map<string, PartUI>();
{
  const byFolder = new Map<string, PartView>();
  for (const [path, view] of Object.entries(views)) byFolder.set(folder(path), view);
  for (const [path, manifest] of Object.entries(manifests)) {
    const view = byFolder.get(folder(path));
    if (view) partUIs.set(manifest.type, { manifest, view });
    else console.warn(`[axion] part ${manifest.type} has no view.ts; skipped`);
  }
}

/** Pin positions of a rendered part (falls back to the wokwi-elements `pinInfo` convention). */
export function pinsOf(ui: PartUI | undefined, el: HTMLElement): PinPosition[] {
  if (ui?.view.pins) return ui.view.pins(el);
  const info = (el as HTMLElement & { pinInfo?: PinPosition[] }).pinInfo;
  return Array.isArray(info) ? info : [];
}
