// The optional `menu` block must not touch the compiler or the migration planner (DESIGN-phase8.md 4.3, decision 5):
// the Crew Roster with and without `menu` compiles to the same value and plans no migration steps.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { compileSpec, normalizeSpec, planMigration } from '../../spec/compile.js';

const FIXTURE = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const plain = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const withMenu = (menu) => ({ ...plain(), menu });
const MENUS = [{}, { position: 'side' }, { position: 'top', style: 'labels' }, { position: 'side', style: 'icons-and-labels' }];

describe('the menu block and the compiler', () => {
  it('the fixture has no menu, and normalizing adds none', () => {
    expect('menu' in plain()).toBe(false);
    expect('menu' in normalizeSpec(plain())).toBe(false);
  });

  it.each(MENUS)('compileSpec gives the same output with menu %j', (menu) => {
    expect(JSON.stringify(compileSpec(withMenu(menu)))).toBe(JSON.stringify(compileSpec(plain())));
    expect(compileSpec(withMenu(menu))).toEqual(compileSpec(plain()));
  });

  it.each(MENUS)('planMigration plans no steps when only menu %j changes', (menu) => {
    expect(planMigration(plain(), withMenu(menu))).toEqual({ ok: true, file: null });
    expect(planMigration(withMenu(menu), plain())).toEqual({ ok: true, file: null });
  });

  it('a first build plans the same file with and without menu', () => {
    expect(planMigration(null, withMenu({ position: 'side' }))).toEqual(planMigration(null, plain()));
  });

  it('a present block is filled with its own defaults, the other keys stay as they are', () => {
    const out = normalizeSpec(withMenu({ position: 'side' }));
    expect(out.menu).toEqual({ position: 'side', style: 'icons-and-labels' });
    const rest = { ...out };
    delete rest.menu;
    expect(rest).toEqual(normalizeSpec(plain()));
  });
});
