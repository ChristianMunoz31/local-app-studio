/// <reference types="vite/client" />
// The menu slots (docs/APP_SPEC.md, "Menu slots"): `menu.start` and `menu.end` hold small parts. The schema accepts the
// allowed parts, validateAppSpec refuses the others on its own (no catalog hook needed), the limits hold, and a spec without
// slots parses to exactly what it did before slots existed. Synthetic data.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import crew from '../fixtures/crew-roster.json';
import { normalizeSpec } from '../../runtime/normalizeSpec.js';
import { CATALOG_CHECKS } from '../../../../../src/catalog/validateLayout.ts';
import { MENU_LIMITS, MENU_PARTS, MENU_ROW_PARTS, MENU_SLOTS, hasSlotLayers, menuTypeProblem, slotLayers } from '../menuSlots.ts';
import { MENU_POSITIONS, MENU_STYLES, validateAppSpec } from '../schema.ts';
import type { LayoutLayer } from '../schema.ts';

const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });
const go = { action: { action: 'navigate', pageId: 'home', withRecord: false } };
const button = (id: string) => layer(id, 'Button', go, 'Go');
const withMenu = (menu: unknown): Record<string, unknown> => ({ ...(crew as Record<string, unknown>), menu });
const issues = (menu: unknown, opts = {}) => {
  const r = validateAppSpec(withMenu(menu), opts);
  return r.ok ? [] : r.issues.map((i) => [i.path, i.code]);
};

describe('the allow list module', () => {
  it('names the two slots, the parts and the limits', () => {
    expect([...MENU_SLOTS]).toEqual(['start', 'end']);
    expect([...MENU_PARTS]).toEqual(['Button', 'Link', 'SearchBox', 'QuickAdd', 'Text', 'Row']);
    expect([...MENU_ROW_PARTS]).toEqual(['Button', 'Link', 'SearchBox', 'QuickAdd', 'Text']);
    expect(MENU_LIMITS).toEqual({ perSlot: 6, layers: 24 });
    expect(Object.isFrozen(MENU_LIMITS)).toBe(true);
  });

  it('menuTypeProblem words the refusal for the top level and for a row', () => {
    expect(menuTypeProblem('Button', false)).toBeNull();
    expect(menuTypeProblem('Row', false)).toBeNull();
    expect(menuTypeProblem('Row', true)).toBe('A row in the menu bar can only hold: Button, Link, SearchBox, QuickAdd and Text.');
    expect(menuTypeProblem('DataTable', false)).toBe('The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.');
    expect(menuTypeProblem('Divider', true)).not.toBeNull();
  });

  it('slotLayers and hasSlotLayers read a block without trusting it', () => {
    expect(slotLayers(undefined, 'start')).toEqual([]);
    expect(slotLayers(null, 'start')).toEqual([]);
    expect(slotLayers([], 'start')).toEqual([]);
    expect(slotLayers({ start: 'x' }, 'start')).toEqual([]);
    expect(slotLayers({ start: { a: 1 } }, 'start')).toEqual([]);
    expect(slotLayers(Object.create({ start: [button('a')] }), 'start')).toEqual([]);
    expect(slotLayers({ end: [button('a')] }, 'end')).toHaveLength(1);
    expect(hasSlotLayers({ start: [], end: [] })).toBe(false);
    expect(hasSlotLayers({})).toBe(false);
    expect(hasSlotLayers({ end: [button('a')] })).toBe(true);
  });
});

describe('the schema accepts', () => {
  it.each([
    ['a Button', layer('b', 'Button', go, 'New')],
    ['a Link', layer('l', 'Link', go, 'Docs')],
    ['a QuickAdd', layer('q', 'QuickAdd', { table: 'crews', field: 'name' })],
    ['a Text', layer('t', 'Text', {}, 'Hello')],
    ['a SearchBox with a placeholder', layer('s', 'SearchBox', { placeholder: 'Find a crew' })],
    ['a SearchBox with no props', layer('s', 'SearchBox')],
    ['a Row with a Button', layer('r', 'Row', {}, [button('b')])],
  ])('%s in either slot, with the catalog checks', (_name, part) => {
    for (const slot of MENU_SLOTS) {
      const r = validateAppSpec(withMenu({ position: 'top', [slot]: [part] }), { ...CATALOG_CHECKS });
      expect(r.ok, JSON.stringify(r.issues)).toBe(true);
    }
  });

  it('empty arrays, both slots, a side menu and sizing on a slot layer', () => {
    expect(issues({ start: [], end: [] })).toEqual([]);
    expect(issues({ position: 'side', start: [button('a')], end: [button('b'), layer('t', 'Text', {}, 'x')] }, { ...CATALOG_CHECKS })).toEqual([]);
    expect(issues({ start: [{ ...button('a'), sizing: { width: 'half' } }] })).toEqual([]);
  });

  it('keeps the slots in the stored spec', () => {
    const r = validateAppSpec(withMenu({ end: [button('a')] }));
    expect(r.ok && r.value.menu).toEqual({ position: 'top', style: 'icons-and-labels', end: [button('a')] });
  });
});

describe('validateAppSpec refuses, on its own (no catalog hook)', () => {
  it.each(['DataTable', 'RecordForm', 'Divider', 'Heading', 'Card', 'Section', 'Chart', 'Page', 'NavLinks'])('%s at the top of a slot', (type) => {
    const r = validateAppSpec(withMenu({ end: [layer('x', type)] }));
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([
      { path: 'menu.end.0.type', code: 'menu_part_not_allowed', message: 'The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.' },
    ]);
  });

  it('a Feature marker does not make a refused part allowed', () => {
    expect(issues({ start: [{ ...layer('x', 'DataTable'), feature: { id: 'f1', version: 1, params: {} } }] })).toEqual([['menu.start.0.type', 'menu_part_not_allowed']]);
  });

  it('a Row inside a Row, and a part that is not for a row', () => {
    const r = validateAppSpec(withMenu({ start: [layer('r', 'Row', {}, [button('a'), layer('r2', 'Row', {}, [button('b')]), layer('d', 'DataTable')])] }));
    expect(r.issues).toEqual([
      { path: 'menu.start.0.children.1.type', code: 'menu_part_not_allowed', message: 'A row in the menu bar can only hold: Button, Link, SearchBox, QuickAdd and Text.' },
      { path: 'menu.start.0.children.2.type', code: 'menu_part_not_allowed', message: 'A row in the menu bar can only hold: Button, Link, SearchBox, QuickAdd and Text.' },
    ]);
  });

  it('parts held by a part that is not a Row', () => {
    expect(issues({ end: [layer('b', 'Button', go, [button('c')])] })).toEqual([['menu.end.0.children.0.type', 'menu_part_not_allowed']]);
  });

  it('seven parts in a slot', () => {
    const seven = Array.from({ length: 7 }, (_, i) => button(`b${i}`));
    expect(issues({ start: seven })).toEqual([['menu.start', 'too_big']]);
    expect(issues({ start: seven.slice(0, 6) })).toEqual([]);
  });

  it('more than 24 parts in all', () => {
    const rowOf = (n: number, tag: string) => layer(`row${tag}`, 'Row', {}, Array.from({ length: n }, (_, i) => button(`${tag}${i}`)));
    // 3 rows of 6 plus 3 rows = 21 layers...
    const ok = { start: [rowOf(5, 'a'), rowOf(5, 'b'), rowOf(5, 'c')], end: [rowOf(5, 'd')] };
    expect(issues(ok)).toEqual([]); // 4 rows + 20 buttons = 24
    const over = { start: [rowOf(5, 'a'), rowOf(5, 'b'), rowOf(5, 'c')], end: [rowOf(5, 'd'), button('z')] };
    const r = validateAppSpec(withMenu(over));
    expect(r.issues).toEqual([{ path: 'menu', code: 'menu_too_large', message: 'The menu bar may hold at most 24 parts.' }]);
  });

  it('a layer id used twice across both slots', () => {
    const r = validateAppSpec(withMenu({ start: [button('same')], end: [button('same')] }));
    expect(r.issues).toEqual([{ path: 'menu.end.0.id', code: 'duplicate_id', message: 'Layer id "same" is used twice in the menu bar.' }]);
  });

  it('the same id as a page layer is fine: the menu has its own namespace', () => {
    expect(issues({ start: [button('root')] })).toEqual([]);
  });

  it.each([['className'], ['style'], ['onClick'], ['onSubmit'], ['dangerouslySetInnerHTML']])('prop %s', (prop) => {
    const r = validateAppSpec(withMenu({ end: [layer('b', 'Button', { ...go, [prop]: 'x' }, 'Go')] }));
    expect(r.issues.map((i) => [i.path, i.code])).toEqual([[`menu.end.0.props.${prop}`, 'forbidden_prop']]);
  });

  it('a variable reference in a prop', () => {
    expect(issues({ end: [layer('b', 'Button', { variant: { __variableRef: 'x' } }, 'Go')] })).toEqual([['menu.end.0.props.variant', 'forbidden_prop']]);
  });

  it.each([
    ['__proto__ key', JSON.parse('{"position":"top","__proto__":{"start":[]}}')],
    ['a slot that is an object', { start: { id: 'a' } }],
    ['a slot that is null', { start: null }],
    ['a slot that is a string', { end: 'Button' }],
    ['an unknown slot', { middle: [] }],
    ['a layer with no id', { start: [{ type: 'Button', props: {}, children: 'Go' }] }],
  ])('%s', (_name, menu) => {
    expect(validateAppSpec(withMenu(menu)).ok).toBe(false);
  });

  it('enforcement does not depend on the catalog hook, and the hook adds props checks on top', () => {
    const bad = { end: [layer('b', 'Button', { action: { action: 'navigate', pageId: 'nowhere', withRecord: false } }, 'Go')] };
    expect(validateAppSpec(withMenu(bad)).ok).toBe(true);
    expect(validateAppSpec(withMenu(bad), { ...CATALOG_CHECKS }).ok).toBe(false);
  });
});

describe('a spec without slots is what it was before', () => {
  // The phase 9 MenuSchema, verbatim.
  const LegacyMenu = z.strictObject({ position: z.enum(MENU_POSITIONS).default('top'), style: z.enum(MENU_STYLES).default('icons-and-labels') });
  const FIXTURES = Object.values(import.meta.glob('./fixtures/menu/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>).map(
    (text) => JSON.parse(text) as { name: string; menu: unknown; absent: boolean },
  );
  const inputs: Array<[string, Record<string, unknown>]> = [
    ['crew-roster', crew as Record<string, unknown>],
    ...FIXTURES.map((f): [string, Record<string, unknown>] => [f.name, f.absent ? { ...(crew as Record<string, unknown>) } : withMenu(f.menu)]),
    ['empty slots', withMenu({ position: 'side', start: [], end: [] })],
  ];

  it.each(inputs.filter(([name]) => name !== 'empty slots'))('%s: the stored menu has no slot keys and equals the phase 9 parse', (_name, input) => {
    const r = validateAppSpec(input);
    if (!r.ok) return;
    const stored = r.value.menu;
    if (input.menu === undefined) {
      expect('menu' in r.value).toBe(false);
      return;
    }
    expect(JSON.stringify(stored)).not.toMatch(/"(start|end)"/);
    expect(JSON.stringify(stored)).toBe(JSON.stringify(LegacyMenu.parse(input.menu)));
  });

  it('empty slot arrays are kept as given and count as no slots', () => {
    const r = validateAppSpec(withMenu({ position: 'side', start: [], end: [] }));
    expect(r.ok && r.value.menu).toEqual({ position: 'side', style: 'icons-and-labels', start: [], end: [] });
    expect(hasSlotLayers(r.ok ? r.value.menu : null)).toBe(false);
  });

  it('a menu with no slots parses to exactly the two keys, in order', () => {
    const r = validateAppSpec(withMenu({}));
    expect(r.ok && JSON.stringify(r.value.menu)).toBe('{"position":"top","style":"icons-and-labels"}');
    const side = validateAppSpec(withMenu({ position: 'side', style: 'labels' }));
    expect(side.ok && JSON.stringify(side.value.menu)).toBe('{"position":"side","style":"labels"}');
  });

  it('the normalizer lists the same slots as the schema module', () => {
    const normalized = normalizeSpec(withMenu({ start: [{ id: 'a', type: 'Button', props: {}, children: 'x', sizing: {} }], end: [{ id: 'b', type: 'Text', props: {}, children: 'y', sizing: {} }] }));
    for (const slot of MENU_SLOTS) expect((normalized as { menu: Record<string, Array<{ sizing: unknown }>> }).menu[slot][0].sizing).toEqual({ width: 'full', grow: false });
  });
});
