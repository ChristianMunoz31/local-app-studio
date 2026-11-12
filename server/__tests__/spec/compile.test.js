// Compiler and migration planner: byte-exact golden files (UPDATE_GOLDEN=1 rewrites them), determinism, and every
// generated script runs on a fresh in-memory database.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { checkSpecShape, compileSpec, normalizeSpec, planMigration } from '../../spec/compile.js';

const FIXTURE = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const GOLDEN = new URL('./golden/', import.meta.url);
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

function golden(name, actual) {
  const file = new URL(name, GOLDEN);
  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(file, actual, 'utf8');
  }
  expect(actual).toBe(fs.readFileSync(file, 'utf8'));
}

const freshDb = () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  return db;
};

function withEdit(edit) {
  const spec = fixture();
  edit(spec);
  return spec;
}
const crews = (spec) => spec.tables.find((t) => t.id === 'crews');

const PLANS = {
  'plan-new-table.sql': (s) =>
    s.tables.push({
      id: 'vehicles',
      label: 'Vehicles',
      fields: [
        { id: 'plate', label: 'Plate', type: 'text', required: true },
        { id: 'crew_id', label: 'Crew', type: 'reference', table: 'crews' },
      ],
    }),
  'plan-add-optional.sql': (s) => {
    crews(s).fields.push({ id: 'notes', label: 'Notes', type: 'longtext' });
    crews(s).fields.push({ id: 'backup_id', label: 'Backup', type: 'reference', table: 'people' });
  },
  'plan-add-required-default.sql': (s) =>
    crews(s).fields.push({ id: 'priority', label: 'Priority', type: 'integer', required: true, default: 3 }),
  'plan-rebuild-option.sql': (s) => {
    crews(s).fields.find((f) => f.id === 'status').options.push('retired');
  },
};

describe('normalizeSpec', () => {
  it('fills defaults, is idempotent and never mutates its input', () => {
    const input = fixture();
    delete input.theme;
    delete input.tables[0].fields[0].required;
    const before = JSON.stringify(input);
    const once = normalizeSpec(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(once.theme).toEqual({ preset: 'aurora', radius: 'md' });
    expect(once.tables[0].fields[0].required).toBe(false);
    expect(normalizeSpec(once)).toEqual(once);
    expect(normalizeSpec(null)).toBeNull();
    expect(normalizeSpec(undefined)).toBeNull();
  });

  it('fills page sources, modes and order directions', () => {
    const spec = { pages: [{ id: 'a', route: '/' }, { id: 'b', route: '/b', sources: [{ id: 's', table: 't', orderBy: [{ field: 'x' }] }] }] };
    const out = normalizeSpec(spec);
    expect(out.pages[0].sources).toEqual([]);
    expect(out.pages[1].sources[0]).toMatchObject({ mode: 'list', where: [], limit: 50, orderBy: [{ field: 'x', dir: 'asc' }] });
    expect(out.tables).toEqual([]);
    expect(out.nav).toEqual([]);
  });
});

describe('compileSpec golden files', () => {
  it('matches the create script and compiled JSON byte for byte', () => {
    const { createSql, ...rest } = compileSpec(fixture());
    golden('crew-roster.create.sql', createSql);
    golden('crew-roster.compiled.json', `${JSON.stringify(rest, null, 2)}\n`);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(compileSpec(fixture()))).toBe(JSON.stringify(compileSpec(fixture())));
    const text = compileSpec(fixture()).createSql;
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\r');
  });

  it('creates strict tables that enforce the checks', () => {
    const db = freshDb();
    db.exec(compileSpec(fixture()).createSql);
    const now = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO "people" VALUES (?, ?, ?, ?)').run('p1', 'Ann', now, now);
    db.prepare('INSERT INTO "crews" ("id","name","lead_id","created_at","updated_at") VALUES (?,?,?,?,?)').run('c1', 'A', 'p1', now, now);
    expect(db.prepare('SELECT "size", "status" FROM "crews"').get()).toMatchObject({ size: 1, status: 'active' });
    expect(() => db.prepare('INSERT INTO "crews" ("id","name","status","created_at","updated_at") VALUES (?,?,?,?,?)').run('c2', 'B', 'bogus', now, now)).toThrow();
    db.prepare('DELETE FROM "people" WHERE "id" = ?').run('p1');
    expect(db.prepare('SELECT "lead_id" FROM "crews"').get().lead_id).toBeNull();
  });

  it('orders tables by references and uses restrict for required references', () => {
    const spec = withEdit((s) => {
      s.tables.unshift({ id: 'jobs', label: 'Jobs', fields: [{ id: 'crew_id', label: 'Crew', type: 'reference', table: 'crews', required: true }] });
    });
    const c = compileSpec(spec);
    expect(c.importOrder).toEqual(['people', 'crews', 'jobs']);
    expect(c.foreignKeys.at(-1)).toEqual({ table: 'jobs', column: 'crew_id', references: { table: 'crews', column: 'id' }, onDelete: 'restrict' });
    expect(c.titleFields.jobs).toBe('id');
    expect(c.validators.crews.status).toEqual({ type: 'select', label: 'Status', required: false, options: ['active', 'paused'], default: 'active' });
    expect(c.validators.crews.name.maxLength).toBe(500);
    expect(c.categories[0]).toEqual({ id: 'jobs', default: false, noun: 'jobs', plural: true });
  });

  it('escapes quotes in options and defaults', () => {
    const spec = withEdit((s) => {
      s.tables[0].fields.push({ id: 'kind', label: 'Kind', type: 'select', options: ["it's", 'b'], default: "it's" });
    });
    const db = freshDb();
    db.exec(compileSpec(spec).createSql);
    expect(db.prepare('PRAGMA table_info("people")').all().find((c) => c.name === 'kind').dflt_value).toBe("'it''s'");
  });
});

describe('host time zone independence', () => {
  it('produces byte-identical createSql under another TZ', () => {
    const spec = withEdit((s) => {
      crews(s).fields.push({ id: 'at', label: 'At', type: 'datetime', default: '2025-01-01T09:00:00+02:00' });
    });
    const script = `
      import('${new URL('../../spec/compile.js', import.meta.url).href}').then((m) => {
        process.stdout.write(m.compileSpec(JSON.parse(process.env.SPEC)).createSql);
      });`;
    const run = (tz) =>
      execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz, SPEC: JSON.stringify(spec) }, encoding: 'utf8' });
    const utc = run('UTC');
    expect(run('America/New_York')).toBe(utc);
    expect(utc).toContain("DEFAULT '2025-01-01T07:00:00.000Z'");
  });
});

describe('checkSpecShape', () => {
  it('accepts the fixture', () => {
    expect(checkSpecShape(fixture())).toBeNull();
  });

  const bad = {
    'a non-object': () => 'nope',
    'a wrong version': (s) => { s.specVersion = 2; },
    'a bad table id': (s) => { s.tables[0].id = 'People'; },
    'a reserved table id': (s) => { s.tables[0].id = 'items'; },
    'a reserved prefix': (s) => { s.tables[0].id = 'app_things'; },
    'a duplicate table id': (s) => { s.tables[1].id = 'people'; },
    'a reserved field id': (s) => { s.tables[0].fields[0].id = 'created_at'; },
    'a duplicate field id': (s) => { s.tables[0].fields.push({ ...s.tables[0].fields[0] }); },
    'an unknown field type': (s) => { s.tables[0].fields[0].type = 'blob'; },
    'a select without options': (s) => { delete crews(s).fields[3].options; },
    'a reference to nowhere': (s) => { crews(s).fields[2].table = 'ghosts'; },
    'a self reference': (s) => { crews(s).fields[2].table = 'crews'; },
    'a table with no fields': (s) => { s.tables[0].fields = []; },
    'no pages': (s) => { s.pages = []; },
    'a source on an unknown table': (s) => { s.pages[0].sources[0].table = 'ghosts'; },
    'an unsafe default': (s) => { crews(s).fields[1].default = 'x'; },
    'a datetime default without a zone': (s) => { crews(s).fields.push({ id: 'at', label: 'At', type: 'datetime', default: '2025-01-01T09:00' }); },
    'an impossible datetime default': (s) => { crews(s).fields.push({ id: 'at', label: 'At', type: 'datetime', default: '2025-02-30T09:00:00Z' }); },
    'a select default outside its options': (s) => { crews(s).fields[3].default = 'bogus'; },
    'a non-canonical date default': (s) => { crews(s).fields.push({ id: 'day', label: 'Day', type: 'date', default: '2025-1-5' }); },
    'an impossible date default': (s) => { crews(s).fields.push({ id: 'day', label: 'Day', type: 'date', default: '2025-02-30' }); },
    'a text default over 500 characters': (s) => { crews(s).fields.push({ id: 'tx', label: 'Tx', type: 'text', default: 'a'.repeat(501) }); },
    'a longtext default over 20000 characters': (s) => { crews(s).fields.push({ id: 'lt', label: 'Lt', type: 'longtext', default: 'a'.repeat(20001) }); },
  };
  it.each(Object.keys(bad))('refuses %s', (name) => {
    const spec = fixture();
    const replaced = bad[name](spec);
    const problem = checkSpecShape(replaced ?? spec);
    expect(typeof problem).toBe('string');
    if (replaced === undefined) expect(() => compileSpec(spec)).toThrow(/^invalid_spec: /);
  });

  it('refuses a loop between two tables', () => {
    const spec = withEdit((s) => {
      s.tables[0].fields.push({ id: 'crew_id', label: 'Crew', type: 'reference', table: 'crews' });
    });
    expect(checkSpecShape(spec)).toMatch(/loop/);
  });
});

describe('planMigration', () => {
  it('a first build is the create script as 001_app.sql', () => {
    const plan = planMigration(null, fixture());
    expect(plan.ok).toBe(true);
    expect(plan.file.name).toBe('001_app.sql');
    expect(plan.file.sql).toBe(compileSpec(fixture()).createSql);
    expect(planMigration(null, fixture(), { version: 7 }).file.name).toBe('007_app.sql');
  });

  it('an unchanged spec and cosmetic edits plan nothing', () => {
    const next = withEdit((s) => {
      s.app.description = 'Other';
      s.theme.radius = 'lg';
      crews(s).label = 'Teams';
      crews(s).fields.reverse();
      s.tables.reverse();
      s.nav[0].label = 'Start';
    });
    expect(planMigration(fixture(), next)).toEqual({ ok: true, file: null });
  });

  it('an invalid next spec is one root issue', () => {
    const plan = planMigration(fixture(), { specVersion: 1 });
    expect(plan.ok).toBe(false);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toMatchObject({ path: '(root)', code: 'invalid_spec' });
  });

  describe.each(Object.keys(PLANS))('%s', (file) => {
    const plan = planMigration(fixture(), withEdit(PLANS[file]));

    it('matches the golden file', () => {
      expect(plan.ok).toBe(true);
      expect(plan.file.name).toBe('002_app.sql');
      golden(file, plan.file.sql);
    });

    it('runs on a database holding the built schema and keeps its rows', () => {
      const db = freshDb();
      db.exec(compileSpec(fixture()).createSql);
      const now = '2026-01-01T00:00:00.000Z';
      db.prepare('INSERT INTO "people" VALUES (?, ?, ?, ?)').run('p1', 'Ann', now, now);
      db.prepare('INSERT INTO "crews" ("id","name","lead_id","size","status","created_at","updated_at") VALUES (?,?,?,?,?,?,?)').run('c1', 'A', 'p1', 4, 'paused', now, now);
      const rebuild = plan.file.sql.startsWith('-- app-migration: rebuild');
      if (rebuild) db.exec('PRAGMA foreign_keys = OFF');
      db.exec(plan.file.sql);
      if (rebuild) {
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        db.exec('PRAGMA foreign_keys = ON');
      }
      expect(db.prepare('SELECT "id", "lead_id", "size", "status", "created_at" FROM "crews"').get()).toEqual({
        id: 'c1', lead_id: 'p1', size: 4, status: 'paused', created_at: now,
      });
    });

    it('is deterministic', () => {
      expect(planMigration(fixture(), withEdit(PLANS[file])).file.sql).toBe(plan.file.sql);
    });
  });

  it('uses the kinds alter, rebuild and create-only alter', () => {
    expect(planMigration(fixture(), withEdit(PLANS['plan-add-optional.sql'])).file.sql.startsWith('-- app-migration: alter\n')).toBe(true);
    expect(planMigration(fixture(), withEdit(PLANS['plan-rebuild-option.sql'])).file.sql.startsWith('-- app-migration: rebuild\n')).toBe(true);
    expect(planMigration(fixture(), withEdit(PLANS['plan-new-table.sql'])).file.sql.startsWith('-- app-migration: alter\n')).toBe(true);
  });

  it('rebuilds for optional, default and widening edits and keeps the data', () => {
    const edits = [
      (s) => { s.tables[0].fields[0].required = false; },
      (s) => { delete crews(s).fields[1].default; },
      (s) => { crews(s).fields[1].type = 'real'; },
      (s) => { crews(s).fields[3].options.reverse(); },
    ];
    for (const edit of edits) {
      const plan = planMigration(fixture(), withEdit(edit));
      expect(plan.ok).toBe(true);
      expect(plan.file.sql).toContain('-- app-migration: rebuild');
      expect(plan.file.sql).toContain(':new"');
    }
  });

  it('refuses destructive edits with a path and a workaround', () => {
    const cases = [
      [(s) => { crews(s).fields.pop(); }, 'tables.1.fields'],
      [(s) => { crews(s).fields[0].type = 'integer'; }, 'tables.1.fields.0'],
      [(s) => { crews(s).fields[2].required = true; }, 'tables.1.fields.2'],
      [(s) => { crews(s).fields[3].options = ['active']; }, 'tables.1.fields.3'],
      [(s) => { crews(s).fields.push({ id: 'x', label: 'X', type: 'text', required: true }); }, 'tables.1.fields.4'],
      [(s) => { crews(s).fields.push({ id: 'x', label: 'X', type: 'reference', table: 'people', required: true }); }, 'tables.1.fields.4'],
    ];
    for (const [edit, path] of cases) {
      const plan = planMigration(fixture(), withEdit(edit));
      expect(plan.ok).toBe(false);
      expect(plan.issues[0]).toMatchObject({ path, code: 'destructive_change' });
      expect(plan.issues[0].message.length).toBeGreaterThan(20);
    }
  });

  it('refuses removing a table', () => {
    const built = withEdit((s) => {
      s.tables.push({ id: 'extra', label: 'Extra', fields: [{ id: 'n', label: 'N', type: 'text' }] });
    });
    const plan = planMigration(built, fixture());
    expect(plan.ok).toBe(false);
    expect(plan.issues[0]).toMatchObject({ path: 'tables', code: 'destructive_change' });
  });

  it('refuses a changed reference target and collects several issues', () => {
    const spec = withEdit((s) => {
      s.tables.push({ id: 'teams', label: 'Teams', fields: [{ id: 'n', label: 'N', type: 'text' }] });
      crews(s).fields[2].table = 'teams';
      crews(s).fields.pop();
    });
    const plan = planMigration(fixture(), spec);
    expect(plan.ok).toBe(false);
    expect(plan.issues.map((i) => i.path)).toEqual(['tables.1.fields', 'tables.1.fields.2']);
  });
});
