// B1 A1.6 to A1.8 (DESIGN-phase11.md 2.1): planMigration between random accepted specs plans or refuses with a plain reason, never
// throws, and no SQL it (or compileSpec) emits holds an identifier outside the allowlist or a hostile string outside a quoted
// literal. The scripts are also run on a real in-memory SQLite database. Seeds are fixed; a failure message starts with the seed.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { compileSpec, planMigration } from '../../spec/compile.js';
import {
  HOSTILE_STRINGS,
  accepted,
  evolve,
  forSeeds,
  genSpec,
  identifierAllowlist,
  mulberry32,
  quotedIdentifiers,
  withoutLiterals,
} from '../../../src/test-utils/specFuzz.ts';

const SEEDS = 150;

/** The hostile strings that can be recognized in SQL text (the one-character ones appear in every statement). */
const RECOGNIZABLE = HOSTILE_STRINGS.filter((s) => s.length > 3 && s.length < 100 && s !== 'CON' && s !== 'x.');

function pair(seed) {
  const rand = mulberry32(seed);
  const a = accepted(genSpec(rand, { sources: false }));
  if (a === null) return null;
  const b = accepted(evolve(rand, a));
  return b === null ? null : { a, b };
}

function expectOnlyAllowedSql(sql, ...specs) {
  const allowed = identifierAllowlist(...specs);
  for (const id of quotedIdentifiers(sql)) expect(allowed.has(id), `identifier ${JSON.stringify(id)} is not in the allowlist`).toBe(true);
  const bare = withoutLiterals(sql);
  for (const bad of RECOGNIZABLE) expect(bare.includes(bad), `hostile text ${JSON.stringify(bad)} outside a quoted literal`).toBe(false);
}

const memoryDb = () => new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });

describe('A1.6 planMigration', () => {
  it(`plans or refuses between ${SEEDS} random pairs, and the first build always plans`, () => {
    const seen = { sql: 0, none: 0, refused: 0 };
    forSeeds(SEEDS, (seed) => {
      const p = pair(seed);
      if (p === null) return;
      const result = planMigration(p.a, p.b);
      if (result.ok) {
        if (result.file === null) seen.none += 1;
        else {
          seen.sql += 1;
          expect(result.file.name).toBe('002_app.sql');
          expect(typeof result.file.sql).toBe('string');
        }
      } else {
        seen.refused += 1;
        expect(result.issues.length).toBeGreaterThan(0);
        for (const issue of result.issues) {
          expect(typeof issue.path).toBe('string');
          expect(typeof issue.code).toBe('string');
          expect(typeof issue.message).toBe('string');
          expect(issue.message.trim().length).toBeGreaterThan(0);
        }
      }
      const first = planMigration(null, p.a);
      expect(first.ok).toBe(true);
      expect(first.file?.name).toBe('001_app.sql');
      // The plan is a pure function of its inputs.
      expect(planMigration(p.a, p.b)).toEqual(result);
    });
    expect(seen.sql).toBeGreaterThan(10);
    expect(seen.refused).toBeGreaterThan(10);
  });

  it('answers a spec that is not a spec with a reason, never a throw', () => {
    for (const bad of [null, undefined, 0, 'x', [], {}, { tables: 'x' }, { specVersion: 1, app: {}, tables: [{}], pages: [] }]) {
      const result = planMigration(null, bad);
      expect(result.ok).toBe(false);
      for (const issue of result.issues) expect(issue.message.length).toBeGreaterThan(0);
    }
    const a = accepted(genSpec(mulberry32(3), { sources: false }));
    expect(planMigration({ tables: 'x' }, a).ok).toBe(false);
  });
});

describe('A1.7 the SQL of a plan', () => {
  it('uses only identifiers of the two specs, and the plan applies to a database built from the first', () => {
    let applied = 0;
    forSeeds(SEEDS, (seed) => {
      const p = pair(seed);
      if (p === null) return;
      const result = planMigration(p.a, p.b);
      if (!result.ok || result.file === null) return;
      expectOnlyAllowedSql(result.file.sql, p.a, p.b);
      const db = memoryDb();
      try {
        db.exec(compileSpec(p.a).createSql);
        db.exec(result.file.sql);
        applied += 1;
      } finally {
        db.close();
      }
    });
    expect(applied).toBeGreaterThan(10);
  });
});

describe('A1.8 compileSpec', () => {
  it('never throws on an accepted spec and its create script runs on a fresh database', () => {
    let compiled = 0;
    forSeeds(SEEDS, (seed) => {
      const rand = mulberry32(seed);
      const spec = accepted(genSpec(rand, { sources: false }));
      if (spec === null) return;
      const out = compileSpec(spec);
      compiled += 1;
      expectOnlyAllowedSql(out.createSql, spec);
      expect(out.importOrder.sort()).toEqual(spec.tables.map((t) => t.id).sort());
      const db = memoryDb();
      try {
        db.exec(out.createSql);
      } finally {
        db.close();
      }
    });
    expect(compiled).toBeGreaterThan(SEEDS * 0.9);
  });
});

describe('regression: a NUL character never reaches an SQL literal', () => {
  // Found by the A1.8 property: a select option "\u0000" passed LABEL_RE, and SQLite cut the CHECK clause at the NUL
  // ("unrecognized token"), so the first build or the preview migration of that app failed.
  const fixture = () => JSON.parse(fs.readFileSync(new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));
  const withField = (field) => {
    const spec = fixture();
    spec.tables[0].fields.push(field);
    return spec;
  };
  const NUL = String.fromCharCode(0);
  const cases = {
    'a select option': { id: 'tag', label: 'Tag', type: 'select', options: ['a', `b${NUL}c`] },
    'a text default': { id: 'tag', label: 'Tag', type: 'text', default: `a${NUL}b` },
    'a longtext default': { id: 'tag', label: 'Tag', type: 'longtext', default: `${NUL}` },
  };

  it.each(Object.entries(cases))('the schema refuses %s', (_name, field) => {
    const spec = withField(field);
    expect(accepted(spec)).toBeNull();
  });

  it.each(Object.entries(cases))('the compiler and the planner refuse %s (a spec stored before the schema rule)', (_name, field) => {
    const spec = withField(field);
    expect(() => compileSpec(spec)).toThrow(/NUL/);
    const first = planMigration(null, spec);
    expect(first.ok).toBe(false);
    expect(first.issues[0].message).toMatch(/NUL/);
    const next = planMigration(fixture(), spec);
    expect(next.ok).toBe(false);
  });

  it('still accepts plain unicode text in options and defaults, and the script runs', () => {
    const spec = withField({ id: 'tag', label: 'Tag', type: 'select', options: ['é漢🙂', "it's", 'say "hi"'], default: "it's" });
    const ok = accepted(spec);
    expect(ok).not.toBeNull();
    const db = memoryDb();
    try {
      db.exec(compileSpec(spec).createSql);
    } finally {
      db.close();
    }
  });
});
