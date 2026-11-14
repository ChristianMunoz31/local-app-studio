// The Preview hot swap (ADR-019, first built as the phase 32 spike): a save that changes nothing the child reads (layout, theme,
// nav, menu) keeps the running child; anything else, or any doubt, restarts it as before. previewChildView.test.js guards the
// view against what the child's routes read.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPreviewManager } from '../../studio/preview/manager.js';
import { scratchDirFor } from '../../studio/preview/paths.js';
import { writeSpecFile } from '../../studio/preview/scratch.js';
import { childView } from '../../studio/preview/swap.js';

const FAKE = fileURLToPath(new URL('./fixtures/fakePreviewChild.mjs', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../../../public/examples/job-tracker.spec.json', import.meta.url));
const baseSpec = () => JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
const realSpawn = (await import('node:child_process')).spawn;

let root;
const managers = [];
const pids = new Set();
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-swap-'));
});
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.stop()));
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
  pids.clear();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const until = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return cond();
};

function make(opts = {}) {
  const spawned = [];
  const spawn = vi.fn((...args) => {
    const child = realSpawn(...args);
    spawned.push(child);
    pids.add(child.pid);
    return child;
  });
  const manager = createPreviewManager({
    rootDir: root,
    spawn,
    spawnSpec: () => ({ command: process.execPath, args: [FAKE, ''] }),
    startTimeoutMs: 8000,
    stopTimeoutMs: 1000,
    hotSwap: true,
    ...opts,
  });
  managers.push(manager);
  return { manager, spawned, spawn };
}

/** Changes that touch only what Studio draws. */
const uiOnly = {
  theme: (s) => ({ ...s, theme: { preset: 'forest', radius: 'lg', id: 'forest' } }),
  nav: (s) => ({ ...s, nav: [...s.nav].reverse().map((n) => ({ ...n, label: `${n.label} list` })) }),
  menu: (s) => ({ ...s, menu: { position: 'side', style: 'icons-and-labels' } }),
  layout: (s) => ({
    ...s,
    pages: s.pages.map((p, i) => (i === 0 ? { ...p, title: 'Start here', layout: { ...p.layout, children: [...p.layout.children].reverse() } } : p)),
  }),
};

/** Changes the child reads. */
const childChanges = {
  'a new field': (s) => ({ ...s, tables: s.tables.map((t, i) => (i === 0 ? { ...t, fields: [...t.fields, { id: 'notes_x', label: 'Notes x', type: 'text' }] } : t)) }),
  'a source sort': (s) => ({
    ...s,
    pages: s.pages.map((p) => (p.id === 'jobs' ? { ...p, sources: [{ ...p.sources[0], orderBy: [{ field: 'due', dir: 'desc' }] }] } : p)),
  }),
  'a new page with a source': (s) => ({ ...s, pages: [...s.pages, { ...s.pages[1], id: 'jobs_two' }] }),
  'the app name': (s) => ({ ...s, app: { ...s.app, name: 'Job Board' } }),
};

describe('childView (what the preview child reads)', () => {
  it.each(Object.entries(uiOnly))('a %s change gives the same view', (_name, change) => {
    const spec = baseSpec();
    expect(childView(spec)).toMatch(/^[0-9a-f]{64}$/);
    expect(childView(change(spec))).toBe(childView(spec));
  });

  it.each(Object.entries(childChanges))('%s gives another view', (_name, change) => {
    const spec = baseSpec();
    expect(childView(change(spec))).not.toBe(childView(spec));
  });

  it('is null for a spec it cannot compile', () => {
    expect(childView({ tables: 'not a list' })).toBeNull();
  });
});

describe('preview manager hot swap', () => {
  const app = (spec, revision) => ({ id: crypto.randomUUID(), spec, revision });

  it.each(Object.entries(uiOnly))('keeps the running child for a %s change and moves the revision', async (_name, change) => {
    const { manager, spawn, spawned } = make();
    const a = app(baseSpec(), 1);
    await manager.start(a);
    const before = manager.target();
    const startedAt = manager.status().startedAt;
    const next = change(a.spec);
    manager.specSaved({ ...a, spec: next, revision: 2 });
    expect(manager.status()).toMatchObject({ state: 'running', appId: a.id, revision: 2, startedAt });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawned[0].exitCode).toBeNull();
    expect(manager.target()).toEqual(before);
    // The scratch folder's spec file follows, so a later restart and the backup worker read the saved design.
    const file = path.join(scratchDirFor(root, a.id), 'app-spec.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(next);
  });

  it.each(Object.entries(childChanges))('restarts the child for %s', async (_name, change) => {
    const { manager, spawn } = make();
    const a = app(baseSpec(), 1);
    await manager.start(a);
    manager.specSaved({ ...a, spec: change(a.spec), revision: 2 });
    expect(await until(() => spawn.mock.calls.length === 2 && manager.status().state === 'running' && manager.status().revision === 2)).toBe(true);
  });

  it('restarts when the spec file cannot be written (the fallback)', async () => {
    const { manager, spawn } = make();
    const a = app(baseSpec(), 1);
    await manager.start(a);
    const file = path.join(scratchDirFor(root, a.id), 'app-spec.json');
    fs.rmSync(file);
    fs.mkdirSync(path.join(file, 'blocker'), { recursive: true });
    manager.specSaved({ ...a, spec: uiOnly.theme(a.spec), revision: 2 });
    expect(manager.status().state).toBe('starting');
    // The restart cannot write the file either, so it fails the way a start fails today; it never claims the swap.
    expect(await until(() => manager.status().state !== 'starting')).toBe(true);
    expect(manager.status().state).toBe('failed');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('restarts while a start is still on its way', async () => {
    const { manager, spawn } = make();
    const a = app(baseSpec(), 1);
    const first = manager.start(a);
    manager.specSaved({ ...a, spec: uiOnly.theme(a.spec), revision: 2 });
    await first;
    expect(await until(() => manager.status().state === 'running' && manager.status().revision === 2)).toBe(true);
    expect(spawn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('never swaps an older or equal revision', async () => {
    const { manager, spawn } = make();
    const a = app(baseSpec(), 3);
    await manager.start(a);
    manager.specSaved({ ...a, spec: uiOnly.theme(a.spec), revision: 3 });
    expect(await until(() => spawn.mock.calls.length === 2 && manager.status().state === 'running')).toBe(true);
  });

  it('is off unless asked for: the default manager restarts on every save', async () => {
    const { manager, spawn } = make({ hotSwap: false });
    const a = app(baseSpec(), 1);
    await manager.start(a);
    manager.specSaved({ ...a, spec: uiOnly.theme(a.spec), revision: 2 });
    expect(await until(() => spawn.mock.calls.length === 2 && manager.status().state === 'running' && manager.status().revision === 2)).toBe(true);
  });
});

describe('the view on this base (phase 31 parts)', () => {
  const jobPage = (s, change) => ({ ...s, pages: s.pages.map((p) => (p.id === 'job' ? change(p) : p)) });
  const addToFirstPage = (s, ...layers) => ({
    ...s,
    pages: s.pages.map((p, i) => (i === 0 ? { ...p, layout: { ...p.layout, children: [...p.layout.children, ...layers] } } : p)),
  });

  it('a record page route gives another view: global search reads it to pick the tables it searches and the page a hit opens', () => {
    const spec = baseSpec();
    expect(childView(jobPage(spec, (p) => ({ ...p, route: '/jobs/one' })))).not.toBe(childView(spec));
  });

  it('a page order change gives another view: global search opens a hit on the first record page of its table', () => {
    const spec = baseSpec();
    expect(childView({ ...spec, pages: [...spec.pages].reverse() })).not.toBe(childView(spec));
  });

  it('a sort control on a field with no index gives another view (a derived index, ADR-014)', () => {
    const spec = baseSpec();
    const sort = { id: 'sort_x', type: 'SortControl', props: { source: 'jobs_all', fields: ['client'] }, children: [] };
    expect(childView(addToFirstPage(spec, sort))).not.toBe(childView(spec));
  });

  it('a new features list gives another view; with the list unchanged, moving a Kanban and a Global search does not', () => {
    const spec = baseSpec();
    const kanban = { id: 'kanban_x', type: 'Kanban', props: { source: 'jobs_all', field: 'status' }, children: [] };
    const search = { id: 'search_x', type: 'GlobalSearch', props: {}, children: [] };
    const withParts = { ...addToFirstPage(spec, kanban, search), features: ['global-search', 'kanban-boards'] };
    expect(childView(withParts)).not.toBe(childView(spec));
    const moved = { ...addToFirstPage(spec, search, kanban), features: ['global-search', 'kanban-boards'] };
    expect(childView(moved)).toBe(childView(withParts));
  });

  it('a table edit setting keeps the view: the server does not read it (ADR-017, the write is the form update)', () => {
    const spec = { ...baseSpec(), features: ['table-inline-edit'] };
    const table = (edit) => ({ id: 'table_x', type: 'DataTable', props: { source: 'jobs_all', edit }, children: [] });
    expect(childView(addToFirstPage(spec, table('cells')))).toBe(childView(addToFirstPage(spec, table('off'))));
  });

  it('is null for a spec the child would refuse at start (an unknown layer key), so the save restarts and the start reports it', () => {
    const spec = baseSpec();
    expect(childView(addToFirstPage(spec, { id: 'odd', type: 'Text', props: {}, children: 'x', glow: true }))).toBeNull();
  });
});

describe('the spec file write', () => {
  it('replaces the file whole and leaves no temp file, also when the rename fails', () => {
    const dir = scratchDirFor(root, crypto.randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    writeSpecFile(dir, { a: 1 }, root);
    writeSpecFile(dir, { a: 2 }, root);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'app-spec.json'), 'utf8'))).toEqual({ a: 2 });
    expect(fs.readdirSync(dir)).toEqual(['app-spec.json']);
    fs.rmSync(path.join(dir, 'app-spec.json'));
    fs.mkdirSync(path.join(dir, 'app-spec.json', 'blocker'), { recursive: true });
    expect(() => writeSpecFile(dir, { a: 3 }, root)).toThrow();
    expect(fs.readdirSync(dir)).toEqual(['app-spec.json']);
  });

  it('a start removes a temp spec file a stopped Studio left between the write and the rename', async () => {
    const { manager } = make();
    const a = { id: crypto.randomUUID(), spec: baseSpec(), revision: 1 };
    const dir = scratchDirFor(root, a.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'app-spec.json.123.abcd1234.tmp'), '{');
    await manager.start(a);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a folder outside the preview root', () => {
    expect(() => writeSpecFile(path.join(os.tmpdir(), 'las-elsewhere'), { a: 1 }, root)).toThrow(TypeError);
  });
});

describe('preview manager hot swap, races', () => {
  const app = (spec, revision) => ({ id: crypto.randomUUID(), spec, revision });

  it('restarts a save that arrives while Reset preview data is on its way', async () => {
    const { manager, spawn } = make();
    const a = app(baseSpec(), 1);
    await manager.start(a);
    const reset = manager.resetData(a);
    manager.specSaved({ ...a, spec: uiOnly.theme(a.spec), revision: 2 });
    await reset;
    expect(await until(() => manager.status().state === 'running' && manager.status().revision === 2)).toBe(true);
    expect(spawn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the child over two Studio-only saves; a data save after them restarts it from the latest design', async () => {
    const { manager, spawn } = make();
    const a = app(baseSpec(), 1);
    await manager.start(a);
    const s2 = uiOnly.theme(a.spec);
    const s3 = uiOnly.layout(s2);
    manager.specSaved({ ...a, spec: s2, revision: 2 });
    manager.specSaved({ ...a, spec: s3, revision: 3 });
    expect(manager.status()).toMatchObject({ state: 'running', revision: 3 });
    expect(spawn).toHaveBeenCalledTimes(1);
    const s4 = childChanges['a new field'](s3);
    manager.specSaved({ ...a, spec: s4, revision: 4 });
    expect(await until(() => spawn.mock.calls.length === 2 && manager.status().state === 'running' && manager.status().revision === 4)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(scratchDirFor(root, a.id), 'app-spec.json'), 'utf8'))).toEqual(s4);
  });

  it('a swap clears the data note of the last start, as a restart with the same tables would', async () => {
    const { manager } = make();
    const a = app(baseSpec(), 1);
    await manager.start(a);
    manager.specSaved({ ...a, spec: childChanges['a new field'](a.spec), revision: 2 });
    expect(await until(() => manager.status().state === 'running' && manager.status().revision === 2)).toBe(true);
    expect(manager.status().data).toMatchObject({ kept: true, reason: 'tables_updated' });
    manager.specSaved({ ...a, spec: uiOnly.theme(childChanges['a new field'](a.spec)), revision: 3 });
    expect(manager.status()).toMatchObject({ state: 'running', revision: 3, data: { kept: true, reason: 'unchanged' } });
  });

  it('compares a save with what the running child read at start, not with the design of the last swap', async () => {
    const { manager, spawn } = make();
    const a = app(baseSpec(), 1);
    await manager.start(a);
    manager.specSaved({ ...a, spec: uiOnly.theme(a.spec), revision: 2 });
    const s3 = childChanges['a source sort'](a.spec);
    manager.specSaved({ ...a, spec: s3, revision: 3 });
    expect(await until(() => spawn.mock.calls.length === 2 && manager.status().state === 'running' && manager.status().revision === 3)).toBe(true);
  });

  it('never swaps a save that arrives while Stop is ending the child', async () => {
    const { manager, spawn, spawned } = make();
    const a = app(baseSpec(), 1);
    await manager.start(a);
    const stopping = manager.stop();
    manager.specSaved({ ...a, spec: uiOnly.theme(a.spec), revision: 2 });
    await stopping;
    // The first child is ended either way; the save goes the restart way (as before the swap), never onto the ending child.
    expect(await until(() => spawned[0].exitCode !== null || spawned[0].signalCode !== null)).toBe(true);
    expect(await until(() => spawn.mock.calls.length === 2 && manager.status().state === 'running' && manager.status().revision === 2)).toBe(true);
  });
});
