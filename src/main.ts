// SPDX-License-Identifier: Apache-2.0
import './styles.css';
import { parseProject, splitEndpoint, type DiagramPart, type Project } from './core/diagram';
import { partUIs } from './core/parts-views';
import { Workspace, propsOf, type Selection } from './editor/workspace';
import { SimClient } from './sim/client';
import { addPrebuilt, compile, health } from './ui/compiler';
import { ComponentsPanel } from './ui/components-panel';
import { examples } from './ui/examples';
import { hydrateIcons, icon, LOGO_SVG } from './ui/icons';
import { dropdown } from './ui/menu';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STORAGE_KEY = 'axion.project.v1';
const SIDE_KEY = 'axion.ui.side-open';
const SERIAL_LIMIT = 100_000;
const narrow = window.matchMedia('(max-width: 900px)');
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

// ───────────────────────────── state ─────────────────────────────

let project: Project = { format: 'axion-project', version: 1, name: 'Untitled', diagram: { version: 1, parts: [], connections: [] }, sketches: {} };
let activeMcu: string | null = null;
let compiling = false;
const hexOverride: Record<string, string> = {};
const serial: Record<string, string> = {};
const shownWarnings = new Set<string>();

const sim = new SimClient();
const workspace = new Workspace($('workspace'), {
  change: () => {
    syncSketches();
    persist();
    updateToolbar();
  },
  select: (sel) => {
    renderInspector(sel);
    updateToolbar();
  },
  input: (part, event, data) => sim.input(part, event, data),
  history: () => updateToolbar(),
});

// ───────────────────────────── helpers ─────────────────────────────

let toastTimer = 0;
function toast(msg: string, error = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), error ? Math.max(7000, msg.length * 70) : 3500);
}

let persistTimer = 0;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      /* storage unavailable: autosave is a convenience only */
    }
  }, 400);
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) {
  const e: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

const mcuParts = (): DiagramPart[] => project.diagram.parts.filter((p) => partUIs.get(p.type)?.manifest.mcu);

/** Every MCU gets a sketch; removed MCUs lose theirs. */
function syncSketches() {
  const ids = new Set<string>();
  for (const p of mcuParts()) {
    ids.add(p.id);
    if (project.sketches[p.id] === undefined) project.sketches[p.id] = partUIs.get(p.type)!.manifest.mcu!.template ?? '';
  }
  for (const id of Object.keys(project.sketches)) if (!ids.has(id)) delete project.sketches[id];
  if (!activeMcu || !ids.has(activeMcu)) activeMcu = [...ids][0] ?? null;
  renderTabs();
}

// ───────────────────────────── project loading ─────────────────────────────

async function loadProject(p: Project) {
  if (sim.running) stop();
  project = structuredClone(p);
  activeMcu = null;
  for (const k of Object.keys(hexOverride)) delete hexOverride[k];
  for (const k of Object.keys(serial)) delete serial[k];
  shownWarnings.clear();
  await workspace.load(project.diagram);
  syncSketches();
  renderSerial();
  persist();
  updateToolbar();
}

const confirmDiscard = () => project.diagram.parts.length === 0 || confirm('Replace the current circuit? (Use Save first to keep it.)');

// ───────────────────────────── toolbar ─────────────────────────────

const runBtn = $<HTMLButtonElement>('btn-run');
const simStatus = $('sim-status');

/** Enable / disable toolbar buttons from the workspace state. */
function updateToolbar() {
  const running = workspace.running;
  const sel = workspace.selection;
  const set = (id: string, enabled: boolean) => ($<HTMLButtonElement>(id).disabled = !enabled);
  set('btn-copy', !running && workspace.canCopy);
  set('btn-paste', workspace.canPaste);
  set('btn-delete', !running && !!sel);
  set('btn-undo', workspace.canUndo);
  set('btn-redo', workspace.canRedo);
  set('btn-rotate', !running && sel?.kind === 'part');
  set('btn-wire-color', !running);
  panel?.setDisabled(running);
}

function updateRunButton() {
  const running = sim.running;
  runBtn.classList.toggle('stop', running);
  runBtn.disabled = compiling;
  runBtn.innerHTML = icon(running ? 'stop' : 'play');
  const label = running ? 'Stop Simulation' : compiling ? 'Compiling…' : 'Start Simulation';
  runBtn.append(el('span', { className: 'label' }, label));
  runBtn.title = running ? 'Stop the simulation (F5)' : 'Compile and start the simulation (F5)';
  runBtn.setAttribute('aria-label', label);
}

/** Tooltips + accessible names for icon buttons, with keyboard shortcuts. */
function initTooltips() {
  const keys: Record<string, string> = {
    'btn-copy': `${MOD}C`,
    'btn-paste': `${MOD}V`,
    'btn-delete': 'Del',
    'btn-undo': `${MOD}Z`,
    'btn-redo': MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Y',
    'btn-rotate': 'R',
  };
  for (const b of document.querySelectorAll<HTMLElement>('[data-tip]')) {
    const tip = b.dataset.tip!;
    b.title = keys[b.id] ? `${tip} (${keys[b.id]})` : tip;
    b.setAttribute('aria-label', tip);
  }
}

// ── wire colour ──

const WIRE_PALETTE: Array<[string, string | null]> = [
  ['Auto', null],
  ['Black', 'black'],
  ['Red', 'red'],
  ['Orange', 'orange'],
  ['Yellow', 'yellow'],
  ['Green', 'green'],
  ['Blue', 'blue'],
  ['Purple', 'purple'],
  ['Gray', 'gray'],
  ['White', 'white'],
  ['Brown', 'brown'],
];

/** Same rule the workspace uses for new wires when no colour is chosen. */
function autoWireColor(a: string, b: string): string {
  const pins = [splitEndpoint(a).pin, splitEndpoint(b).pin].map((p) => p.toUpperCase());
  if (pins.some((p) => p.startsWith('GND'))) return 'black';
  if (pins.some((p) => ['5V', '3.3V', 'VCC', 'VIN'].includes(p))) return 'red';
  return 'green';
}

function chooseWireColor(color: string | null) {
  workspace.wireColor = color;
  const sel = workspace.selection;
  if (sel?.kind === 'wire' && !workspace.running) {
    const c = project.diagram.connections[sel.index];
    if (c) workspace.setWireColor(sel.index, color ?? autoWireColor(c[0], c[1]));
    renderInspector(workspace.selection);
  }
  renderWireColor();
}

function renderWireColor() {
  const current = workspace.wireColor;
  const name = WIRE_PALETTE.find(([, c]) => c === current)?.[0] ?? current ?? 'Auto';
  const sw = $('wire-swatch');
  sw.classList.toggle('auto', current === null);
  sw.style.background = current ?? '';
  const btn = $('btn-wire-color');
  btn.title = `Wire colour: ${name}`;
  btn.setAttribute('aria-label', `Wire colour: ${name}`);
  for (const b of $('wire-color-menu').querySelectorAll<HTMLElement>('[role="menuitemradio"]')) {
    b.setAttribute('aria-checked', String((b.dataset.color || null) === current));
  }
}

function initWireColor() {
  const menu = $('wire-color-menu');
  const head = el('div', { className: 'menu-label' }, 'Wire colour');
  const grid = el('div', { className: 'swatches' });
  for (const [label, color] of WIRE_PALETTE) {
    const b = el('button', { className: color ? 'swatch-item' : 'swatch-item auto-item', title: label });
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-label', label);
    b.dataset.color = color ?? '';
    const sw = el('span', { className: color ? 'swatch' : 'swatch auto' });
    if (color) sw.style.background = color;
    b.append(sw);
    if (!color) b.append(el('span', {}, 'Auto'), el('small', {}, 'by pin'));
    b.onclick = () => chooseWireColor(color);
    (color ? grid : menu).append(b);
  }
  menu.prepend(head);
  menu.append(grid);
  dropdown($('btn-wire-color'), menu);
  renderWireColor();
}

// ── file menu ──

function initFileMenu() {
  const list = $('example-list');
  for (const ex of examples) {
    const b = el('button', { title: ex.description ?? '' }, el('span', {}, ex.name));
    b.setAttribute('role', 'menuitem');
    b.dataset.example = ex.key;
    if (ex.description) b.append(el('small', {}, ex.description));
    b.onclick = () => {
      if (confirmDiscard()) void loadProject(ex.project).then(() => toast(`Loaded example: ${ex.name}`));
    };
    list.append(b);
    for (const [mcu, hex] of Object.entries(ex.prebuilt)) {
      const part = ex.project.diagram.parts.find((p) => p.id === mcu);
      const fqbn = part && partUIs.get(part.type)?.manifest.mcu?.fqbn;
      if (fqbn) void addPrebuilt(fqbn, ex.project.sketches[mcu], hex);
    }
  }
  // Starter sketches of every board come prebuilt too, so a freshly added board runs without a compiler.
  for (const ui of partUIs.values()) {
    const mcu = ui.manifest.mcu;
    if (mcu?.template && ui.templateHex) void addPrebuilt(mcu.fqbn, mcu.template, ui.templateHex);
  }
  if (!examples.length) list.append(el('div', { className: 'menu-empty' }, 'No examples found'));
  dropdown($('btn-file'), $('file-menu'));

  $('btn-new').onclick = () => {
    if (!confirmDiscard()) return;
    void loadProject({ format: 'axion-project', version: 1, name: 'Untitled', diagram: { version: 1, editor: 'axion', parts: [], connections: [] }, sketches: {} });
  };
  const fileInput = $<HTMLInputElement>('file-open');
  $('btn-open').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const p = parseProject(JSON.parse(await f.text()));
      if (p.name === 'Imported') p.name = f.name.replace(/\.(axion\.)?json$/, '');
      await loadProject(p);
      toast(`Opened ${f.name}`);
    } catch (err) {
      toast(`Could not open ${f.name}: ${err instanceof Error ? err.message : err}`, true);
    }
  };
  $('btn-save').onclick = () => download(`${project.name.replace(/[^\w-]+/g, '_') || 'project'}.axion.json`, JSON.stringify(project, null, 2));
  $('btn-export').onclick = () => download('diagram.json', JSON.stringify({ ...project.diagram, editor: 'axion' }, null, 2));
}

function initToolbar() {
  $('brand').insertAdjacentHTML('afterbegin', LOGO_SVG);
  $('btn-copy').onclick = () => {
    workspace.copySelection();
    updateToolbar();
  };
  $('btn-paste').onclick = () => void workspace.paste();
  $('btn-delete').onclick = () => workspace.deleteSelection();
  $('btn-undo').onclick = () => void workspace.undo();
  $('btn-redo').onclick = () => void workspace.redo();
  $('btn-rotate').onclick = () => workspace.rotateSelection();
  runBtn.onclick = () => (sim.running ? stop() : void run());
  $('btn-code').onclick = () => setMode(mode === 'code' && sideOpen ? 'parts' : 'code');
  $('btn-code-close').onclick = () => setMode('parts');
  initWireColor();
  initFileMenu();

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
      e.preventDefault();
      if (sim.running) stop();
      else void run();
      return;
    }
    // + / − adjust the selected part's stepper property (e.g. number of battery cells).
    if (['+', '=', '-', '_'].includes(e.key) && !e.metaKey && !e.ctrlKey && !workspace.running) {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      const sel = workspace.selection;
      const part = sel?.kind === 'part' ? project.diagram.parts.find((p) => p.id === sel.id) : undefined;
      const ui = part && partUIs.get(part.type);
      const entry = Object.entries(ui?.manifest.props ?? {}).find(([, sp]) => sp.type === 'number' && sp.min !== undefined && sp.max !== undefined);
      if (!part || !ui || !entry) return;
      const [key, spec] = entry;
      const cur = Number(propsOf(part, ui)[key]);
      const next = Math.min(spec.max!, Math.max(spec.min!, cur + (e.key === '+' || e.key === '=' ? 1 : -1) * (spec.step ?? 1)));
      if (next !== cur) {
        e.preventDefault();
        workspace.setPartAttr(part.id, key, String(next));
        renderInspector(workspace.selection);
      }
    }
  });
  // Keyboard copy (handled by the workspace) changes what Paste can do.
  window.addEventListener('keyup', () => updateToolbar());

  // Canvas overlay controls must not start a pan / clear the selection.
  for (const id of ['btn-fit', 'compiler-status']) $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
  $('btn-zoom-in').onclick = () => workspace.zoomBy(1.2);
  $('btn-zoom-out').onclick = () => workspace.zoomBy(1 / 1.2);
  $('btn-fit').onclick = () => workspace.fit();
}

// ───────────────────────────── side panel ─────────────────────────────

let panel: ComponentsPanel | null = null;
let mode: 'parts' | 'code' = 'parts';
let sideOpen = true;

function applySide() {
  const side = $('side');
  side.classList.toggle('collapsed', !sideOpen);
  side.dataset.mode = mode;
  $('panel-parts').hidden = mode !== 'parts';
  $('panel-code').hidden = mode !== 'code';
  const codeOn = mode === 'code' && sideOpen;
  const codeBtn = $('btn-code');
  codeBtn.setAttribute('aria-pressed', String(codeOn));
  codeBtn.classList.toggle('active', codeOn);
  const toggle = $('btn-side');
  const label = sideOpen ? 'Hide panel' : mode === 'code' ? 'Show code' : 'Show components';
  toggle.innerHTML = icon(sideOpen ? 'chevron-right' : 'chevron-left', 16);
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('aria-expanded', String(sideOpen));
  if (codeOn) {
    updateGutter();
    const out = $('serial-out');
    out.scrollTop = out.scrollHeight;
  }
}

function setSideOpen(open: boolean, remember = true) {
  sideOpen = open;
  if (remember) {
    try {
      localStorage.setItem(SIDE_KEY, open ? '1' : '0');
    } catch {
      /* optional */
    }
  }
  applySide();
}

function setMode(m: 'parts' | 'code') {
  mode = m;
  if (!sideOpen) setSideOpen(true);
  else applySide();
}

function initSide() {
  try {
    const v = localStorage.getItem(SIDE_KEY);
    sideOpen = v === null ? !narrow.matches : v === '1';
  } catch {
    sideOpen = !narrow.matches;
  }
  $('btn-side').onclick = () => setSideOpen(!sideOpen);
  panel = new ComponentsPanel($('panel-parts'), {
    add: (type) => {
      if (workspace.running) return;
      void workspace.addPart(type);
      // On small screens the sheet covers the canvas: get out of the way.
      if (narrow.matches) setSideOpen(false, false);
    },
  });
  applySide();
}

// ───────────────────────────── inspector ─────────────────────────────

const INSPECTOR_COLORS = WIRE_PALETTE.filter(([, c]) => c) as Array<[string, string]>;

function renderInspector(sel: Selection) {
  const box = $('inspector');
  box.replaceChildren();
  box.hidden = !sel;
  if (!sel) return;
  const disabled = workspace.running;
  const close = el('button', { className: 'icon-btn small close', title: 'Close', onclick: () => (box.hidden = true) });
  close.innerHTML = icon('close', 16);
  close.setAttribute('aria-label', 'Close inspector');

  if (sel.kind === 'part') {
    const part = project.diagram.parts.find((p) => p.id === sel.id);
    if (!part) return;
    const ui = partUIs.get(part.type);
    const m = ui?.manifest;
    box.append(el('div', { className: 'insp-head' }, el('h4', {}, el('span', {}, part.id), el('small', {}, m?.name ?? part.type)), close));
    const props = propsOf(part, ui);
    for (const [key, spec] of Object.entries(m?.props ?? {})) {
      if (spec.type === 'number' && spec.min !== undefined && spec.max !== undefined) {
        // −/+ stepper, e.g. number of batteries in series
        const value = Number(props[key]);
        const step = spec.step ?? 1;
        const set = (v: number) => {
          workspace.setPartAttr(part.id, key, String(Math.min(spec.max!, Math.max(spec.min!, v))));
          renderInspector(workspace.selection);
        };
        const less = el('button', { type: 'button', className: 'step-btn', textContent: '−', disabled: disabled || value <= spec.min, onclick: () => set(value - step) });
        less.setAttribute('aria-label', `Fewer (${spec.label ?? key})`);
        const more = el('button', { type: 'button', className: 'step-btn', textContent: '+', disabled: disabled || value >= spec.max, onclick: () => set(value + step) });
        more.setAttribute('aria-label', `More (${spec.label ?? key})`);
        const out = el('output', { className: 'step-value', textContent: String(value) });
        box.append(el('div', { className: 'field' }, el('span', {}, spec.label ?? key), el('div', { className: 'stepper', title: 'Tip: select the part and press + or −' }, less, out, more)));
        continue;
      }
      let input: HTMLInputElement | HTMLSelectElement;
      if (spec.type === 'select') {
        input = el('select', { disabled });
        for (const opt of spec.options ?? []) input.append(el('option', { value: opt, textContent: opt }));
      } else {
        input = el('input', { type: spec.type === 'number' ? 'number' : 'text', disabled });
      }
      input.value = String(props[key]);
      input.onchange = () => workspace.setPartAttr(part.id, key, input.value);
      box.append(el('label', {}, el('span', {}, spec.label ?? key), input));
    }
    if (m?.description) box.append(el('p', {}, m.description));
    if (m?.mcu) box.append(el('p', { className: 'mono' }, m.mcu.fqbn));
    const row = el('div', { className: 'row' });
    const rotate = el('button', { className: 'btn small', disabled, onclick: () => workspace.rotateSelection() });
    rotate.innerHTML = icon('rotate', 15) + 'Rotate';
    const del = el('button', { className: 'btn small danger', disabled, onclick: () => workspace.deleteSelection() });
    del.innerHTML = icon('trash', 15) + 'Delete';
    row.append(rotate, del);
    box.append(row);
    if (m?.mcu) {
      const edit = el('button', {
        className: 'btn small block',
        onclick: () => {
          setActiveMcu(part.id);
          setMode('code');
        },
      });
      edit.innerHTML = icon('code', 15) + 'Edit code';
      box.append(el('div', { className: 'row' }, edit));
    }
  } else {
    const c = project.diagram.connections[sel.index];
    if (!c) return;
    box.append(el('div', { className: 'insp-head' }, el('h4', {}, el('span', {}, 'Wire')), close));
    box.append(el('p', { className: 'mono' }, `${c[0]} → ${c[1]}`));
    const sw = el('div', { className: 'insp-swatches', role: 'radiogroup' });
    sw.setAttribute('aria-label', 'Wire colour');
    for (const [label, color] of INSPECTOR_COLORS) {
      const b = el('button', { className: 'swatch-item', title: label, disabled });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-checked', String(c[2] === color));
      const s = el('span', { className: 'swatch' });
      s.style.background = color;
      b.append(s);
      b.onclick = () => {
        workspace.setWireColor(sel.index, color);
        renderInspector(workspace.selection);
      };
      sw.append(b);
    }
    box.append(el('label', {}, el('span', {}, 'Colour')), sw);
    const del = el('button', { className: 'btn small danger block', disabled, onclick: () => workspace.deleteSelection() });
    del.innerHTML = icon('trash', 15) + 'Delete wire';
    box.append(el('div', { className: 'row' }, del));
  }
}

// ───────────────────────────── code editor + serial ─────────────────────────────

const code = $<HTMLTextAreaElement>('code');
const gutter = $('gutter');

function updateGutter() {
  const lines = code.value.split('\n').length;
  let s = '';
  for (let i = 1; i <= lines; i++) s += i + '\n';
  gutter.textContent = s;
  gutter.scrollTop = code.scrollTop;
}

function renderTabs() {
  const tabs = $('mcu-tabs');
  tabs.replaceChildren();
  const mcus = mcuParts();
  if (!mcus.length) tabs.append(el('span', { className: 'empty' }, 'Add a microcontroller to write code'));
  for (const p of mcus) {
    const b = el('button', { className: 'tab', textContent: `${p.id}.ino`, onclick: () => setActiveMcu(p.id) });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(p.id === activeMcu));
    b.classList.toggle('active', p.id === activeMcu);
    tabs.append(b);
  }
  code.disabled = !activeMcu;
  code.value = activeMcu ? project.sketches[activeMcu] ?? '' : '';
  updateGutter();
  const override = !!(activeMcu && hexOverride[activeMcu]);
  $('fw-badge').hidden = !override;
  $('btn-clear-hex').hidden = !override;
  $<HTMLButtonElement>('btn-load-hex').disabled = !activeMcu;
  renderSerial();
}

function setActiveMcu(id: string) {
  activeMcu = id;
  renderTabs();
  renderInspector(workspace.selection);
}

function renderSerial() {
  const out = $('serial-out');
  const nearBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  out.textContent = activeMcu ? serial[activeMcu] ?? '' : '';
  if (nearBottom) out.scrollTop = out.scrollHeight;
  $('serial-target').textContent = activeMcu ? activeMcu : '';
}

function initEditor() {
  code.addEventListener('input', () => {
    if (!activeMcu) return;
    project.sketches[activeMcu] = code.value;
    updateGutter();
    persist();
  });
  code.addEventListener('scroll', () => (gutter.scrollTop = code.scrollTop));
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  });

  $('serial-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('serial-in');
    if (!activeMcu || !sim.running) return toast('Start the simulation to send serial data');
    sim.input(activeMcu, 'serial', input.value + '\n');
    input.value = '';
  });
  $('btn-clear-serial').onclick = () => {
    if (activeMcu) serial[activeMcu] = '';
    renderSerial();
  };

  const hexInput = $<HTMLInputElement>('file-hex');
  $('btn-load-hex').onclick = () => hexInput.click();
  hexInput.onchange = async () => {
    const f = hexInput.files?.[0];
    hexInput.value = '';
    if (!f || !activeMcu) return;
    const text = await f.text();
    if (!text.trimStart().startsWith(':')) return toast('That does not look like an Intel HEX file', true);
    hexOverride[activeMcu] = text;
    renderTabs();
    toast(`${activeMcu} will run ${f.name}`);
  };
  $('btn-clear-hex').onclick = () => {
    if (activeMcu) delete hexOverride[activeMcu];
    renderTabs();
  };
}

// ───────────────────────────── run / stop ─────────────────────────────

function setLog(text: string, error: boolean) {
  $('log').textContent = text;
  const box = $<HTMLDetailsElement>('log-box');
  box.classList.toggle('error', error);
  if (error) box.open = true;
}

async function run() {
  if (sim.running || compiling) return;
  compiling = true;
  updateRunButton();
  const firmware: Record<string, string> = {};
  const logs: string[] = [];
  try {
    for (const p of mcuParts()) {
      if (hexOverride[p.id]) {
        firmware[p.id] = hexOverride[p.id];
        logs.push(`── ${p.id}: using loaded .hex`);
        continue;
      }
      const fqbn = partUIs.get(p.type)!.manifest.mcu!.fqbn;
      simStatus.textContent = `Compiling ${p.id}…`;
      const r = await compile(fqbn, project.sketches[p.id] ?? '');
      logs.push(`── ${p.id} (${fqbn})\n${r.log.trim()}`);
      if (!r.ok || !r.hex) {
        setLog(logs.join('\n\n'), true);
        simStatus.textContent = 'Compile failed';
        if (/was not found|not reachable|no compiler service/i.test(r.log)) {
          toast(
            `${p.id}'s code needs the Arduino compiler, which isn't installed yet. Install it once: "brew install arduino-cli", then "npm run setup". Examples and unchanged starter sketches run without it.`,
            true,
          );
        } else {
          toast(`Could not compile ${p.id}. See "Compiler output" in Code.`, true);
        }
        return;
      }
      firmware[p.id] = r.hex;
    }
    setLog(logs.join('\n\n') || 'No microcontrollers in this circuit.', false);
    for (const id of Object.keys(serial)) serial[id] = '';
    renderSerial();
    shownWarnings.clear();
    workspace.setRunning(true);
    renderInspector(workspace.selection);
    // Simulate the drawn wires plus implicit connections (e.g. parts plugged into a breadboard).
    sim.start({ ...structuredClone(project.diagram), connections: workspace.connectionsForSimulation() }, firmware);
    simStatus.textContent = 'Running';
    document.body.classList.add('sim-running');
  } finally {
    compiling = false;
    updateRunButton();
    updateToolbar();
  }
}

function stop() {
  sim.stop();
  workspace.setRunning(false);
  renderInspector(workspace.selection);
  simStatus.textContent = 'Stopped';
  document.body.classList.remove('sim-running');
  updateRunButton();
  updateToolbar();
}

sim.onSnapshot = (snap, speed) => {
  workspace.applyStates(snap.states);
  let touched = false;
  for (const e of snap.events) {
    if (e.event !== 'serial') continue;
    const buf = (serial[e.part] ?? '') + String(e.data);
    serial[e.part] = buf.length > SERIAL_LIMIT ? buf.slice(-SERIAL_LIMIT) : buf;
    if (e.part === activeMcu) touched = true;
  }
  if (touched) renderSerial();
  for (const w of snap.warnings) {
    if (!shownWarnings.has(w)) {
      shownWarnings.add(w);
      toast(w, true);
    }
  }
  simStatus.textContent = `${(snap.timeNs / 1e9).toFixed(2)} s · ${Math.round(speed * 100)}% speed`;
};
sim.onError = (msg) => {
  stop();
  toast(`Simulation error: ${msg}`, true);
};

async function checkCompiler() {
  const pill = $('compiler-status');
  const h = await health();
  pill.className = 'pill ' + (h?.ready ? 'ok' : 'warn');
  if (!h) {
    pill.textContent = 'Compiler: unavailable';
    pill.title = 'No local compile service. Run Axion with "npm run dev" or "npm start". Examples and .hex files still work.';
  } else if (!h.arduinoCli) {
    pill.textContent = 'Compiler: arduino-cli missing';
    pill.title = 'Install arduino-cli, then run "npm run setup". Examples and .hex files still work.';
  } else if (!h.ready) {
    pill.textContent = 'Compiler: AVR core missing';
    pill.title = 'Run "npm run setup" to install the Arduino AVR core (one-time download).';
  } else {
    pill.textContent = 'Compiler: ready';
    pill.title = h.arduinoCli;
  }
}

// ───────────────────────────── boot ─────────────────────────────

async function boot() {
  hydrateIcons();
  initTooltips();
  initToolbar();
  initSide();
  initEditor();
  updateRunButton();
  updateToolbar();
  let saved: Project | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = parseProject(JSON.parse(raw));
  } catch {
    saved = null;
  }
  const first = examples.find((e) => e.key === 'blink-button') ?? examples[0];
  await loadProject(saved ?? first?.project ?? project);
  void checkCompiler();
}

void boot();
