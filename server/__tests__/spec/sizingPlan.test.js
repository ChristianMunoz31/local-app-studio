// The optional layer `sizing` block must not touch the compiler or the migration planner (DESIGN-phase9.md 3): the
// Crew Roster with and without `sizing` on t1 compiles to the same value and plans no migration steps.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { compileSpec, normalizeSpec, planMigration } from '../../spec/compile.js';

const FIXTURE = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const plain = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
function withSizing(sizing) {
  const spec = plain();
  spec.pages[0].layout.children[1].sizing = sizing;
  return spec;
}
const BLOCKS = [{}, { width: 'half' }, { width: 'fit', grow: true }, { width: 'full', grow: false }];

describe('the sizing block and the compiler', () => {
  it('the fixture has no sizing, and normalizing adds none', () => {
    expect(JSON.stringify(plain())).not.toContain('"sizing"');
    expect(JSON.stringify(normalizeSpec(plain()))).not.toContain('"sizing"');
  });

  it.each(BLOCKS)('compileSpec gives the same output with sizing %j', (sizing) => {
    expect(JSON.stringify(compileSpec(withSizing(sizing)))).toBe(JSON.stringify(compileSpec(plain())));
  });

  it.each(BLOCKS)('planMigration plans no steps when only sizing %j changes', (sizing) => {
    expect(planMigration(withSizing(sizing), plain())).toEqual({ ok: true, file: null });
    expect(planMigration(plain(), withSizing(sizing))).toEqual({ ok: true, file: null });
  });

  it('a first build plans the same file with and without sizing', () => {
    expect(planMigration(null, withSizing({ width: 'half' }))).toEqual(planMigration(null, plain()));
  });
});
