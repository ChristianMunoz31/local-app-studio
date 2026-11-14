// Derived indexes (ADR-014): what pages sort, filter and group on, and what rules watch, becomes single column indexes in the
// compiled schema and in app-track migrations. Deterministic, capped per table, never a duplicate of a reference index.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileSpec, planMigration } from '../../spec/compile.js';
import { MAX_INDEXES_PER_TABLE, derivedIndexFields } from '../../spec/indexes.js';
import { normalizeSpec } from '../../spec/normalize.js';

const FIXTURE = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const crews = (spec) => spec.tables.find((t) => t.id === 'crews');

/** The fixture with its one page stripped of sources and parts, so only what a test adds creates an index. */
function bare() {
  const spec = fixture();
  spec.pages[0].sources = [];
  spec.pages[0].layout.children = [];
  return spec;
}

function withPage(spec, { sources = [], parts = [] }) {
  spec.pages[0].sources.push(...sources);
  spec.pages[0].layout.children.push(...parts);
  return spec;
}

const source = (extra) => ({ id: 's1', table: 'crews', where: [], orderBy: [], limit: 50, ...extra });
const part = (type, props) => ({ id: `${type.toLowerCase()}_1`, type, props, children: [] });
const fieldsOf = (spec, table = 'crews') => derivedIndexFields(normalizeSpec(spec)).get(table);
/** createSql (reference indexes) then indexSql (derived ones): what a fresh database is given. createSql itself never carries a derived index (ADR-014). */
function schema(spec) {
  const c = compileSpec(spec);
  expect(c.createSql).not.toContain('IF NOT EXISTS');
  return c.createSql + c.indexSql;
}
const indexNames = (sql) => [...sql.matchAll(/CREATE INDEX (?:IF NOT EXISTS )?"([^"]+)"/g)].map((m) => m[1]);

describe('derived index sources', () => {
  it('a spec with no page use has no derived index', () => {
    expect(fieldsOf(bare())).toEqual([]);
  });

  it('indexes the first orderBy field of a list source', () => {
    const spec = withPage(bare(), { sources: [source({ orderBy: [{ field: 'size', dir: 'desc' }, { field: 'name', dir: 'asc' }] })] });
    expect(fieldsOf(spec)).toEqual(['size']);
  });

  it('indexes the fields of a SortControl', () => {
    const spec = withPage(bare(), { sources: [source()], parts: [part('SortControl', { source: 's1', fields: ['name', 'size'] })] });
    expect(fieldsOf(spec)).toEqual(['name', 'size']);
  });

  it('indexes where fields of a source and the fields of a FilterBar', () => {
    const spec = withPage(bare(), {
      sources: [source({ where: [{ field: 'size', op: 'gt', value: 1 }] })],
      parts: [part('FilterBar', { source: 's1', fields: ['status'] })],
    });
    expect(fieldsOf(spec)).toEqual(['size', 'status']);
  });

  it('indexes the group by field of a Chart', () => {
    const spec = withPage(bare(), { sources: [source()], parts: [part('Chart', { source: 's1', groupBy: 'status' })] });
    expect(fieldsOf(spec)).toEqual(['status']);
  });

  it('does not index a date group by (it is bucketed by an expression)', () => {
    const spec = bare();
    crews(spec).fields.push({ id: 'starts', label: 'Starts', type: 'date' });
    withPage(spec, { sources: [source()], parts: [part('Chart', { source: 's1', groupBy: 'starts' })] });
    expect(fieldsOf(spec)).toEqual([]);
  });

  it('indexes the status field a rule watches', () => {
    const spec = bare();
    crews(spec).rules = [{ when: { field: 'status', is: 'paused' }, then: [{ set: 'size', to: 'clear' }] }];
    expect(fieldsOf(spec)).toEqual(['status']);
  });

  it('skips reference and longtext fields and record sources', () => {
    const spec = bare();
    crews(spec).fields.push({ id: 'notes', label: 'Notes', type: 'longtext' });
    withPage(spec, {
      sources: [
        source({ orderBy: [{ field: 'notes', dir: 'asc' }] }),
        source({ id: 's2', where: [{ field: 'lead_id', op: 'eq', value: 'x' }] }),
        source({ id: 's3', mode: 'record', orderBy: [{ field: 'size', dir: 'asc' }] }),
      ],
    });
    expect(fieldsOf(spec)).toEqual([]);
  });

  it('ignores a part that names an unknown source or field', () => {
    const spec = withPage(bare(), {
      sources: [source()],
      parts: [part('SortControl', { source: 'nope', fields: ['size'] }), part('FilterBar', { source: 's1', fields: ['ghost'] })],
    });
    expect(fieldsOf(spec)).toEqual([]);
  });
});

describe('derived index compile output', () => {
  it('writes CREATE INDEX IF NOT EXISTS after the reference index, with the existing naming', () => {
    const spec = withPage(bare(), { sources: [source({ orderBy: [{ field: 'size', dir: 'asc' }] })] });
    const sql = planMigration(null, spec).file.sql;
    expect(sql).toContain('CREATE INDEX "idx:crews:lead_id" ON "crews" ("lead_id");\nCREATE INDEX IF NOT EXISTS "idx:crews:size" ON "crews" ("size");');
  });

  it('never repeats a reference index', () => {
    const spec = withPage(bare(), {
      sources: [source({ orderBy: [{ field: 'lead_id', dir: 'asc' }], where: [{ field: 'lead_id', op: 'eq', value: 'x' }] })],
      parts: [part('FilterBar', { source: 's1', fields: ['lead_id'] })],
    });
    const names = indexNames(schema(spec));
    expect(names.filter((n) => n === 'idx:crews:lead_id')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is byte identical for the same spec, and the script runs on SQLite', () => {
    const spec = withPage(bare(), {
      sources: [source({ orderBy: [{ field: 'size', dir: 'asc' }], where: [{ field: 'status', op: 'eq', value: 'active' }] })],
    });
    const a = schema(spec);
    expect(schema(JSON.parse(JSON.stringify(spec)))).toBe(a);
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    db.exec(a);
    const found = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx:%' ORDER BY name").all();
    expect(found.map((r) => r.name)).toEqual(['idx:crews:lead_id', 'idx:crews:size', 'idx:crews:status']);
  });

  it('lists winners in field order, not in the order the pages asked', () => {
    const spec = withPage(bare(), { sources: [source({ orderBy: [{ field: 'status', dir: 'asc' }], where: [{ field: 'name', op: 'eq', value: 'a' }] })] });
    expect(fieldsOf(spec)).toEqual(['name', 'status']);
  });
});

describe('the per table cap', () => {
  function wide(refs) {
    const spec = bare();
    const t = crews(spec);
    t.fields = [{ id: 'name', label: 'Name', type: 'text', required: true }];
    for (let i = 0; i < refs; i += 1) t.fields.push({ id: `r${i}`, label: `R${i}`, type: 'reference', table: 'people' });
    for (let i = 0; i < 10; i += 1) t.fields.push({ id: `f${i}`, label: `F${i}`, type: 'integer' });
    return spec;
  }

  it('keeps reference and derived indexes at the cap together', () => {
    const spec = wide(3);
    withPage(spec, { sources: [source({ where: [...Array(10).keys()].map((i) => ({ field: `f${i}`, op: 'gt', value: 0 })) })] });
    expect(MAX_INDEXES_PER_TABLE).toBe(8);
    expect(fieldsOf(spec)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    expect(indexNames(schema(spec))).toHaveLength(8);
  });

  it('sort beats filter beats group beats status when over the cap', () => {
    const spec = wide(5);
    crews(spec).rules = [{ when: { field: 'name', is: 'x' }, then: [{ set: 'f9', to: { value: 1 } }] }];
    withPage(spec, {
      sources: [source({ orderBy: [{ field: 'f5', dir: 'asc' }], where: [{ field: 'f1', op: 'gt', value: 0 }, { field: 'f2', op: 'gt', value: 0 }] })],
    });
    // Three slots: the sort field, then the first two filter fields; the rule's field loses.
    expect(fieldsOf(spec)).toEqual(['f1', 'f2', 'f5']);
  });

  it('a table with eight or more reference fields gets no derived index and keeps every reference index', () => {
    const spec = wide(9);
    withPage(spec, { sources: [source({ orderBy: [{ field: 'f1', dir: 'asc' }] })] });
    expect(fieldsOf(spec)).toEqual([]);
    expect(indexNames(schema(spec))).toHaveLength(9);
  });
});

describe('planMigration and derived indexes', () => {
  const fieldsAdded = () => {
    const spec = fixture();
    crews(spec).fields.push({ id: 'notes', label: 'Notes', type: 'text' });
    return spec;
  };

  it('a new use adds only the index', () => {
    const old = fixture();
    const next = fixture();
    next.pages[0].sources[0].orderBy = [{ field: 'size', dir: 'asc' }];
    const plan = planMigration(old, next);
    expect(plan.ok).toBe(true);
    expect(plan.file.sql).toBe(
      '-- app-migration: alter\n-- Generated from the app spec by Local App Studio. Do not edit.\n\n' +
        'CREATE INDEX IF NOT EXISTS "idx:crews:size" ON "crews" ("size");\n',
    );
  });

  it('a new page that sorts on a field adds that index', () => {
    const next = fixture();
    next.pages.push({
      id: 'more',
      title: 'More',
      route: '/more',
      sources: [source({ id: 'by_size', orderBy: [{ field: 'size', dir: 'desc' }] })],
      layout: { id: 'root2', type: 'Page', props: {}, children: [] },
    });
    const plan = planMigration(fixture(), next);
    expect(indexNames(plan.file.sql)).toEqual(['idx:crews:size']);
    expect(plan.file.sql).not.toContain('ALTER');
  });

  it('removing a use plans nothing and drops nothing', () => {
    const old = fixture();
    const next = fixture();
    next.pages[0].sources[0].orderBy = [];
    next.pages[0].sources[0].where = [];
    expect(planMigration(old, next)).toEqual({ ok: true, file: null });
    expect(planMigration(old, next)).not.toHaveProperty('drop');
  });

  it('an app built before derived indexes catches up on its next schema change', () => {
    const old = fixture();
    const legacy = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    legacy.exec(
      compileSpec(old)
        .createSql.split('\n')
        .filter((line) => !line.startsWith('CREATE INDEX IF NOT EXISTS'))
        .join('\n'),
    );
    const before = legacy.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx:%'").all();
    expect(before.map((r) => r.name)).toEqual(['idx:crews:lead_id']);

    const plan = planMigration(old, fieldsAdded());
    expect(plan.ok).toBe(true);
    expect(plan.file.sql).toContain('ALTER TABLE "crews" ADD COLUMN "notes" TEXT');
    expect(indexNames(plan.file.sql).sort()).toEqual(['idx:crews:name', 'idx:crews:status']);
    legacy.exec(plan.file.sql);
    legacy.exec(plan.file.sql.replace('ADD COLUMN "notes" TEXT', 'ADD COLUMN "notes2" TEXT'));
    const after = legacy.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx:%' ORDER BY name").all();
    expect(after.map((r) => r.name)).toEqual(['idx:crews:lead_id', 'idx:crews:name', 'idx:crews:status']);
  });

  it('a rebuild recreates the reference and derived indexes', () => {
    const next = fixture();
    crews(next).fields.find((f) => f.id === 'status').options.push('retired');
    const plan = planMigration(fixture(), next);
    expect(plan.file.sql.startsWith('-- app-migration: rebuild')).toBe(true);
    expect(indexNames(plan.file.sql).sort()).toEqual(['idx:crews:lead_id', 'idx:crews:name', 'idx:crews:status']);
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    db.exec(compileSpec(fixture()).createSql);
    db.exec(plan.file.sql);
  });

  it('a new table with a sorted page gets its derived indexes in the same block', () => {
    const next = fixture();
    next.tables.push({
      id: 'vehicles',
      label: 'Vehicles',
      fields: [{ id: 'plate', label: 'Plate', type: 'text', required: true }],
    });
    next.pages[0].sources.push(source({ id: 'cars', table: 'vehicles', orderBy: [{ field: 'plate', dir: 'asc' }] }));
    const plan = planMigration(fixture(), next);
    expect(plan.file.sql).toContain('CREATE TABLE "vehicles"');
    expect(plan.file.sql).toContain('CREATE INDEX IF NOT EXISTS "idx:vehicles:plate" ON "vehicles" ("plate");');
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    db.exec(compileSpec(fixture()).createSql);
    db.exec(plan.file.sql);
  });

  it('removing a field or a table is still refused, never a broken plan', () => {
    const noField = fixture();
    crews(noField).fields = crews(noField).fields.filter((f) => f.id !== 'status');
    noField.pages[0].sources[0].where = [];
    expect(planMigration(fixture(), noField).ok).toBe(false);
    const noTable = fixture();
    noTable.tables = noTable.tables.filter((t) => t.id !== 'crews');
    noTable.pages[0].sources = [];
    noTable.pages[0].layout.children = [];
    expect(planMigration(fixture(), noTable).ok).toBe(false);
  });

  it('is deterministic', () => {
    const next = fieldsAdded();
    expect(planMigration(fixture(), next)).toEqual(planMigration(fixture(), next));
  });
});
