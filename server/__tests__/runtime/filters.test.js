// Run-time filters, search, sort and paging of the generic data API, revalidated in plain JS (params.js), plus the record
// validator. Pure: the compiled Crew Roster fixture with a few extra fields, no database.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileSpec, normalizeSpec } from '../../spec/compile.js';
import { MAX_FILTERS, MAX_IN_VALUES, parseDataQuery, validateFilters } from '@local-app-studio/runtime/server/params.js';
import { validateRecord } from '@local-app-studio/runtime/server/validate.js';

const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json'), 'utf8'));
raw.tables.find((t) => t.id === 'crews').fields.push(
  { id: 'budget', label: 'Budget', type: 'real' },
  { id: 'started', label: 'Started', type: 'date' },
  { id: 'opened_at', label: 'Opened', type: 'datetime' },
  { id: 'active', label: 'Active', type: 'boolean' },
  { id: 'notes', label: 'Notes', type: 'longtext' },
);
const spec = normalizeSpec(raw);
const compiled = compileSpec(spec);

const filters = (list) => validateFilters(compiled, 'crews', list);
const f = (field, op, value) => ({ field, op, value });
const query = (q) => parseDataQuery(compiled, spec, 'crews', q);
const refused = (result, field) => {
  expect(result.ok).toBe(false);
  if (field) expect(result.field).toBe(field);
};

describe('filter validation', () => {
  it('accepts every operator on a fitting field', () => {
    for (const list of [
      [f('name', 'eq', 'x')],
      [f('name', 'ne', 'x')],
      [f('size', 'gt', 1), f('size', 'lte', 9)],
      [f('budget', 'gte', 1.5)],
      [f('started', 'lt', '2025-01-31')],
      [f('opened_at', 'gte', '2025-01-31T10:00:00Z')],
      [f('status', 'in', ['active', 'paused'])],
      [f('active', 'eq', true)],
      [f('lead_id', 'eq', null)],
      [f('id', 'in', ['a', 'b'])],
      [f('created_at', 'gt', '2025-01-01T00:00:00+02:00')],
    ]) {
      expect(filters(list).ok, JSON.stringify(list)).toBe(true);
    }
  });

  it('refuses unknown fields, operators and non-lists', () => {
    refused(filters([f('nope', 'eq', 1)]), 'filter');
    refused(filters([f('name', 'like', 'x')]), 'filter');
    refused(filters([f('name', 'in', 'x')]), 'filter');
    refused(filters('x'), 'filter');
    refused(filters([null]), 'filter');
    refused(filters([f('__proto__', 'eq', 1)]), 'filter');
  });

  it('refuses ordering operators on boolean, select, reference and id', () => {
    for (const field of ['active', 'status', 'lead_id', 'id']) refused(filters([f(field, 'gt', field === 'active' ? true : 'x')]));
    expect(filters([f('size', 'gt', 1)]).ok).toBe(true);
  });

  it('refuses a null value except with eq and ne', () => {
    expect(filters([f('size', 'eq', null)]).ok).toBe(true);
    expect(filters([f('size', 'ne', null)]).ok).toBe(true);
    refused(filters([f('size', 'gt', null)]));
    refused(filters([f('size', 'in', [null])]));
  });

  it('refuses values that do not fit the field', () => {
    for (const bad of [
      f('size', 'eq', '3'),
      f('size', 'eq', 1.5),
      f('size', 'eq', Number.MAX_SAFE_INTEGER + 1),
      f('budget', 'eq', 'x'),
      f('budget', 'eq', Infinity),
      f('active', 'eq', 'true'),
      f('started', 'eq', '2025-02-30'),
      f('started', 'eq', '2025-02-01T00:00:00Z'),
      f('opened_at', 'eq', '2025-02-01T10:00:00'),
      f('opened_at', 'eq', 'yesterday'),
      f('status', 'eq', 'gone'),
      f('name', 'eq', 5),
      f('name', 'eq', { $ne: 1 }),
    ]) {
      refused(filters([bad]), 'filter');
    }
  });

  it('canonicalizes dates and datetimes', () => {
    expect(filters([f('opened_at', 'eq', '2025-01-31T12:00:00+02:00')]).ok).toBe(true);
  });

  it('limits the number of filters and of in values, and refuses the same field and operator twice', () => {
    refused(filters(Array.from({ length: MAX_FILTERS + 1 }, (_, i) => f('size', i % 2 ? 'gt' : 'lt', i))));
    expect(filters(Array.from({ length: MAX_FILTERS }, (_, i) => f(['size', 'budget', 'name', 'status', 'started', 'active', 'lead_id', 'id'][i], 'eq', null))).ok).toBe(true);
    refused(filters([f('name', 'in', Array.from({ length: MAX_IN_VALUES + 1 }, (_, i) => `n${i}`))]));
    expect(filters([f('name', 'in', Array.from({ length: MAX_IN_VALUES }, (_, i) => `n${i}`))]).ok).toBe(true);
    refused(filters([f('size', 'gt', 1), f('size', 'gt', 2)]));
    expect(filters([f('size', 'gt', 1), f('size', 'lt', 2)]).ok).toBe(true);
  });

  it('never reports the offending value', () => {
    const r = filters([f('size', 'eq', 'SECRET-VALUE')]);
    expect(JSON.stringify(r)).not.toContain('SECRET-VALUE');
  });
});

describe('parseDataQuery', () => {
  it('defaults: created_at desc then id asc, limit 50, offset 0, no where, no search', () => {
    const q = query({});
    expect(q).toMatchObject({ ok: true, where: undefined, search: undefined, limit: 50, offset: 0 });
    expect(q.orderBy).toEqual([
      { column: 'created_at', dir: 'desc' },
      { column: 'id', dir: 'asc' },
    ]);
  });

  it('takes where, order and limit from the page source, and sort overrides the order', () => {
    const q = query({ page: 'home', source: 'open_crews' });
    expect(q.ok).toBe(true);
    expect(q.limit).toBe(50);
    expect(q.orderBy[0]).toEqual({ column: 'name', dir: 'asc', nocase: true });
    expect(Object.keys(q.where)).toEqual(['status']);
    const sorted = query({ page: 'home', source: 'open_crews', sort: 'size:desc', limit: '7' });
    expect(sorted.orderBy[0]).toEqual({ column: 'size', dir: 'desc' });
    expect(sorted.limit).toBe(7);
  });

  it('puts run-time conditions in one $or alternative next to the source conditions', () => {
    const q = query({ page: 'home', source: 'open_crews', filter: JSON.stringify([f('status', 'eq', 'active'), f('size', 'gte', 2)]) });
    expect(q.ok).toBe(true);
    expect(Object.keys(q.where)).toEqual(['status', '$or']);
    expect(q.where.$or).toHaveLength(1);
    expect(Object.keys(q.where.$or[0])).toEqual(['status', 'size']);
  });

  it('wants page and source together, a list source of this table', () => {
    refused(query({ page: 'home' }), 'source');
    refused(query({ source: 'open_crews' }), 'page');
    refused(query({ page: 'home', source: 'zzz' }), 'source');
    refused(parseDataQuery(compiled, spec, 'people', { page: 'home', source: 'open_crews' }), 'source');
    const recordSpec = structuredClone(spec);
    recordSpec.pages[0].sources[0].mode = 'record';
    refused(parseDataQuery(compiled, recordSpec, 'crews', { page: 'home', source: 'open_crews' }), 'source');
  });

  it('searches every text field by default and only the listed ones with searchFields', () => {
    expect(query({ search: 'ab' }).search).toEqual({ term: 'ab', columns: ['name', 'notes'] });
    expect(query({ search: 'ab', searchFields: 'notes' }).search.columns).toEqual(['notes']);
    refused(query({ search: 'ab', searchFields: 'status' }), 'searchFields');
    refused(query({ search: 'x'.repeat(201) }), 'search');
    expect(query({ search: '   ' }).search).toBeUndefined();
    refused(parseDataQuery(compiled, spec, 'people', { search: 'a', searchFields: 'zzz' }), 'searchFields');
  });

  it('sorts by up to three fields, runtime columns included, and refuses anything else', () => {
    expect(query({ sort: 'updated_at:desc,name' }).orderBy.map((o) => o.column)).toEqual(['updated_at', 'name', 'id']);
    expect(query({ sort: 'id:desc' }).orderBy).toEqual([{ column: 'id', dir: 'desc' }]);
    refused(query({ sort: 'a:asc,b:asc,c:asc,d:asc' }), 'sort');
    refused(query({ sort: 'name:asc:x' }), 'sort');
    refused(query({ sort: 'rowid' }), 'sort');
    refused(query({ sort: ['name'] }), 'sort');
  });

  it('bounds limit (1 to 200) and offset (0 to 100000)', () => {
    expect(query({ limit: '200', offset: '100000' })).toMatchObject({ limit: 200, offset: 100000 });
    refused(query({ limit: '0' }), 'limit');
    refused(query({ limit: '1.5' }), 'limit');
    refused(query({ offset: '100001' }), 'offset');
    refused(query({ limit: ['5'] }), 'limit');
  });

  it('stats mode ignores sort, limit and offset', () => {
    const q = parseDataQuery(compiled, spec, 'crews', { sort: 'bogus', limit: '9999', offset: 'x' }, { stats: true });
    expect(q.ok).toBe(true);
  });
});

describe('validateRecord', () => {
  const ok = (input, opts) => validateRecord(compiled, 'crews', input, opts);

  it('coerces numeric and boolean strings and canonicalizes dates', () => {
    const r = ok({ name: 'A', size: '4', budget: '2.50', active: 'false', started: '2025-03-01', opened_at: '2025-03-01T10:00:00+02:00' });
    expect(r).toEqual({ ok: true, row: { name: 'A', size: 4, budget: 2.5, active: false, started: '2025-03-01', opened_at: '2025-03-01T08:00:00.000Z' } });
  });

  it('needs required fields on create and tolerates missing ones on patch', () => {
    expect(ok({}).field).toBe('name');
    expect(ok({}, { partial: true })).toEqual({ ok: true, row: {} });
    expect(ok({ name: null }, { partial: true }).message).toBe('Name is required.');
  });

  it('treats an empty string as no value for non-text fields', () => {
    expect(ok({ name: 'A', size: '', started: '' }).row).toEqual({ name: 'A', size: null, started: null });
    expect(ok({ name: '' }).message).toBe('Name is required.');
  });

  it('enforces maxLength of text and longtext', () => {
    expect(ok({ name: 'x'.repeat(500) }).ok).toBe(true);
    expect(ok({ name: 'x'.repeat(501) }).ok).toBe(false);
    expect(ok({ name: 'A', notes: 'x'.repeat(20000) }).ok).toBe(true);
    expect(ok({ name: 'A', notes: 'x'.repeat(20001) }).ok).toBe(false);
  });

  it('refuses unknown keys, server columns and prototype keys', () => {
    expect(ok({ name: 'A', zzz: 1 })).toMatchObject({ ok: false, field: 'zzz' });
    expect(ok(JSON.parse('{"name":"A","__proto__":1}'))).toMatchObject({ ok: false, field: '__proto__' });
    expect(ok({ name: 'A', updated_at: 'x' })).toMatchObject({ ok: false, field: 'updated_at' });
    expect(ok('x')).toMatchObject({ ok: false, field: 'body' });
  });
});
