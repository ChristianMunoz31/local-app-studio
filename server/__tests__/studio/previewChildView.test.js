// The guard of the Preview hot swap (ADR-019): the hash the manager compares (swap.js childView) must cover every part of the
// spec the preview child reads. A false "unchanged" would leave the child serving an old spec, so this file checks it from both
// ends:
// 1. every module of the server that imports the spec source is listed below with how its reads are covered, so a new reader
//    fails here until someone looks at what it reads;
// 2. the child's data routes run over a spec wrapped in a recorder, and every part they read must be outside the Studio-only
//    parts, and changing it must change the view.
// The spec is the Job Tracker example with a numbered field, a rule and a record page, so the write, rule, numbering, search and
// record page paths all run.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'examples', 'job-tracker.spec.json'), 'utf8'));
  const jobs = spec.tables.find((t) => t.id === 'jobs');
  jobs.fields.push({ id: 'ref', label: 'Ref', type: 'text', autoNumber: { prefix: 'J-', width: 3 } });
  jobs.rules = [{ when: { field: 'status', is: 'Done' }, then: [{ set: 'due', to: 'today' }] }];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-childview-'));
  const file = path.join(dir, 'app-spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_CHILDVIEW_DIR = dir;
});

/** What the child's code read through getAppSpec(), as paths like `pages[].sources[].table`. */
const recorded = vi.hoisted(() => ({ paths: new Set() }));

vi.mock('../../spec/source.js', async (importOriginal) => {
  const real = await importOriginal();
  const proxies = new WeakMap();
  const seg = (key) => (/^\d+$/.test(key) ? '[]' : `.${key}`);
  const wrap = (target, at) => {
    if (target === null || typeof target !== 'object') return target;
    if (proxies.has(target)) return proxies.get(target);
    const note = (key) => {
      if (typeof key !== 'string') return;
      if (Array.isArray(target) && !/^\d+$/.test(key)) return; // length and the array methods
      recorded.paths.add(`${at}${seg(key)}`.replace(/^\./, ''));
    };
    const proxy = new Proxy(target, {
      get(t, key, receiver) {
        note(key);
        const value = Reflect.get(t, key, receiver);
        return typeof key === 'string' && Object.hasOwn(t, key) ? wrap(value, `${at}${seg(key)}`) : value;
      },
      has(t, key) {
        note(key);
        return Reflect.has(t, key);
      },
      getOwnPropertyDescriptor(t, key) {
        note(key);
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
    });
    proxies.set(target, proxy);
    return proxy;
  };
  let spec;
  return {
    ...real,
    getAppSpec: () => {
      const plain = real.getAppSpec();
      if (plain === null) return null;
      spec ??= wrap(plain, '');
      return spec;
    },
  };
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';
import { normalizeSpec } from '../../spec/compile.js';
import { PREVIEW_PATH_PREFIXES } from '../../studio/preview/proxy.js';
import { STUDIO_ONLY, childView, childViewOf } from '../../studio/preview/swap.js';

vi.mock('../../../loadEnv.js', () => ({}));

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EXAMPLE = path.join(ROOT, 'public', 'examples', 'job-tracker.spec.json');

/**
 * Every server module that imports the spec source (server/spec/source.js), and how what it reads is covered. Add a new reader
 * here only after checking what it reads: data routes run below, compiled-only readers are covered because the whole compiled
 * spec is in the view, and Assistant readers are not reachable through the preview proxy (checked below).
 */
const SPEC_READERS = Object.freeze({
  'packages/runtime/server/routes.js': 'the data routes, run below',
  'packages/runtime/server/autoNumberStore.js': 'numbered fields of the tables, run below through POST and the CSV import',
  'server/import/importExport.js': 'the ZIP import reads the tables for the numbered fields (autoNumberStore, run below)',
  'server/db/migrate.js': 'compiled only: indexSql and ftsSql, both in the view',
  'server/modules/runtime.data.js': 'compiled only: tables, import order, foreign keys, data tables, in the view',
  'server/studio/preview/swap.js': 'Studio side: the view itself',
  'packages/runtime/server/assistantTools.js': 'the Assistant: not reachable through the preview proxy',
  'server/agents/assistantAgent.js': 'the Assistant: not reachable through the preview proxy',
  'server/agents/pendingActions.js': 'the Assistant: not reachable through the preview proxy',
  'server/agents/prompts.js': 'the Assistant: not reachable through the preview proxy',
});

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The server files the scans read: the server, the runtime routes, server.js and, in a pro checkout, pro/server. */
function serverFiles() {
  const pro = path.join(ROOT, 'pro', 'server');
  return [
    ...sourceFiles(path.join(ROOT, 'server')),
    ...sourceFiles(path.join(ROOT, 'packages', 'runtime', 'server')),
    ...(fs.existsSync(pro) ? sourceFiles(pro) : []),
    path.join(ROOT, 'server.js'),
  ];
}

/** Every server module that names APP_SPEC_PATH, and why that is not a second reader of the spec. */
const SPEC_PATH_NAMERS = Object.freeze({
  'server/spec/source.js': 'the one reader',
  'server/role.js': 'checks the preview role was given an absolute path',
  'server/entry.js': 'a comment on the preview role',
  'server/studio/preview/childEnv.js': 'sets it for the child',
  'server/backup/worker/client.js': 'passes it to the backup worker, which reads it through the spec source; the swap rewrites the file whole, with an equal view',
});

const STUDIO_ONLY_PATHS = [...STUDIO_ONLY.spec, ...STUDIO_ONLY.page.map((k) => `pages[].${k}`)];
const isStudioOnly = (p) => STUDIO_ONLY_PATHS.some((s) => p === s || p.startsWith(`${s}.`) || p.startsWith(`${s}[]`));

/** Applies `change` to every value at a recorded path (`[]` means every element); returns how many it changed. */
function changeAt(obj, segments, change) {
  if (obj === null || typeof obj !== 'object') return 0;
  const [head, ...rest] = segments;
  if (head === '[]') return Array.isArray(obj) ? obj.reduce((n, item, i) => n + (rest.length === 0 ? ((obj[i] = change(item)), 1) : changeAt(item, rest, change)), 0) : 0;
  if (!Object.hasOwn(obj, head)) return 0;
  if (rest.length === 0) {
    obj[head] = change(obj[head]);
    return 1;
  }
  return changeAt(obj[head], rest, change);
}
const splitPath = (p) => p.split(/\.|(?=\[\])/).flatMap((s) => (s.startsWith('[]') ? ['[]', ...(s.length > 2 ? [s.slice(2)] : [])] : [s])).filter(Boolean);
const bump = (v) => (typeof v === 'string' ? `${v}x` : typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : v === null ? 'x' : Array.isArray(v) ? [...v, v[0] ?? 'x'] : { ...v, zz: 1 });

let app;
let db;
beforeAll(async () => {
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  fs.rmSync(process.env.__TEST_CHILDVIEW_DIR, { recursive: true, force: true });
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
  delete process.env.__TEST_CHILDVIEW_DIR;
});

describe('who reads the spec in the preview child', () => {
  it('every module that imports the spec source is listed with how its reads are covered', () => {
    const readers = serverFiles()
      .filter((f) => /(from\s*|import\s*\(\s*)['"][^'"]*spec\/source(\.js)?['"]/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((f) => f !== 'server/spec/source.js')
      .sort();
    expect(readers).toEqual(Object.keys(SPEC_READERS).sort());
  });

  it('the preview proxy reaches the data routes only, so the Assistant readers never run for a preview', () => {
    expect([...PREVIEW_PATH_PREFIXES]).toEqual(['/data']);
  });

  it('only the known modules name the spec file path; none of them reads it apart from the spec source', () => {
    const named = serverFiles()
      .filter((f) => fs.readFileSync(f, 'utf8').includes('APP_SPEC_PATH'))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .sort();
    expect(named).toEqual(Object.keys(SPEC_PATH_NAMERS).sort());
  });

  it('the runtime data routes never name a Studio-only part of the spec', () => {
    const files = [...sourceFiles(path.join(ROOT, 'packages', 'runtime', 'server')), path.join(ROOT, 'server', 'db', 'query.js')];
    const names = [...STUDIO_ONLY.spec, ...STUDIO_ONLY.page].join('|');
    const hits = files.flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && new RegExp(String.raw`\.(${names})\b|\[['"](${names})['"]\]`).test(line))
        .map((line) => `${path.relative(ROOT, f)}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});

describe('what the child data routes read is in the view', () => {
  it('runs every data route and records the spec parts they read', async () => {
    const ok = (res) => {
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      return res.body.data;
    };
    ok(await request(app).get('/api/data'));
    const job = ok(await request(app).post('/api/data/jobs').send({ name: 'Roof repair', client: 'Ana Lima', status: 'Booked', price: 120 }));
    expect(job.ref).toBe('J-001');
    ok(await request(app).post('/api/data/steps').send({ name: 'Order tiles', job: job.id, done: false }));
    ok(await request(app).patch(`/api/data/jobs/${job.id}`).send({ status: 'Done' }));
    ok(await request(app).get(`/api/data/jobs/${job.id}`));
    ok(await request(app).get('/api/data/_search').query({ q: 'roof' }));
    const spec = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
    for (const page of spec.pages) {
      for (const source of page.sources ?? []) {
        if ((source.mode ?? 'list') !== 'list') continue;
        ok(await request(app).get(`/api/data/${source.table}`).query({ page: page.id, source: source.id, search: 'tile', sort: 'name:asc' }));
        ok(await request(app).get(`/api/data/${source.table}/stats`).query({ page: page.id, source: source.id }));
      }
    }
    ok(await request(app).get('/api/data/jobs/stats').query({ groupBy: 'status', measure: 'sum', field: 'price' }));
    ok(await request(app).post('/api/data/jobs/import').send({ csv: 'Name,Client,Status\nGutter,Bo Chen,Quoted', dryRun: true }));
    ok(await request(app).post('/api/data/jobs/import').send({ csv: 'Name,Client,Status\nGutter,Bo Chen,Done', dryRun: false, applyAutomations: true }));
    const step = ok(await request(app).post('/api/data/steps').send({ name: 'Clean up', job: job.id, done: true }));
    ok(await request(app).delete(`/api/data/steps/${step.id}`));
    // The step's job link is optional, so deleting the job clears it (the foreign key rule is read from the compiled spec).
    ok(await request(app).delete(`/api/data/jobs/${job.id}`));
    const { readAutoNumberStates, resyncAutoNumbers } = await import('@local-app-studio/runtime/server/autoNumberStore.js');
    resyncAutoNumbers({ before: readAutoNumberStates() });

    const paths = [...recorded.paths].sort();
    // The run reached the parts phase 31 added: the record page route that global search reads, and the rules and numbering.
    expect(paths).toEqual(expect.arrayContaining(['pages[].route', 'pages[].sources[].mode', 'tables[].rules', 'tables[].fields[].autoNumber']));
    expect(paths.filter(isStudioOnly)).toEqual([]);
  });

  it('changing any part the routes read changes the view (or makes the spec one the child refuses)', () => {
    // The paths are those of the normalized spec the child holds, defaults filled.
    const base = normalizeSpec(JSON.parse(fs.readFileSync(process.env.APP_SPEC_PATH, 'utf8')));
    const before = childView(base);
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    const unchanged = [];
    /** Paths whose change still gave a spec the child takes, and a different view: the real coverage check. */
    const validChanged = [];
    for (const p of recorded.paths) {
      const next = structuredClone(base);
      if (changeAt(next, splitPath(p), bump) === 0) continue;
      const after = childView(next);
      if (after === before) unchanged.push(p);
      else if (after !== null) validChanged.push(p);
    }
    expect(recorded.paths.size).toBeGreaterThan(10);
    expect(unchanged).toEqual([]);
    // A change the child refuses (null view) restarts too, but proves nothing about the view: these must change it while valid.
    expect(validChanged).toEqual(
      expect.arrayContaining(['app.name', 'pages[].route', 'pages[].sources[].limit', 'tables[].label', 'tables[].fields[].label', 'tables[].fields[].required']),
    );
  });
});

describe('the Studio-only parts', () => {
  it('are left out of the view and nothing else is', () => {
    const spec = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
    const view = childViewOf(spec);
    for (const key of STUDIO_ONLY.spec) expect(view).not.toHaveProperty(key);
    for (const page of view.pages) for (const key of STUDIO_ONLY.page) expect(page).not.toHaveProperty(key);
    expect(Object.keys(view).sort()).toEqual(['app', 'compiled', 'pages', 'specVersion', 'tables']);
    expect(Object.keys(view.pages[0]).sort()).toEqual(['id', 'route', 'sources']);
    expect(Object.keys(view.compiled).sort()).toEqual(
      ['categories', 'createSql', 'dataTables', 'foreignKeys', 'ftsSql', 'importOrder', 'indexSql', 'tables', 'titleFields', 'validators'].sort(),
    );
  });

  it('a new top-level or page key is in the view by default, so it restarts the child', () => {
    const spec = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
    const view = childViewOf({ ...spec, features: ['kanban-boards'] });
    expect(view.features).toEqual(['kanban-boards']);
  });
});
