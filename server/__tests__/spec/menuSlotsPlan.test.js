// The menu slots must not touch the compiler or the migration planner (docs/APP_SPEC.md, "Menu slots"): the Crew Roster with
// and without slots compiles to the same value and plans no migration steps. Synthetic data.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { compileSpec, normalizeSpec, planMigration } from '../../spec/compile.js';

const FIXTURE = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const plain = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const layer = (id, type, props = {}, children = []) => ({ id, type, props, children });
const SLOTS = {
  position: 'top',
  start: [layer('s', 'SearchBox', { placeholder: 'Find' })],
  end: [layer('b', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' } }, 'New record')],
};
const withSlots = (menu = SLOTS) => ({ ...plain(), menu });

describe('menu slots and the compiler', () => {
  it('compileSpec gives the same output with and without slots', () => {
    expect(JSON.stringify(compileSpec(withSlots()))).toBe(JSON.stringify(compileSpec(plain())));
    expect(compileSpec(withSlots({ position: 'side', start: [], end: [] }))).toEqual(compileSpec(plain()));
  });

  it('planMigration plans no steps when only the slots change', () => {
    expect(planMigration(plain(), withSlots())).toEqual({ ok: true, file: null });
    expect(planMigration(withSlots(), plain())).toEqual({ ok: true, file: null });
    expect(planMigration(withSlots(), withSlots({ position: 'top', end: [] }))).toEqual({ ok: true, file: null });
  });

  it('a first build plans the same file with and without slots', () => {
    expect(planMigration(null, withSlots())).toEqual(planMigration(null, plain()));
  });

  it('normalizing keeps the slots and fills only their sizing blocks', () => {
    const out = normalizeSpec(withSlots());
    expect(out.menu.start).toEqual(SLOTS.start);
    expect(out.menu.end).toEqual(SLOTS.end);
    expect(out.menu.style).toBe('icons-and-labels');
    const rest = { ...out };
    delete rest.menu;
    expect(rest).toEqual(normalizeSpec(plain()));
  });
});
