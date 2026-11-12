// normalizeSpec and the menu slots (docs/APP_SPEC.md, "Menu slots"): a spec without slots normalizes exactly like the phase 9
// normalizer, a present slot gets `sizing` filled like a page layer, and the local slot list equals MENU_SLOTS.
import { describe, expect, it } from 'vitest';
import crewRoster from '../../spec/fixtures/crew-roster.json';
import { MENU_SLOTS } from '../../spec/menuSlots.ts';
import { SPEC_DEFAULTS, normalizeSpec } from '../normalizeSpec.js';

const MENU_FIXTURES = Object.values(import.meta.glob('../../spec/__tests__/fixtures/menu/*.json', { query: '?raw', import: 'default', eager: true })).map((t) => JSON.parse(t));

// ---- The phase 9 normalizeSpec, reduced to the menu branch (the rest is pinned by normalizeSizing.test.js). ----
function legacyMenu(menu) {
  const copy = JSON.parse(JSON.stringify(menu));
  if (copy !== null && typeof copy === 'object' && !Array.isArray(copy)) {
    if (copy.position === undefined) copy.position = 'top';
    if (copy.style === undefined) copy.style = 'icons-and-labels';
  }
  return copy;
}
// ---- end of the copy ----

const layer = (id, type, extra = {}) => ({ id, type, props: {}, children: [], ...extra });
const withMenu = (menu) => ({ ...crewRoster, menu });

describe('normalizeSpec with menu slots', () => {
  it('lists the same slots as src/spec/menuSlots.ts', () => {
    expect([...SPEC_DEFAULTS.menuSlots]).toEqual([...MENU_SLOTS]);
    expect(Object.isFrozen(SPEC_DEFAULTS.menuSlots)).toBe(true);
  });

  it('a menu without slots normalizes as before, key order included', () => {
    for (const f of MENU_FIXTURES) {
      if (f.absent || f.name === 'proto-key') continue;
      const out = normalizeSpec(withMenu(f.menu));
      expect(JSON.stringify(out.menu)).toBe(JSON.stringify(legacyMenu(f.menu)));
    }
    expect('menu' in normalizeSpec(crewRoster)).toBe(false);
  });

  it('adds nothing for absent or empty slots', () => {
    expect(normalizeSpec(withMenu({})).menu).toEqual({ position: 'top', style: 'icons-and-labels' });
    expect(normalizeSpec(withMenu({ start: [], end: [] })).menu).toEqual({ position: 'top', style: 'icons-and-labels', start: [], end: [] });
  });

  it('fills a present sizing block of a slot layer and of a Row child, nothing else', () => {
    const out = normalizeSpec(
      withMenu({
        start: [layer('a', 'Button', { sizing: { width: 'half' } }), layer('r', 'Row', { children: [layer('b', 'Text', { sizing: {} }), layer('c', 'Text')] })],
        end: [layer('d', 'Button')],
      }),
    );
    expect(out.menu.start[0].sizing).toEqual({ width: 'half', grow: false });
    expect(out.menu.start[1].children[0].sizing).toEqual({ width: 'full', grow: false });
    expect('sizing' in out.menu.start[1].children[1]).toBe(false);
    expect('sizing' in out.menu.end[0]).toBe(false);
  });

  it('never mutates its input, is idempotent, and leaves a slot that is not an array alone', () => {
    const input = withMenu({ start: [layer('a', 'Button', { sizing: {} })], end: 'junk' });
    const copy = JSON.stringify(input);
    const once = normalizeSpec(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(normalizeSpec(once)).toEqual(once);
    expect(once.menu.end).toBe('junk');
  });
});
