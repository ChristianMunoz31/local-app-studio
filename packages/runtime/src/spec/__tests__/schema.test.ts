/* eslint-disable @typescript-eslint/no-explicit-any */
// Contract tests for AppSpec v1 (docs/APP_SPEC.md). Synthetic data only.
import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import * as S from '../schema.ts';

const { validateAppSpec, validateTables, formatIssues } = S;
type D = any;

const layer = (id: string, type = 'Text', children: D = [], props: D = {}): D => ({ id, type, props, children });
const page = (id: string, route: string, extra: D = {}): D => ({ id, title: id, route, sources: [], layout: layer(`root_${id}`, 'Page'), ...extra });

const spec = (): D => ({
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: 'Crews and their leads', icon: 'users' },
  tables: [
    { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
    {
      id: 'crews', label: 'Crews', titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'size', label: 'Size', type: 'integer', default: 1 },
        { id: 'lead_id', label: 'Lead', type: 'reference', table: 'people' },
        { id: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
      ],
    },
  ],
  pages: [
    {
      id: 'home', title: 'Home', route: '/',
      sources: [{
        id: 'open_crews', table: 'crews',
        where: [{ field: 'status', op: 'eq', value: 'active' }],
        orderBy: [{ field: 'name', dir: 'asc' }], limit: 50,
      }],
      layout: layer('root', 'Page', [
        layer('h1', 'Heading', 'Open crews', { size: 'lg' }),
        layer('t1', 'DataTable', [], { source: 'open_crews', columns: ['name', 'size', 'status'] }),
      ]),
    },
  ],
  nav: [{ pageId: 'home', label: 'Home', icon: 'home' }],
  theme: { preset: 'aurora', radius: 'md' },
});

const extraTable = (): D => ({
  id: 'tasks', label: 'Tasks',
  fields: [
    { id: 'done', label: 'Done', type: 'boolean' },
    { id: 'due', label: 'Due', type: 'date' },
    { id: 'at', label: 'At', type: 'datetime' },
    { id: 'score', label: 'Score', type: 'real' },
    { id: 'crew', label: 'Crew', type: 'reference', table: 'crews' },
    { id: 'note', label: 'Note', type: 'longtext' },
  ],
});

const run = (fn: (s: D) => void, opts?: S.ValidateOptions) => {
  const s = spec();
  fn(s);
  return validateAppSpec(s, opts);
};
const has = (r: { issues: S.SpecIssue[] }, path: string, code: string) => r.issues.some((i) => i.path === path && i.code === code);
const codes = (r: { issues: S.SpecIssue[] }) => r.issues.map((i) => i.code);
const where = (w: D, withTasks = true) => run((s) => {
  if (withTasks) s.tables.push(extraTable());
  s.pages[0].sources[0].table = withTasks ? 'tasks' : 'crews';
  s.pages[0].sources[0].where = Array.isArray(w) ? w : [w];
  s.pages[0].sources[0].orderBy = [];
});
const WP = 'pages.0.sources.0.where.0';

const tablesWith = (id: string, fid = 'name') =>
  validateTables({ tables: [{ id, label: 'L', fields: [{ id: fid, label: 'F', type: 'text' }] }] });
const chain = (levels: number): D => {
  let node: D = layer(`l${levels - 1}`, 'Text');
  for (let i = levels - 2; i >= 1; i--) node = layer(`l${i}`, 'Text', [node]);
  return layer('l0', 'Page', levels > 1 ? [node] : []);
};

const SQLITE_KEYWORDS = ('abort action add after all alter always analyze and as asc attach autoincrement before begin between by cascade ' +
  'case cast check collate column commit conflict constraint create cross current current_date current_time current_timestamp database ' +
  'default deferrable deferred delete desc detach distinct do drop each else end escape except exclude exclusive exists explain fail filter ' +
  'first following for foreign from full generated glob group groups having if ignore immediate in index indexed initially inner insert ' +
  'instead intersect into is isnull join key last left like limit match materialized natural no not nothing notnull null nulls of offset on ' +
  'or order others outer over partition plan pragma preceding primary query raise range recursive references regexp reindex release rename ' +
  'replace restrict returning right rollback row rows savepoint select set table temp temporary then ties to transaction trigger unbounded ' +
  'union unique update using vacuum values view virtual when where window with without true false strict').split(' ');

describe('valid specs', () => {
  it('accepts the full crew-roster example', () => {
    const r = validateAppSpec(spec());
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.app.slug).toBe('crew-roster');
  });

  it('fills defaults on a minimal spec', () => {
    const r = validateAppSpec({
      specVersion: 1,
      app: { name: 'Mini', slug: 'mini', identifier: 'com.example.mini', version: '0.1.0' },
      pages: [{ id: 'home', title: 'Home', route: '/', layout: layer('root', 'Page') }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tables).toEqual([]);
    expect(r.value.nav).toEqual([]);
    expect(r.value.theme).toEqual({ preset: 'aurora', radius: 'md' });
    expect(r.value.app.description).toBe('');
    expect(r.value.app.icon).toBeNull();
    expect(r.value.pages[0].sources).toEqual([]);
  });

  it('fills source and field defaults', () => {
    const r = run((s) => {
      s.pages[0].sources = [{ id: 'all', table: 'people' }];
      delete s.tables[0].fields[0].required;
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pages[0].sources[0]).toMatchObject({ mode: 'list', where: [], orderBy: [], limit: 50 });
    expect(r.value.tables[0].fields[0].required).toBe(false);
  });

  it('accepts a reference to a table declared later and a diamond of references', () => {
    const r = run((s) => {
      s.tables.unshift({ id: 'early', label: 'Early', fields: [{ id: 'c', label: 'C', type: 'reference', table: 'crews' }] });
      s.tables.push({ id: 'd', label: 'D', fields: [{ id: 'x', label: 'X', type: 'text' }] });
      s.tables.push({ id: 'b', label: 'B', fields: [{ id: 'd', label: 'D', type: 'reference', table: 'd' }] });
      s.tables.push({ id: 'c', label: 'C', fields: [{ id: 'd', label: 'D', type: 'reference', table: 'd' }] });
      s.tables.push({ id: 'a', label: 'A', fields: [{ id: 'b', label: 'B', type: 'reference', table: 'b' }, { id: 'c', label: 'C', type: 'reference', table: 'c' }] });
    });
    expect(r.issues).toEqual([]);
  });
});

describe('ids', () => {
  const good = ['a', 'a1', 'a_b', 'a_', 'a' + 'b'.repeat(30)];
  const bad = ['a' + 'b'.repeat(31), '1a', 'A', 'aB', 'a-b', '_a', '', 'a b', 'café'];
  it.each(good)('ID_RE accepts %s', (id) => expect(S.ID_RE.test(id)).toBe(true));
  it.each(bad)('ID_RE rejects %j', (id) => expect(S.ID_RE.test(id)).toBe(false));
  it('is exactly 31 chars at the boundary (31 ok, 32 rejected) for table and field ids', () => {
    const id31 = 'x' + 'y'.repeat(30);
    expect(id31).toHaveLength(31);
    expect(tablesWith(id31, id31).ok).toBe(true);
    expect(tablesWith(id31 + 'y').ok).toBe(false);
    expect(tablesWith('ok_table', id31 + 'y').ok).toBe(false);
  });
  it.each(['1abc', 'Abc', 'a-b', 'abC'])('rejects table id %s with a path at tables.0.id', (id) => {
    const r = tablesWith(id);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === 'tables.0.id')).toBe(true);
  });
  it('applies the id rule to pages, sources and nav pageId', () => {
    expect(run((s) => { s.pages[0].id = 'Home'; }).ok).toBe(false);
    expect(run((s) => { s.pages[0].sources[0].id = 'openCrews'; }).ok).toBe(false);
    expect(run((s) => { s.nav[0].pageId = '1home'; }).ok).toBe(false);
  });
});

describe('reserved words', () => {
  it('rejects every SQLite keyword as a table id and a field id', () => {
    const missingTable: string[] = [];
    const missingField: string[] = [];
    for (const w of SQLITE_KEYWORDS) {
      if (!has(tablesWith(w), 'tables.0.id', 'reserved_word')) missingTable.push(w);
      if (!has(tablesWith('ok_table', w), 'tables.0.fields.0.id', 'reserved_word')) missingField.push(w);
    }
    expect(missingTable).toEqual([]);
    expect(missingField).toEqual([]);
  });
  it.each(['items', 'app_state', 'assistant_conversations', 'assistant_messages', 'app_secrets', 'audit_log', 'schema_version', 'app_schema_version', 'apps', 'builds'])(
    'rejects kit table id %s', (id) => expect(has(tablesWith(id), 'tables.0.id', 'reserved_word')).toBe(true));
  it.each(['notes', 'memory', 'mixed', 'items'])('rejects cloud category id %s as a table', (id) =>
    expect(has(tablesWith(id), 'tables.0.id', 'reserved_word')).toBe(true));
  it.each(['sqlite_x', 'app_foo', 'assistant_x', 'studio_x'])('rejects reserved prefix in %s', (id) =>
    expect(has(tablesWith(id), 'tables.0.id', 'reserved_word')).toBe(true));
  it.each(['con', 'prn', 'aux', 'nul', 'com0', 'com1', 'com9', 'lpt0', 'lpt1', 'lpt9'])('rejects Windows device name %s', (id) =>
    expect(has(tablesWith(id), 'tables.0.id', 'reserved_word')).toBe(true));
  it.each(['id', 'created_at', 'updated_at', 'rowid', 'oid'])('rejects runtime column %s as a field id', (id) =>
    expect(has(tablesWith('ok_table', id), 'tables.0.fields.0.id', 'reserved_word')).toBe(true));
  it('allows near-misses', () => {
    for (const t of ['crews', 'application', 'appx', 'notes_list', 'item', 'com10', 'lpt10', 'sqlite']) {
      expect(tablesWith(t).issues, t).toEqual([]);
    }
    for (const f of ['status', 'title', 'notes', 'items', 'idx', 'created', 'rowid2']) {
      expect(tablesWith('ok_table', f).issues, f).toEqual([]);
    }
  });
  it('allows a table named like a runtime column', () => {
    expect(tablesWith('created_at').ok).toBe(true);
  });
  it('rejects reserved first route segments but not later ones', () => {
    for (const seg of ['api', 'assets', 'data', 'desktop', 'designer', 'items', 'preview', 'settings', 'studio']) {
      const r = run((s) => { s.pages.push(page('p2', `/${seg}`)); });
      expect(has(r, 'pages.1.route', 'reserved_word'), seg).toBe(true);
    }
    expect(has(run((s) => { s.pages.push(page('p2', '/api/v1')); }), 'pages.1.route', 'reserved_word')).toBe(true);
    expect(run((s) => { s.pages.push(page('p2', '/crews/api')); }).ok).toBe(true);
    expect(run((s) => { s.pages.push(page('p2', '/apix')); }).ok).toBe(true);
  });
});

describe('field types and defaults', () => {
  const f = (type: string, extra: D = {}) => ({ id: 'f', label: 'F', type, ...extra });
  const okDefaults: Array<[string, unknown]> = [
    ['text', ''], ['text', 'abc'], ['text', 'x'.repeat(500)],
    ['longtext', 'x'.repeat(20000)],
    ['integer', 0], ['integer', -7], ['integer', 42],
    ['real', 0], ['real', -1.5], ['real', 3.14],
    ['boolean', true], ['boolean', false],
    ['date', '2026-01-31'], ['date', '2024-02-29'],
    ['datetime', '2026-01-31T09:00:00Z'], ['datetime', '2026-01-31T09:00:00.123Z'],
  ];
  const badDefaults: Array<[string, unknown]> = [
    ['text', 'x'.repeat(501)], ['text', 5], ['text', true], ['text', null],
    ['longtext', 'x'.repeat(20001)], ['longtext', 1],
    ['integer', 1.5], ['integer', '3'], ['integer', 2 ** 60], ['integer', Number.NaN], ['integer', Number.POSITIVE_INFINITY], ['integer', null],
    ['real', '1'], ['real', Number.NaN], ['real', Number.POSITIVE_INFINITY], ['real', null],
    ['boolean', 'true'], ['boolean', 0], ['boolean', 1],
    ['date', '2026-1-31'], ['date', '2026-13-01'], ['date', '2026-02-30'], ['date', '2026-01-31T00:00:00Z'], ['date', ''], ['date', 20260131],
    ['datetime', '2026-01-31'], ['datetime', '2026-01-31T09:00:00+02:00'], ['datetime', '2026-01-31 09:00:00'], ['datetime', 'x'],
  ];
  it.each(okDefaults)('%s accepts default %j', (type, d) => {
    expect(S.FieldSchema.safeParse(f(type, { default: d })).success).toBe(true);
  });
  it.each(badDefaults)('%s rejects default %j', (type, d) => {
    expect(S.FieldSchema.safeParse(f(type, { default: d })).success).toBe(false);
  });
  it('accepts every type without a default and defaults required to false', () => {
    for (const t of S.FIELD_TYPES) {
      const extra = t === 'select' ? { options: ['a'] } : t === 'reference' ? { table: 'other' } : {};
      const r = S.FieldSchema.safeParse(f(t, extra));
      expect(r.success, t).toBe(true);
      if (r.success) expect(r.data.required).toBe(false);
    }
  });
  it('rejects an unknown type, a foreign key for the type, and a missing label', () => {
    expect(S.FieldSchema.safeParse(f('float')).success).toBe(false);
    expect(S.FieldSchema.safeParse(f('text', { options: ['a'] })).success).toBe(false);
    expect(S.FieldSchema.safeParse(f('integer', { table: 'x' })).success).toBe(false);
    expect(S.FieldSchema.safeParse({ id: 'f', type: 'text' }).success).toBe(false);
  });
  it('rejects a default on a reference field', () => {
    expect(S.FieldSchema.safeParse(f('reference', { table: 'x', default: 'abc' })).success).toBe(false);
  });
  it('reports a wrong-typed default through validateAppSpec with a dotted path', () => {
    const r = run((s) => { s.tables[1].fields[1].default = 'one'; });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.startsWith('tables.1.fields.1'))).toBe(true);
  });

  describe('select', () => {
    it('rejects empty options', () => {
      const r = run((s) => { s.tables[1].fields[3].options = []; delete s.tables[1].fields[3].default; });
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.path.includes('options'))).toBe(true);
    });
    it('rejects duplicate options with duplicate_option', () => {
      const r = run((s) => { s.tables[1].fields[3].options = ['a', 'b', 'a']; delete s.tables[1].fields[3].default; });
      expect(has(r, 'tables.1.fields.3.options', 'duplicate_option')).toBe(true);
    });
    it('treats options that differ only by case as distinct', () => {
      expect(run((s) => { s.tables[1].fields[3].options = ['A', 'a']; s.tables[1].fields[3].default = 'A'; s.pages[0].sources[0].where = []; }).ok).toBe(true);
    });
    it('rejects a default outside the options with invalid_default', () => {
      const r = run((s) => { s.tables[1].fields[3].default = 'archived'; });
      expect(has(r, 'tables.1.fields.3.default', 'invalid_default')).toBe(true);
    });
    it('enforces option count and length limits', () => {
      const mk = (options: unknown[]) => S.FieldSchema.safeParse(f('select', { options })).success;
      expect(mk(Array.from({ length: 50 }, (_, i) => `o${i}`))).toBe(true);
      expect(mk(Array.from({ length: 51 }, (_, i) => `o${i}`))).toBe(false);
      expect(mk(['x'.repeat(60)])).toBe(true);
      expect(mk(['x'.repeat(61)])).toBe(false);
      expect(mk([''])).toBe(false);
      expect(mk([' a'])).toBe(false);
      expect(mk([1])).toBe(false);
    });
  });

  describe('reference', () => {
    it('rejects a reference to an undeclared table with unknown_table', () => {
      const r = run((s) => { s.tables[1].fields[2].table = 'ghost'; });
      expect(has(r, 'tables.1.fields.2.table', 'unknown_table')).toBe(true);
    });
    it('rejects a self reference and a mutual loop with reference_cycle', () => {
      const self = run((s) => { s.tables[0].fields.push({ id: 'boss', label: 'Boss', type: 'reference', table: 'people' }); });
      expect(codes(self)).toContain('reference_cycle');
      const loop = run((s) => { s.tables[0].fields.push({ id: 'crew', label: 'Crew', type: 'reference', table: 'crews' }); });
      expect(codes(loop)).toContain('reference_cycle');
    });
  });
});

describe('tables', () => {
  it('rejects empty fields, missing label, bad labels and > 60 fields', () => {
    expect(run((s) => { s.tables[0].fields = []; }).ok).toBe(false);
    expect(run((s) => { delete s.tables[0].label; }).ok).toBe(false);
    for (const label of ['', ' Lead', 'Trail ', 'a\nb', 'x'.repeat(61)]) {
      expect(run((s) => { s.tables[0].label = label; }).ok, JSON.stringify(label)).toBe(false);
    }
    expect(run((s) => { s.tables[0].label = 'x'.repeat(60); }).ok).toBe(true);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, label: 'F', type: 'text' }));
    expect(run((s) => { s.tables[0].fields = many(60); s.tables[0].titleField = 'f0'; }).ok).toBe(true);
    expect(run((s) => { s.tables[0].fields = many(61); s.tables[0].titleField = 'f0'; }).ok).toBe(false);
  });
  it('limits tables to 30', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, label: 'T', fields: [{ id: 'name', label: 'N', type: 'text' }] }));
    expect(run((s) => { s.tables = mk(30); s.pages[0].sources = []; }).ok).toBe(true);
    expect(run((s) => { s.tables = mk(31); s.pages[0].sources = []; }).ok).toBe(false);
  });
  it('titleField must be a text, longtext or select field of the table', () => {
    expect(has(run((s) => { s.tables[1].titleField = 'size'; }), 'tables.1.titleField', 'unknown_field')).toBe(true);
    expect(has(run((s) => { s.tables[1].titleField = 'missing'; }), 'tables.1.titleField', 'unknown_field')).toBe(true);
    expect(has(run((s) => { s.tables[1].titleField = 'lead_id'; }), 'tables.1.titleField', 'unknown_field')).toBe(true);
    expect(run((s) => { s.tables[1].titleField = 'status'; }).ok).toBe(true);
    expect(run((s) => { s.tables[1].fields.push({ id: 'bio', label: 'Bio', type: 'longtext' }); s.tables[1].titleField = 'bio'; }).ok).toBe(true);
  });
  it('validateTables checks the plan block alone', () => {
    expect(validateTables({ tables: spec().tables }).ok).toBe(true);
    expect(validateTables({ tables: [] }).ok).toBe(false);
    expect(validateTables({}).ok).toBe(false);
    const r = validateTables({ tables: [{ id: 'select', label: 'S', fields: [{ id: 'id', label: 'I', type: 'text' }] }] });
    expect(r.issues.map((i) => i.path)).toEqual(['tables.0.id', 'tables.0.fields.0.id']);
  });
});

describe('uniqueness', () => {
  it.each([
    ['table id', (s: D) => { s.tables.push(structuredClone(s.tables[0])); }, 'tables.2.id', 'duplicate_id'],
    ['field id', (s: D) => { s.tables[1].fields.push({ id: 'name', label: 'Again', type: 'text' }); }, 'tables.1.fields.4.id', 'duplicate_id'],
    ['page id', (s: D) => { s.pages.push(page('home', '/other')); }, 'pages.1.id', 'duplicate_id'],
    ['source id', (s: D) => { s.pages[0].sources.push(structuredClone(s.pages[0].sources[0])); }, 'pages.0.sources.1.id', 'duplicate_id'],
    ['route', (s: D) => { s.pages.push(page('two', '/')); }, 'pages.1.route', 'duplicate_route'],
    ['nav page', (s: D) => { s.nav.push({ pageId: 'home', label: 'Home 2' }); }, 'nav.1.pageId', 'duplicate_id'],
    ['layer id', (s: D) => { s.pages[0].layout.children[1].id = 'h1'; }, 'pages.0.layout.children.1.id', 'duplicate_id'],
  ])('flags a duplicate %s', (_n, fn, path, code) => {
    const r = run(fn);
    expect(r.ok).toBe(false);
    if (_n === 'layer id') expect(r.issues.some((i) => i.code === code && /^pages.0.layout.children.[01].id$/.test(i.path))).toBe(true);
    else expect(has(r, path, code)).toBe(true);
  });
  it('allows the same source id on different pages', () => {
    const r = run((s) => { s.pages.push({ ...page('two', '/two'), sources: [structuredClone(s.pages[0].sources[0])] }); });
    expect(r.issues).toEqual([]);
  });
});

describe('nav and pages', () => {
  it('flags a nav item whose page does not exist', () => {
    expect(has(run((s) => { s.nav[0].pageId = 'ghost'; }), 'nav.0.pageId', 'unknown_page')).toBe(true);
  });
  it('flags a nav item that points at a /:id page', () => {
    const r = run((s) => { s.pages.push(page('detail', '/crews/:id')); s.nav.push({ pageId: 'detail', label: 'Detail' }); });
    expect(has(r, 'nav.1.pageId', 'route_param')).toBe(true);
  });
  it('requires a page with route "/"', () => {
    expect(has(run((s) => { s.pages[0].route = '/crews'; s.nav = []; }), 'pages', 'missing_home')).toBe(true);
  });
  it('requires 1..30 pages and 0..20 nav items', () => {
    expect(run((s) => { s.pages = []; s.nav = []; }).ok).toBe(false);
    const many = (n: number) => Array.from({ length: n }, (_, i) => page(`p${i}`, i === 0 ? '/' : `/r${i}`));
    expect(run((s) => { s.pages = many(30); s.nav = []; }).ok).toBe(true);
    expect(run((s) => { s.pages = many(31); s.nav = []; }).ok).toBe(false);
    const navs = (n: number) => Array.from({ length: n }, (_, i) => ({ pageId: `p${i}`, label: 'N' }));
    expect(run((s) => { s.pages = many(21); s.nav = navs(20); }).ok).toBe(true);
    expect(run((s) => { s.pages = many(30); s.nav = navs(21); }).ok).toBe(false);
  });
  it.each(['/', '/crews', '/crews/open', '/crews/:id', '/a-b/c1', '/a'])('route %s is valid', (route) => {
    expect(S.ROUTE_RE.test(route)).toBe(true);
  });
  it.each(['', 'crews', '/Crews', '/crews/', '/crews//x', '/crews/:id/x', '/crews_x', '/-a', '/a-', '/a b', '/crews/:ID'])('route %j is invalid', (route) => {
    expect(S.ROUTE_RE.test(route)).toBe(false);
  });
  it('limits route length to 60', () => {
    expect(run((s) => { s.pages.push(page('p2', '/' + 'a'.repeat(59))); }).ok).toBe(true);
    expect(run((s) => { s.pages.push(page('p2', '/' + 'a'.repeat(60))); }).ok).toBe(false);
  });
  it('limits sources per page to 8', () => {
    const src = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, table: 'people' }));
    expect(run((s) => { s.pages[0].sources = src(8); }).ok).toBe(true);
    expect(run((s) => { s.pages[0].sources = src(9); }).ok).toBe(false);
  });
});

describe('sources', () => {
  it.each(['eq', 'ne', 'gt', 'gte', 'lt', 'lte'])('accepts op %s with a scalar', (op) => {
    expect(where({ field: 'score', op, value: 3.5 }).issues).toEqual([]);
  });
  it('accepts op in with a list', () => {
    expect(where({ field: 'score', op: 'in', value: [1, 2.5] }).issues).toEqual([]);
  });
  it.each(['like', 'between', 'or', 'EQ', '=', ''])('rejects unsupported op %j', (op) => {
    const r = where({ field: 'score', op, value: 1 });
    expect(r.ok).toBe(false);
    expect(has(r, `${WP}.op`, 'invalid_value')).toBe(true);
  });
  it('rejects an in condition that is not a list, and a list on another op', () => {
    expect(has(where({ field: 'score', op: 'in', value: 1 }), `${WP}.value`, 'invalid_value')).toBe(true);
    expect(has(where({ field: 'score', op: 'in', value: null }), `${WP}.value`, 'invalid_value')).toBe(true);
    expect(has(where({ field: 'score', op: 'eq', value: [1] }), `${WP}.value`, 'invalid_value')).toBe(true);
  });
  it('limits in lists to 50 values', () => {
    expect(where({ field: 'score', op: 'in', value: Array.from({ length: 50 }, (_, i) => i) }).ok).toBe(true);
    expect(where({ field: 'score', op: 'in', value: Array.from({ length: 51 }, (_, i) => i) }).ok).toBe(false);
  });
  it('allows null only with eq and ne', () => {
    expect(where({ field: 'note', op: 'eq', value: null }).ok).toBe(true);
    expect(where({ field: 'note', op: 'ne', value: null }).ok).toBe(true);
    expect(has(where({ field: 'score', op: 'gt', value: null }), `${WP}.value`, 'invalid_value')).toBe(true);
  });
  it('flags where on an unknown field, and orderBy on an unknown field', () => {
    expect(has(where({ field: 'ghost', op: 'eq', value: 1 }, false), `${WP}.field`, 'unknown_field')).toBe(true);
    const r = run((s) => { s.pages[0].sources[0].orderBy = [{ field: 'ghost', dir: 'asc' }]; });
    expect(has(r, 'pages.0.sources.0.orderBy.0.field', 'unknown_field')).toBe(true);
  });
  it('accepts runtime columns in where and orderBy', () => {
    expect(where({ field: 'created_at', op: 'gt', value: '2026-01-01T00:00:00Z' }, false).issues).toEqual([]);
    expect(where({ field: 'id', op: 'eq', value: 'abc' }, false).issues).toEqual([]);
    const r = run((s) => { s.pages[0].sources[0].orderBy = [{ field: 'updated_at', dir: 'desc' }]; });
    expect(r.ok).toBe(true);
  });
  it('flags an unknown source table', () => {
    expect(has(run((s) => { s.pages[0].sources[0].table = 'ghost'; }), 'pages.0.sources.0.table', 'unknown_table')).toBe(true);
  });
  it('refuses ordering ops on boolean, select, reference and id', () => {
    for (const [field, value] of [['done', true], ['crew', 'abc']] as const) {
      expect(has(where({ field, op: 'gt', value }), `${WP}.op`, 'op_not_allowed'), field).toBe(true);
    }
    expect(has(where({ field: 'status', op: 'lt', value: 'active' }, false), `${WP}.op`, 'op_not_allowed')).toBe(true);
    expect(has(where({ field: 'id', op: 'gte', value: 'abc' }, false), `${WP}.op`, 'op_not_allowed')).toBe(true);
    expect(where({ field: 'status', op: 'ne', value: 'active' }, false).ok).toBe(true);
  });
  it('checks that values fit the field type', () => {
    const bad: D[] = [
      { field: 'size', op: 'eq', value: 'x' }, { field: 'size', op: 'eq', value: 1.5 }, { field: 'size', op: 'in', value: ['a'] },
      { field: 'status', op: 'eq', value: 'bogus' }, { field: 'name', op: 'eq', value: 5 },
      { field: 'created_at', op: 'gt', value: 'yesterday' },
    ];
    for (const c of bad) expect(has(where(c, false), c.op === 'in' ? `${WP}.value.0` : `${WP}.value`, 'invalid_value'), JSON.stringify(c)).toBe(true);
    const badTasks: D[] = [
      { field: 'done', op: 'eq', value: 'true' }, { field: 'due', op: 'eq', value: '2026-13-01' },
      { field: 'at', op: 'eq', value: '2026-01-01' }, { field: 'score', op: 'eq', value: '1' },
    ];
    for (const c of badTasks) expect(has(where(c), `${WP}.value`, 'invalid_value'), JSON.stringify(c)).toBe(true);
    expect(where([{ field: 'done', op: 'eq', value: false }, { field: 'due', op: 'gte', value: '2026-01-31' }, { field: 'at', op: 'lt', value: '2026-01-31T09:00:00Z' }]).issues).toEqual([]);
  });
  it('allows one condition per field and operator', () => {
    const dup = where([{ field: 'size', op: 'gt', value: 1 }, { field: 'size', op: 'gt', value: 2 }], false);
    expect(has(dup, 'pages.0.sources.0.where.1', 'duplicate_condition')).toBe(true);
    expect(where([{ field: 'size', op: 'gt', value: 1 }, { field: 'size', op: 'lt', value: 9 }], false).ok).toBe(true);
  });
  it('limits where to 8 and orderBy to 3, and checks dir', () => {
    const w = (n: number) => Array.from({ length: n }, (_, i) => ({ field: 'created_at', op: 'eq', value: '2026-01-01T00:00:00Z', i }));
    expect(where(w(9).map(({ field, op, value }) => ({ field, op, value })), false).ok).toBe(false);
    const ob = (n: number) => ['name', 'size', 'status', 'created_at'].slice(0, n).map((field) => ({ field, dir: 'asc' }));
    expect(run((s) => { s.pages[0].sources[0].orderBy = ob(3); }).ok).toBe(true);
    expect(run((s) => { s.pages[0].sources[0].orderBy = ob(4); }).ok).toBe(false);
    expect(run((s) => { s.pages[0].sources[0].orderBy = [{ field: 'name', dir: 'up' }]; }).ok).toBe(false);
    const dflt = run((s) => { s.pages[0].sources[0].orderBy = [{ field: 'name' }]; });
    expect(dflt.ok && dflt.value.pages[0].sources[0].orderBy[0].dir).toBe('asc');
  });
  it('accepts 8 distinct where conditions', () => {
    const conds = [
      { field: 'name', op: 'eq', value: 'a' }, { field: 'name', op: 'ne', value: 'b' }, { field: 'size', op: 'gt', value: 1 },
      { field: 'size', op: 'gte', value: 1 }, { field: 'size', op: 'lt', value: 9 }, { field: 'size', op: 'lte', value: 9 },
      { field: 'size', op: 'in', value: [1, 2] }, { field: 'size', op: 'ne', value: 5 },
    ];
    expect(where(conds, false).issues).toEqual([]);
  });
  it.each([1, 50, 200])('accepts limit %i', (limit) => {
    expect(run((s) => { s.pages[0].sources[0].limit = limit; }).ok).toBe(true);
  });
  it.each([0, -1, 201, 1.5, '10', null, Number.NaN])('rejects limit %j', (limit) => {
    const r = run((s) => { s.pages[0].sources[0].limit = limit; });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === 'pages.0.sources.0.limit')).toBe(true);
  });
  it('record mode needs a /:id route and takes no where or orderBy', () => {
    const rec = (s: D, route: string, extra: D = {}) => {
      s.pages.push(page('detail', route, { sources: [{ id: 'one', table: 'crews', mode: 'record', ...extra }] }));
    };
    expect(run((s) => rec(s, '/crews/:id')).ok).toBe(true);
    expect(has(run((s) => rec(s, '/crews')), 'pages.1.sources.0.mode', 'route_param')).toBe(true);
    expect(has(run((s) => rec(s, '/crews/:id', { where: [{ field: 'name', op: 'eq', value: 'a' }] })), 'pages.1.sources.0.mode', 'record_source')).toBe(true);
    expect(has(run((s) => rec(s, '/crews/:id', { orderBy: [{ field: 'name' }] })), 'pages.1.sources.0.mode', 'record_source')).toBe(true);
    expect(run((s) => rec(s, '/crews/:id', { mode: 'many' })).ok).toBe(false);
  });
});

describe('layout', () => {
  const withLayout = (l: D) => run((s) => { s.pages[0].layout = l; });
  it('accepts children as an array, a string, and nested layers', () => {
    expect(withLayout(layer('root', 'Page', [])).ok).toBe(true);
    expect(withLayout(layer('root', 'Page', 'plain text')).ok).toBe(true);
    expect(withLayout(layer('root', 'Page', [layer('a', 'Card', [layer('b', 'Stack', [layer('c', 'Text', 'hi')])])])).ok).toBe(true);
    expect(withLayout({ ...layer('root', 'Page'), name: 'Main' }).ok).toBe(true);
  });
  it('accepts JSON props of any shape', () => {
    expect(withLayout(layer('root', 'Page', [layer('a', 'Table', [], { columns: ['a'], n: 1, ok: true, nothing: null, deep: { x: [1, { y: 2 }] } })])).ok).toBe(true);
  });
  it('accepts a feature marker and refuses unknown marker keys, bad ids, long values and more than 6 params', () => {
    const marked = (feature: D): D => ({ ...layer('root', 'Page'), feature });
    expect(withLayout(marked({ id: 'kpi_row', version: 1, params: { source: 'open_crews', title: 'Crew size' } })).ok).toBe(true);
    expect(withLayout(marked({ id: 'kpi_row', version: 1, params: {} })).ok).toBe(true);
    const six = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, 'x']));
    expect(withLayout(marked({ id: 'kpi_row', version: 1, params: six })).ok).toBe(true);
    const bad: D[] = [
      { id: 'kpi_row', version: 1, params: { ...six, g: 'x' } },
      { id: 'kpi_row', version: 1, params: {}, extra: 1 },
      { id: 'Kpi Row', version: 1, params: {} },
      { id: 'kpi_row', version: 0, params: {} },
      { id: 'kpi_row', version: 1.5, params: {} },
      { id: 'kpi_row', version: 1, params: { Bad: 'x' } },
      { id: 'kpi_row', version: 1, params: { a: 'x'.repeat(2001) } },
      { id: 'kpi_row', version: 1, params: { a: 1 } },
      { id: 'kpi_row', version: 1 },
    ];
    bad.forEach((f, i) => expect(withLayout(marked(f)).ok, `marker case ${i}`).toBe(false));
  });
  it('rejects wrong children, missing props, bad ids, bad types, extra keys, long text', () => {
    const bad: D[] = [
      { id: 'root', type: 'Page', props: {}, children: 5 },
      { id: 'root', type: 'Page', props: {}, children: null },
      { id: 'root', type: 'Page', props: {} },
      { id: 'root', type: 'Page', children: [] },
      { ...layer('root', 'Page'), extra: 1 },
      layer('bad id!', 'Page'),
      layer('', 'Page'),
      layer('x'.repeat(65), 'Page'),
      layer('root', 'page'),
      layer('root', 'Page', [layer('a', 'text')]),
      layer('root', 'Page', ['loose string']),
      layer('root', 'Page', 'x'.repeat(2001)),
    ];
    bad.forEach((l, i) => expect(withLayout(l).ok, `case ${i}`).toBe(false));
    expect(withLayout(layer('root', 'Page', 'x'.repeat(2000))).ok).toBe(true);
  });
  it('requires a Page root and only at the root', () => {
    expect(has(withLayout(layer('root', 'Stack')), 'pages.0.layout.type', 'layout_root')).toBe(true);
    expect(has(withLayout(layer('root', 'Page', [layer('a', 'Page')])), 'pages.0.layout.children.0.type', 'layout_root')).toBe(true);
  });
  it.each(['className', 'style', 'children', 'dangerouslySetInnerHTML', 'key', 'ref', 'onClick', 'onChange', 'onX'])('forbids prop %s', (key) => {
    const r = withLayout(layer('root', 'Page', [layer('a', 'Button', [], { [key]: 'x' })]));
    expect(has(r, `pages.0.layout.children.0.props.${key}`, 'forbidden_prop')).toBe(true);
  });
  it('forbids variable references and allows lookalike prop names', () => {
    const r = withLayout(layer('root', 'Page', [layer('a', 'Text', [], { value: { __variableRef: 'v1' } })]));
    expect(has(r, 'pages.0.layout.children.0.props.value', 'forbidden_prop')).toBe(true);
    expect(withLayout(layer('root', 'Page', [layer('a', 'Text', [], { online: true, once: 1, one: 2, classNames: 'x' })])).ok).toBe(true);
  });
  it('allows 16 levels and rejects 17 with layout_too_deep', () => {
    expect(withLayout(chain(16)).issues).toEqual([]);
    const r = withLayout(chain(17));
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('layout_too_deep');
  });
  it('allows 300 layers and rejects 301 with layout_too_large', () => {
    const many = (n: number) => layer('root', 'Page', Array.from({ length: n }, (_, i) => layer(`c${i}`, 'Text')));
    expect(withLayout(many(299)).issues).toEqual([]);
    expect(has(withLayout(many(300)), 'pages.0.layout', 'layout_too_large')).toBe(true);
  });
  it('runs the catalog hook per page and merges its issues', () => {
    const seen: string[] = [];
    const r = run((s) => { s.pages.push(page('two', '/two')); }, {
      checkLayout: (ctx) => { seen.push(ctx.path); return ctx.page.id === 'two' ? [{ path: `${ctx.path}.type`, code: 'unknown_part', message: 'No such part.' }] : []; },
    });
    expect(seen).toEqual(['pages.0.layout', 'pages.1.layout']);
    expect(r.ok).toBe(false);
    expect(has(r, 'pages.1.layout.type', 'unknown_part')).toBe(true);
  });
  it('does not call the hook when zod fails', () => {
    let called = false;
    const r = run((s) => { s.specVersion = 2; }, { checkLayout: () => { called = true; return []; } });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe('top level, app block and theme', () => {
  it('accepts only specVersion 1', () => {
    expect(run((s) => { s.specVersion = 1.0; }).ok).toBe(true);
    for (const v of [2, 0, -1, '1', null, true, 1.5]) {
      const r = run((s) => { s.specVersion = v; });
      expect(r.ok, String(v)).toBe(false);
      expect(r.issues.some((i) => i.path === 'specVersion'), String(v)).toBe(true);
    }
    const missing = run((s) => { delete s.specVersion; });
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((i) => i.path === 'specVersion')).toBe(true);
  });
  it('exports SPEC_VERSION = 1', () => expect(S.SPEC_VERSION).toBe(1));
  it('rejects unknown keys at every level with unrecognized_keys', () => {
    const cases: Array<[string, (s: D) => void]> = [
      ['(root)', (s) => { s.extra = 1; }],
      ['app', (s) => { s.app.extra = 1; }],
      ['tables.0', (s) => { s.tables[0].extra = 1; }],
      ['tables.0.fields.0', (s) => { s.tables[0].fields[0].extra = 1; }],
      ['pages.0', (s) => { s.pages[0].extra = 1; }],
      ['pages.0.sources.0', (s) => { s.pages[0].sources[0].extra = 1; }],
      ['pages.0.sources.0.where.0', (s) => { s.pages[0].sources[0].where[0].extra = 1; }],
      ['pages.0.sources.0.orderBy.0', (s) => { s.pages[0].sources[0].orderBy[0].extra = 1; }],
      ['pages.0.layout', (s) => { s.pages[0].layout.extra = 1; }],
      ['nav.0', (s) => { s.nav[0].extra = 1; }],
      ['theme', (s) => { s.theme.extra = 1; }],
    ];
    for (const [path, fn] of cases) expect(has(run(fn), path, 'unrecognized_keys'), path).toBe(true);
  });
  it('validates app.name', () => {
    for (const n of ['AB', 'Crew 2', 'Crew Roster', 'x'.repeat(40)]) expect(run((s) => { s.app.name = n; }).ok, n).toBe(true);
    for (const n of ['A', '', '1Crew', 'Crew  Roster', ' Crew', 'Crew ', 'Crew-Roster', 'Crew_Roster', 'x'.repeat(41)]) {
      expect(run((s) => { s.app.name = n; }).ok, JSON.stringify(n)).toBe(false);
    }
  });
  it.each(['Local App Studio', 'local app studio', 'Local App Studio Dev', 'LOCAL APP STUDIO DEV'])('rejects reserved app name %s', (n) => {
    expect(has(run((s) => { s.app.name = n; }), 'app.name', 'reserved_name')).toBe(true);
  });
  it('validates app.slug', () => {
    for (const v of ['ab', 'crew-roster', 'crew2', 'a1-b2-c3']) expect(run((s) => { s.app.slug = v; }).ok, v).toBe(true);
    for (const v of ['a', '', 'Crew', 'crew--roster', 'crew-', '-crew', '1crew', 'crew_roster', 'crew roster', 'x'.repeat(41)]) {
      expect(run((s) => { s.app.slug = v; }).ok, JSON.stringify(v)).toBe(false);
    }
  });
  it('validates app.identifier', () => {
    for (const v of ['com.example.crewroster', 'a.b', 'com.my-co.app1', 'com.dev.example']) expect(run((s) => { s.app.identifier = v; }).ok, v).toBe(true);
    for (const v of ['crewroster', 'com.Example.x', 'com..x', 'com.example.', '.com.example', '1com.example', 'com.-x.y', 'com.x-.y', 'com.ex_ample.y', 'com.' + 'a'.repeat(120)]) {
      expect(run((s) => { s.app.identifier = v; }).ok, v).toBe(false);
    }
  });
  it.each(['com.example.dev', 'com.example.app', 'com.neuralfoundry.localappstudio', 'com.neuralfoundry.localappstudio.mine'])('rejects reserved identifier %s', (v) => {
    expect(has(run((s) => { s.app.identifier = v; }), 'app.identifier', 'reserved_identifier')).toBe(true);
  });
  it('validates app.version as plain MAJOR.MINOR.PATCH', () => {
    for (const v of ['0.0.0', '1.2.3', '10.20.30']) expect(run((s) => { s.app.version = v; }).ok, v).toBe(true);
    for (const v of ['1.0', '1.0.0.0.0', 'v1.0.0', '1.0.0-beta', '01.0.0', '1.0.0+b', '', '1.0.a', '1.1.123456789012345678']) {
      expect(run((s) => { s.app.version = v; }).ok, JSON.stringify(v)).toBe(false);
    }
  });
  it('limits description to 300 chars and validates icons', () => {
    expect(run((s) => { s.app.description = 'x'.repeat(300); }).ok).toBe(true);
    expect(run((s) => { s.app.description = 'x'.repeat(301); }).ok).toBe(false);
    for (const icon of S.ICONS) {
      expect(run((s) => { s.app.icon = icon; s.nav[0].icon = icon; }).ok, icon).toBe(true);
    }
    expect(run((s) => { s.app.icon = null; }).ok).toBe(true);
    expect(run((s) => { s.app.icon = 'rocket'; }).ok).toBe(false);
    expect(run((s) => { s.nav[0].icon = 'rocket'; }).ok).toBe(false);
  });
  it('lists exactly the 20 documented icons', () => {
    expect([...S.ICONS]).toEqual(['home', 'list', 'table', 'users', 'user', 'box', 'calendar', 'chart', 'clipboard', 'file', 'folder', 'tag', 'star', 'briefcase', 'truck', 'wrench', 'settings', 'inbox', 'map', 'heart']);
  });
  it('validates theme enums and defaults', () => {
    for (const preset of ['aurora', 'ocean', 'sunset', 'forest', 'graphite', 'solid']) expect(run((s) => { s.theme.preset = preset; }).ok, preset).toBe(true);
    for (const radius of ['none', 'sm', 'md', 'lg']) expect(run((s) => { s.theme.radius = radius; }).ok, radius).toBe(true);
    expect(has(run((s) => { s.theme.preset = 'neon'; }), 'theme.preset', 'invalid_value')).toBe(true);
    expect(has(run((s) => { s.theme.radius = 'xl'; }), 'theme.radius', 'invalid_value')).toBe(true);
    const r = run((s) => { s.theme = {}; });
    expect(r.ok && r.value.theme).toEqual({ preset: 'aurora', radius: 'md' });
    const r2 = run((s) => { delete s.theme; });
    expect(r2.ok && r2.value.theme).toEqual({ preset: 'aurora', radius: 'md' });
  });
});

describe('validateAppSpec result shape and stable codes', () => {
  it('returns structured issues {path, code, message} and never throws', () => {
    const circular: D = {}; circular.self = circular;
    const inputs: unknown[] = [null, undefined, 42, 'text', [], {}, true, circular, { big: 10n }, () => 1, Symbol('x')];
    for (const input of inputs) {
      let r: ReturnType<typeof validateAppSpec> | undefined;
      expect(() => { r = validateAppSpec(input); }, String(typeof input)).not.toThrow();
      expect(r?.ok).toBe(false);
      expect(r?.value).toBeNull();
      expect(r!.issues.length).toBeGreaterThan(0);
      for (const i of r!.issues) {
        expect(typeof i.path).toBe('string');
        expect(typeof i.code).toBe('string');
        expect(typeof i.message).toBe('string');
        expect(i.message.length).toBeGreaterThan(0);
      }
    }
    expect(() => validateTables(circular)).not.toThrow();
  });
  it('uses (root) for a root-level problem', () => {
    expect(has(validateAppSpec(null), '(root)', 'invalid_type')).toBe(true);
    expect(validateAppSpec({}).issues.map((i) => i.path)).toEqual(expect.arrayContaining(['specVersion', 'app', 'pages']));
  });
  it('rejects a spec over 512 KiB with too_big at (root) before parsing', () => {
    const r = validateAppSpec({ junk: 'x'.repeat(600 * 1024) });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ path: '(root)', code: 'too_big' });
    expect(validateTables({ junk: 'x'.repeat(600 * 1024) }).issues[0]).toMatchObject({ path: '(root)', code: 'too_big' });
  });
  it('names the size limit in plain words', () => {
    const msg = 'An app design may be at most 512 KB.';
    expect(validateAppSpec({ junk: 'x'.repeat(600 * 1024) }).issues[0]?.message).toBe(msg);
    expect(validateTables({ junk: 'x'.repeat(600 * 1024) }).issues[0]?.message).toBe(msg);
  });
  it.each([
    ['tables', (s: D) => { s.tables = Array.from({ length: S.LIMITS.tables + 1 }, (_, i) => ({ ...s.tables[0], id: `t${i}` })); }, 'tables', 'An app may have at most 30 tables.'],
    ['fields', (s: D) => { s.tables[0].fields = Array.from({ length: S.LIMITS.fieldsPerTable + 1 }, (_, i) => ({ id: `f${i}`, label: 'F', type: 'text' })); }, 'tables.0.fields', 'A table may have at most 60 fields.'],
    ['pages', (s: D) => { s.pages = Array.from({ length: S.LIMITS.pages + 1 }, (_, i) => page(`p${i}`, `/p${i}`)); }, 'pages', 'An app may have at most 30 pages.'],
    ['sources', (s: D) => { s.pages[0].sources = Array.from({ length: S.LIMITS.sourcesPerPage + 1 }, () => ({ table: 'people' })); }, 'pages.0.sources', 'A page may have at most 8 sources.'],
    ['nav', (s: D) => { s.nav = Array.from({ length: S.LIMITS.nav + 1 }, () => ({ label: 'Home', pageId: 'home' })); }, 'nav', 'The menu may have at most 20 items.'],
  ])('maps the %s count limit to a plain message', (_name, mutate, path, message) => {
    const s = spec();
    mutate(s);
    const hit = validateAppSpec(s).issues.find((i) => i.path === path && i.code === 'too_big');
    expect(hit?.message).toBe(message);
  });
  it.each([
    ['unrecognized key', (s: D) => { s.extra = 1; }, '(root)', 'unrecognized_keys'],
    ['wrong type', (s: D) => { s.app.name = 5; }, 'app.name', 'invalid_type'],
    ['bad format', (s: D) => { s.app.slug = 'Bad Slug'; }, 'app.slug', 'invalid_format'],
    ['bad enum value', (s: D) => { s.theme.radius = 'xl'; }, 'theme.radius', 'invalid_value'],
    ['too small', (s: D) => { s.pages = []; s.nav = []; }, 'pages', 'too_small'],
    ['too big', (s: D) => { s.app.description = 'x'.repeat(301); }, 'app.description', 'too_big'],
    ['reserved table', (s: D) => { s.tables[0].id = 'select'; s.tables[1].fields[2].table = 'select'; }, 'tables.0.id', 'reserved_word'],
    ['reserved field', (s: D) => { s.tables[0].fields[0].id = 'created_at'; s.tables[0].titleField = 'created_at'; }, 'tables.0.fields.0.id', 'reserved_word'],
    ['reserved name', (s: D) => { s.app.name = 'Local App Studio'; }, 'app.name', 'reserved_name'],
    ['reserved identifier', (s: D) => { s.app.identifier = 'com.example.dev'; }, 'app.identifier', 'reserved_identifier'],
    ['unknown table', (s: D) => { s.tables[1].fields[2].table = 'ghost'; }, 'tables.1.fields.2.table', 'unknown_table'],
    ['unknown field', (s: D) => { s.pages[0].sources[0].where[0].field = 'ghost'; }, 'pages.0.sources.0.where.0.field', 'unknown_field'],
    ['unknown page', (s: D) => { s.nav[0].pageId = 'ghost'; }, 'nav.0.pageId', 'unknown_page'],
    ['duplicate id', (s: D) => { s.pages.push(page('home', '/x')); }, 'pages.1.id', 'duplicate_id'],
    ['duplicate route', (s: D) => { s.pages.push(page('x', '/')); }, 'pages.1.route', 'duplicate_route'],
    ['duplicate option', (s: D) => { s.tables[1].fields[3].options = ['a', 'a']; delete s.tables[1].fields[3].default; }, 'tables.1.fields.3.options', 'duplicate_option'],
    ['duplicate condition', (s: D) => { s.pages[0].sources[0].where.push({ field: 'status', op: 'eq', value: 'paused' }); }, 'pages.0.sources.0.where.1', 'duplicate_condition'],
    ['invalid default', (s: D) => { s.tables[1].fields[3].default = 'zzz'; }, 'tables.1.fields.3.default', 'invalid_default'],
    ['op not allowed', (s: D) => { s.pages[0].sources[0].where[0] = { field: 'status', op: 'gt', value: 'active' }; }, 'pages.0.sources.0.where.0.op', 'op_not_allowed'],
    ['invalid value', (s: D) => { s.pages[0].sources[0].where[0].value = 'zzz'; }, 'pages.0.sources.0.where.0.value', 'invalid_value'],
    ['route param', (s: D) => { s.pages[0].sources[0].mode = 'record'; }, 'pages.0.sources.0.mode', 'route_param'],
    ['record source', (s: D) => { s.pages.push(page('d', '/d/:id', { sources: [{ id: 'one', table: 'crews', mode: 'record', orderBy: [{ field: 'name' }] }] })); }, 'pages.1.sources.0.mode', 'record_source'],
    ['missing home', (s: D) => { s.pages[0].route = '/h'; s.nav = []; }, 'pages', 'missing_home'],
    ['reference cycle', (s: D) => { s.tables[0].fields.push({ id: 'crew', label: 'C', type: 'reference', table: 'crews' }); }, 'tables.0', 'reference_cycle'],
    ['layout root', (s: D) => { s.pages[0].layout.type = 'Card'; }, 'pages.0.layout.type', 'layout_root'],
    ['forbidden prop', (s: D) => { s.pages[0].layout.props.className = 'x'; }, 'pages.0.layout.props.className', 'forbidden_prop'],
  ])('%s -> %s', (_n, fn, path, code) => {
    const r = run(fn);
    expect(r.ok).toBe(false);
    expect(has(r, path, code), JSON.stringify(r.issues)).toBe(true);
  });
  it('maps a bad field union to one message that names the field types', () => {
    const r = run((s) => { s.tables[0].fields[0] = { id: 'x', label: 'X', type: 'float' }; });
    expect(r.ok).toBe(false);
    const u = r.issues.find((i) => i.code === 'invalid_union');
    expect(u?.path).toBe('tables.0.fields.0.type');
    for (const t of S.FIELD_TYPES) expect(u?.message).toContain(t);
    expect(u?.message).toContain('Each field needs a known type');
  });
  it('caps issues at 20 by default and at maxIssues when given', () => {
    const fields = Array.from({ length: 30 }, () => ({ id: 'id', label: 'F', type: 'text' }));
    const s = spec(); s.tables[0].fields = fields;
    expect(validateAppSpec(s).issues).toHaveLength(20);
    expect(validateAppSpec(s, { maxIssues: 3 }).issues).toHaveLength(3);
    expect(validateAppSpec(s, { maxIssues: 1 }).issues).toHaveLength(1);
  });
  it('success returns the parsed value, empty issues and does not mutate input', () => {
    const s = spec(); const before = JSON.stringify(s);
    const r = validateAppSpec(s);
    expect(r).toMatchObject({ ok: true, issues: [] });
    expect(JSON.stringify(s)).toBe(before);
  });
  it('formatIssues renders "- path: message [code]" lines and caps the count', () => {
    const issues = Array.from({ length: 15 }, (_, i) => ({ path: `p.${i}`, code: 'c', message: `m${i}` }));
    const out = formatIssues(issues).split('\n');
    expect(out).toHaveLength(12);
    expect(out[0]).toBe('- p.0: m0 [c]');
    expect(formatIssues(issues, 2).split('\n')).toHaveLength(2);
    expect(formatIssues([])).toBe('');
  });
  it('joinPath joins keys with dots', () => expect(S.joinPath(['tables', 0, 'fields', 2])).toBe('tables.0.fields.2'));
});

describe('JSON Schema export', () => {
  it('z.toJSONSchema succeeds for the top-level schema and the tables block', () => {
    const out = z.toJSONSchema(S.AppSpecSchema);
    const input = z.toJSONSchema(S.AppSpecSchema, { io: 'input' });
    const block = z.toJSONSchema(S.TablesBlockSchema, { io: 'input' });
    const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;
    expect((out as D).type).toBe('object');
    expect(Object.keys((out as D).properties)).toEqual(expect.arrayContaining(['specVersion', 'app', 'tables', 'pages', 'nav', 'theme']));
    expect(Object.keys((input as D).properties)).toEqual(expect.arrayContaining(['specVersion', 'app', 'pages']));
    expect((block as D).type).toBe('object');
    console.log(`JSON_SCHEMA_BYTES output=${bytes(out)} input=${bytes(input)} tablesBlockInput=${bytes(block)}`);
    expect(bytes(out)).toBeGreaterThan(0);
  });
});
