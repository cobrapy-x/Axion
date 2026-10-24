// SPDX-License-Identifier: Apache-2.0
import './styles.css';
import { parseProject, type DiagramPart, type Project } from './core/diagram';
import { partUIs } from './core/parts-views';
import { Workspace, propsOf, type Selection } from './editor/workspace';
import { SimClient } from './sim/client';
import { addPrebuilt, compile, health } from './ui/compiler';
import { examples } from './ui/examples';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STORAGE_KEY = 'axion.project.v1';
const SERIAL_LIMIT = 100_000;

// ───────────────────────────── state ─────────────────────────────

let project: Project = { format: 'axion-project', version: 1, name: 'Untitled', diagram: { version: 1, parts: [], connections: [] }, sketches: {} };
let activeMcu: string | null = null;
const hexOverride: Record<string, string> = {};
const serial: Record<string, string> = {};
const shownWarnings = new Set<string>();

const sim = new SimClient();
const workspace = new Workspace($('workspace'), {
  change: () => {
    syncSketches();
    persist();
  },
  select: renderInspector,
  input: (part, event, data) => sim.input(part, event, data),
});

// ───────────────────────────── helpers ─────────────────────────────

let toastTimer = 0;
function toast(msg: string, error = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), error ? 7000 : 3500);
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
}

function initExamples() {
  const sel = $<HTMLSelectElement>('sel-example');
  for (const ex of examples) {
    const o = document.createElement('option');
    o.value = ex.key;
    o.textContent = ex.name;
    o.title = ex.description ?? '';
    sel.append(o);
    for (const [mcu, hex] of Object.entries(ex.prebuilt)) {
      const part = ex.project.diagram.parts.find((p) => p.id === mcu);
      const fqbn = part && partUIs.get(part.type)?.manifest.mcu?.fqbn;
      if (fqbn) void addPrebuilt(fqbn, ex.project.sketches[mcu], hex);
    }
  }
  sel.onchange = () => {
    const ex = examples.find((e) => e.key === sel.value);
    sel.value = '';
    if (ex && confirmDiscard()) void loadProject(ex.project).then(() => toast(`Loaded example: ${ex.name}`));
  };
}

const confirmDiscard = () => project.diagram.parts.length === 0 || confirm('Replace the current circuit? (Use Save first to keep it.)');

// ───────────────────────────── palette ─────────────────────────────

function renderPalette() {
  const root = $('palette');
  const byCat = new Map<string, string[]>();
  for (const [type, ui] of partUIs) {
    const list = byCat.get(ui.manifest.category) ?? [];
    list.push(type);
    byCat.set(ui.manifest.category, list);
  }
  for (const [cat, types] of [...byCat].sort()) {
    const h = document.createElement('h3');
    h.textContent = cat;
    root.append(h);
    for (const type of types) {
      const m = partUIs.get(type)!.manifest;
      const b = document.createElement('button');
      b.className = 'item';
      b.draggable = true;
      b.title = m.description ?? m.name;
      b.innerHTML = `${m.name}<small>${m.type}</small>`;
      b.onclick = () => !workspace.running && void workspace.addPart(type);
      b.ondragstart = (e) => e.dataTransfer?.setData('application/x-axion-part', type);
      root.append(b);
    }
  }
}

// ───────────────────────────── inspector ─────────────────────────────

const WIRE_COLORS = ['green', 'red', 'black', 'blue', 'orange', 'yellow', 'purple', 'gray', 'white', 'brown', 'cyan', 'magenta', 'limegreen', 'gold'];

function renderInspector(sel: Selection) {
  const box = $('inspector');
  box.replaceChildren();
  box.hidden = !sel;
  if (!sel) return;
  const disabled = workspace.running;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
    const e: HTMLElementTagNameMap[K] = document.createElement(tag);
    Object.assign(e, props);
    e.append(...kids);
    return e;
  };

  if (sel.kind === 'part') {
    const part = project.diagram.parts.find((p) => p.id === sel.id);
    if (!part) return;
    const ui = partUIs.get(part.type);
    const m = ui?.manifest;
    box.append(el('h4', {}, `${part.id} `, el('small', {}, m?.name ?? part.type)));
    const props = propsOf(part, ui);
    for (const [key, spec] of Object.entries(m?.props ?? {})) {
      let input: HTMLInputElement | HTMLSelectElement;
      if (spec.type === 'select') {
        input = el('select', { disabled });
        for (const opt of spec.options ?? []) input.append(el('option', { value: opt, textContent: opt }));
      } else {
        input = el('input', { type: spec.type === 'number' ? 'number' : 'text', disabled });
      }
      input.value = String(props[key]);
      input.onchange = () => workspace.setPartAttr(part.id, key, input.value);
      box.append(el('label', {}, spec.label ?? key, input));
    }
    if (m?.description) box.append(el('p', {}, m.description));
    if (m?.mcu) {
      box.append(el('p', {}, `Board: ${m.mcu.fqbn}`));
    }
    const rotate = el('button', { textContent: 'Rotate (R)', disabled, onclick: () => workspace.rotateSelection() });
    const del = el('button', { textContent: 'Delete', className: 'danger', disabled, onclick: () => workspace.deleteSelection() });
    box.append(el('div', { className: 'row' }, rotate, del));
    if (m?.mcu && activeMcu !== part.id) {
      box.append(el('div', { className: 'row' }, el('button', { textContent: 'Edit code', onclick: () => setActiveMcu(part.id) })));
    }
  } else {
    const c = project.diagram.connections[sel.index];
    if (!c) return;
    box.append(el('h4', {}, 'Wire'), el('p', {}, `${c[0]} → ${c[1]}`));
    const color = el('select', { disabled });
    for (const opt of WIRE_COLORS) color.append(el('option', { value: opt, textContent: opt }));
    if (!WIRE_COLORS.includes(c[2])) color.append(el('option', { value: c[2], textContent: c[2] }));
    color.value = c[2];
    color.onchange = () => workspace.setWireColor(sel.index, color.value);
    box.append(el('label', {}, 'Color', color));
    box.append(el('div', { className: 'row' }, el('button', { textContent: 'Delete', className: 'danger', disabled, onclick: () => workspace.deleteSelection() })));
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
  if (!mcus.length) {
    const s = document.createElement('span');
    s.className = 'empty';
    s.textContent = 'Add a microcontroller to write code';
    tabs.append(s);
  }
  for (const p of mcus) {
    const b = document.createElement('button');
    b.textContent = `${p.id}.ino`;
    b.classList.toggle('active', p.id === activeMcu);
    b.onclick = () => setActiveMcu(p.id);
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
  $('serial-target').textContent = activeMcu ? `(${activeMcu})` : '';
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

const runBtn = $<HTMLButtonElement>('btn-run');
const stopBtn = $<HTMLButtonElement>('btn-stop');
const simStatus = $('sim-status');

function setLog(text: string, error: boolean) {
  $('log').textContent = text;
  const box = $<HTMLDetailsElement>('log-box');
  box.classList.toggle('error', error);
  if (error) box.open = true;
}

async function run() {
  if (sim.running || runBtn.disabled) return;
  runBtn.disabled = true;
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
        toast(`Could not compile ${p.id}. See "Compiler output".`, true);
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
    sim.start(structuredClone(project.diagram), firmware);
    stopBtn.disabled = false;
    simStatus.textContent = 'Running';
  } finally {
    if (!sim.running) runBtn.disabled = false;
  }
}

function stop() {
  sim.stop();
  workspace.setRunning(false);
  renderInspector(workspace.selection);
  runBtn.disabled = false;
  stopBtn.disabled = true;
  simStatus.textContent = 'Stopped';
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

// ───────────────────────────── toolbar ─────────────────────────────

function initToolbar() {
  runBtn.onclick = () => void run();
  stopBtn.onclick = stop;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
      e.preventDefault();
      if (sim.running) stop();
      else void run();
    }
  });
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
  $('btn-zoom-in').onclick = () => workspace.zoomBy(1.2);
  $('btn-zoom-out').onclick = () => workspace.zoomBy(1 / 1.2);
  $('btn-fit').onclick = () => workspace.fit();
}

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
  renderPalette();
  initExamples();
  initEditor();
  initToolbar();
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
