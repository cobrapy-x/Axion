// SPDX-License-Identifier: Apache-2.0
/** Auto-discovers part manifests + views (main thread side). */
import type { PartManifest, PartView, PinPosition } from './types';

const manifests = import.meta.glob<PartManifest>('../parts/*/part.json', { eager: true, import: 'default' });
const views = import.meta.glob<PartView>('../parts/*/view.ts', { eager: true, import: 'default' });
/** Prebuilt firmware for a board's starter sketch, so a new board runs without a compiler installed. */
const templateHexes = import.meta.glob<string>('../parts/*/template.hex', { query: '?raw', import: 'default' });

export interface PartUI {
  manifest: PartManifest;
  view: PartView;
  /** Loads the firmware built from `manifest.mcu.template` (microcontroller boards only). */
  templateHex?: () => Promise<string>;
}

const folder = (path: string) => path.split('/').slice(-2, -1)[0];

export const partUIs = new Map<string, PartUI>();
{
  const byFolder = new Map<string, PartView>();
  for (const [path, view] of Object.entries(views)) byFolder.set(folder(path), view);
  const hexByFolder = new Map<string, () => Promise<string>>();
  for (const [path, hex] of Object.entries(templateHexes)) hexByFolder.set(folder(path), hex);
  for (const [path, manifest] of Object.entries(manifests)) {
    const view = byFolder.get(folder(path));
    if (view) partUIs.set(manifest.type, { manifest, view, templateHex: hexByFolder.get(folder(path)) });
    else console.warn(`[axion] part ${manifest.type} has no view.ts; skipped`);
  }
}

/** Pin positions of a rendered part (falls back to the wokwi-elements `pinInfo` convention). */
export function pinsOf(ui: PartUI | undefined, el: HTMLElement): PinPosition[] {
  if (ui?.view.pins) return ui.view.pins(el);
  const info = (el as HTMLElement & { pinInfo?: PinPosition[] }).pinInfo;
  return Array.isArray(info) ? info : [];
}
