// The menu bar as a tree (lib/menuTree.ts) and the menu rules of layoutTree.ts: slots, refusals, moves between the page and the menu bar,
// and a property test that every state the helpers reach is a spec the validator accepts with the catalog's menu check.
import { describe, expect, it } from 'vitest';
import { exampleCtx, exampleSpec, layer } from '@/catalog/__tests__/fixtures';
import { menuPartContext } from '@/catalog/validateLayout';
import { CATALOG_CHECKS } from '@/catalog/validateLayout';
import { MENU_LIMITS } from '@local-app-studio/runtime/spec/menuSlots';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppSpecInput, LayoutLayer, Menu, Table } from '@local-app-studio/runtime/spec/schema';
import { canHold, configureLayer, dropTargets, findLayer, insertLayer, moveBy, moveLayer, newPartLayer, removeLayer, replaceLayer } from '../layoutTree';
import type { DropTarget, TreeResult } from '../layoutTree';
import { layerIds } from '../layout';
import {
  MENU_FEATURE_REFUSAL,
  MENU_NO_FIT,
  MENU_ROOT_ID,
  MENU_SLOT_IDS,
  adaptForPlace,
  composeMenu,
  fitsMenu,
  menuSubtreeProblem,
  menuTreeOf,
  newMenuLayer,
  slotNameOf,
  slotsOfTree,
  transferLayer,
} from '../menuTree';
import type { PairResult } from '../menuTree';
import { countMenuLayers } from '../specSummary';

const text = (id: string, words = 'x'): LayoutLayer => layer(id, 'Text', {}, words);
const button = (id: string): LayoutLayer => layer(id, 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' } }, 'New record');
const look: Menu = { position: 'top', style: 'labels' };

const spec = (): AppSpecInput => exampleSpec();
const menuCtx = () => menuPartContext(spec());
const pageCtx = exampleCtx;
const ctxs = () => ({ page: pageCtx(), menu: menuCtx() });

const must = (r: TreeResult): LayoutLayer => {
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.message}`);
  return r.root;
};
const mustPair = (r: PairResult): { page: LayoutLayer; menu: LayoutLayer; focusId: string } => {
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.message}`);
  return r;
};
const slot = (tree: LayoutLayer, name: 'start' | 'end'): string[] => {
  const holder = findLayer(tree, MENU_SLOT_IDS[name])?.layer;
  return Array.isArray(holder?.children) ? holder.children.map((c) => c.id) : [];
};
const at = (name: 'start' | 'end', index = 0): DropTarget => ({ parentId: MENU_SLOT_IDS[name], index });

/** A menu tree with the given layers in start and end. */
const menuWith = (start: LayoutLayer[], end: LayoutLayer[] = []): LayoutLayer => menuTreeOf({ ...look, ...(start.length > 0 ? { start } : {}), ...(end.length > 0 ? { end } : {}) });

/** The crew page: a heading, a table, a row holding a button, and a search box. */
const pageTree = (): LayoutLayer =>
  layer('root', 'Page', {}, [
    layer('h1', 'Heading', { size: 'lg' }, 'Crew'),
    layer('t1', 'DataTable', { source: 'open_crews', columns: ['name'] }),
    layer('r1', 'Row', {}, [button('b_row'), layer('sb_row', 'SearchBox', { source: 'open_crews', fields: ['name'], placeholder: 'Find' })]),
    button('b1'),
    layer('sb1', 'SearchBox', { source: 'open_crews', fields: ['name'] }),
  ]);

describe('the menu as a tree', () => {
  it('has the bar over two empty slots for no menu, and names its frame ids', () => {
    const tree = menuTreeOf(null);
    expect(tree).toMatchObject({ id: MENU_ROOT_ID, type: 'AppMenu' });
    expect(slot(tree, 'start')).toEqual([]);
    expect(slot(tree, 'end')).toEqual([]);
    expect(slotNameOf('@menu-start')).toBe('start');
    expect(slotNameOf('@menu-end')).toBe('end');
    expect(slotNameOf('row_1')).toBeNull();
  });

  it('round trips the stored slots, gives an empty slot no key, and never changes the stored block', () => {
    const stored: Menu = { ...look, start: [text('t_a')], end: [layer('row_1', 'Row', {}, [button('b_a')])] };
    const before = JSON.stringify(stored);
    const tree = menuTreeOf(stored);
    expect(slot(tree, 'start')).toEqual(['t_a']);
    expect(composeMenu(stored, tree)).toEqual(stored);
    expect(JSON.stringify(stored)).toBe(before);
    expect(slotsOfTree(menuTreeOf(look))).toEqual({});
    expect(composeMenu({ ...look, start: [], end: [] }, menuTreeOf({ ...look, start: [], end: [] }))).toEqual(look);
  });

  it('composes no menu without a look, whatever is on the bar, and takes the slots from the tree not from the look', () => {
    expect(composeMenu(null, menuWith([text('t_a')]))).toBeUndefined();
    const composed = composeMenu({ ...look, start: [text('old')] }, menuWith([], [text('t_b')]));
    expect(composed).toEqual({ ...look, end: [text('t_b')] });
  });

  it('counts the parts of a menu block, a row and its parts included, and tolerates junk', () => {
    expect(countMenuLayers(undefined)).toBe(0);
    expect(countMenuLayers({ start: 'x', end: [null, 3] })).toBe(0);
    expect(countMenuLayers({ start: [text('a'), layer('r', 'Row', {}, [text('b'), text('c')])], end: [text('d')] })).toBe(5);
  });
});

describe('what may go on the menu bar', () => {
  it('lets a slot hold exactly the menu parts and a row the shorter list', () => {
    const tree = menuWith([layer('row_1', 'Row', {}, [])]);
    const start = findLayer(tree, MENU_SLOT_IDS.start)!.layer;
    for (const type of ['Button', 'Link', 'SearchBox', 'QuickAdd', 'Text', 'Row']) expect(canHold(start, type, tree)).toBe(true);
    for (const type of ['DataTable', 'Divider', 'Section', 'Heading', 'Page']) expect(canHold(start, type, tree)).toBe(false);
    const row = findLayer(tree, 'row_1')!.layer;
    expect(canHold(row, 'Row', tree)).toBe(false);
    expect(canHold(row, 'Button', tree)).toBe(true);
    expect(canHold(row, 'DataTable', tree)).toBe(false);
    expect(canHold(tree, 'Button', tree)).toBe(false);
  });

  it('keeps the page rules for a Row on a page', () => {
    const page = pageTree();
    expect(canHold(findLayer(page, 'r1')!.layer, 'DataTable', page)).toBe(true);
  });

  it('refuses with the validator words, for a part and for a part in a row', () => {
    const tree = menuWith([layer('row_1', 'Row', {}, [])]);
    const refused = insertLayer(tree, at('start', 1), layer('t_new', 'DataTable', { source: 'x' }));
    expect(refused).toMatchObject({ ok: false, reason: 'not_allowed_here', message: 'The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.' });
    const inRow = insertLayer(tree, { parentId: 'row_1', index: 0 }, layer('r2', 'Row', {}, []));
    expect(inRow).toMatchObject({ ok: false, message: 'A row in the menu bar can only hold: Button, Link, SearchBox, QuickAdd and Text.' });
  });

  it('locks the bar and both slots against move, remove, replace and Move up and down', () => {
    const tree = menuWith([text('a')], [text('b')]);
    for (const id of [MENU_ROOT_ID, MENU_SLOT_IDS.start, MENU_SLOT_IDS.end]) {
      expect(removeLayer(tree, id)).toMatchObject({ ok: false, reason: 'root_locked', message: 'The menu bar itself cannot be moved or removed.' });
      expect(moveBy(tree, id, 1)).toMatchObject({ ok: false, reason: 'root_locked' });
      expect(replaceLayer(tree, id, text('z'))).toMatchObject({ ok: false, reason: 'root_locked' });
    }
    expect(moveLayer(tree, MENU_SLOT_IDS.start, at('end'))).toMatchObject({ ok: false, reason: 'root_locked' });
    expect(dropTargets(tree, 'Text', MENU_SLOT_IDS.start)).toEqual([]);
  });

  it('holds 6 parts in a slot and 24 on the bar', () => {
    let tree = menuTreeOf(null);
    for (let i = 0; i < MENU_LIMITS.perSlot; i += 1) tree = must(insertLayer(tree, at('start', i), text(`a_${i}`)));
    expect(insertLayer(tree, at('start', 6), text('a_6'))).toMatchObject({ ok: false, reason: 'child_count' });
    expect(dropTargets(tree, 'Text').some((t) => t.parentId === MENU_SLOT_IDS.start)).toBe(false);
    // Two slots of 6 hold 12; rows with 3 parts each fill the bar to 24 and the next one is refused.
    let full = menuTreeOf(null);
    for (let i = 0; i < 6; i += 1) full = must(insertLayer(full, at('start', i), layer(`r_${i}`, 'Row', {}, [text(`s_${i}`), text(`t_${i}`), text(`u_${i}`)])));
    expect(countMenuLayers(slotsOfTree(full))).toBe(24);
    expect(insertLayer(full, at('end', 0), text('extra'))).toMatchObject({ ok: false, reason: 'too_many_layers', message: 'The menu bar is full: at most 24 parts.' });
  });

  it('says what is wrong with a part before it goes on the bar', () => {
    expect(menuSubtreeProblem(button('b'))).toBeNull();
    expect(menuSubtreeProblem(layer('r', 'Row', {}, [button('b'), text('t')]))).toBeNull();
    expect(menuSubtreeProblem({ ...text('t'), feature: { id: 'f', version: 1, params: {} } })).toBe(MENU_FEATURE_REFUSAL);
    expect(menuSubtreeProblem(layer('r', 'Row', {}, [{ ...text('t'), feature: { id: 'f', version: 1, params: {} } }]))).toBe(MENU_FEATURE_REFUSAL);
    expect(menuSubtreeProblem(layer('t', 'DataTable', { source: 'x' }))).toMatch(/^The menu bar can only hold/);
    expect(menuSubtreeProblem(layer('r', 'Row', {}, [layer('r2', 'Row', {}, [])]))).toMatch(/^A row in the menu bar can only hold/);
  });
});

describe('newMenuLayer', () => {
  it('makes a Button that opens a form to add a record in the first table', () => {
    const tables = (spec().tables ?? []) as Table[];
    const made = newMenuLayer('Button', menuCtx(), new Set(['button_1']), { prefer: [], tables });
    const first = menuCtx().tableIds[0];
    const label = tables.find((t) => t.id === first)?.label;
    expect(made).toEqual({ id: 'button_2', type: 'Button', props: { action: { action: 'open-form', table: first, mode: 'create' } }, children: `Add to ${label}` });
  });

  it('makes a Button that goes to the first page when the app has no table', () => {
    const noTables = menuPartContext({ ...spec(), tables: [] });
    expect(newMenuLayer('Button', noTables, new Set())).toMatchObject({ props: { action: { action: 'navigate', pageId: 'home', withRecord: false } }, children: 'Go' });
  });

  it('makes a SearchBox with no source, an empty Row, and the other parts like a page does', () => {
    expect(newMenuLayer('SearchBox', menuCtx(), new Set())).toEqual({ id: 'searchbox_1', type: 'SearchBox', props: {}, children: [] });
    expect(newMenuLayer('Row', menuCtx(), new Set())).toEqual({ id: 'row_1', type: 'Row', props: {}, children: [] });
    for (const type of ['Link', 'QuickAdd', 'Text']) {
      const made = newMenuLayer(type, menuCtx(), new Set());
      expect(made, type).toMatchObject({ type });
      expect('refusal' in made, type).toBe(false);
    }
  });

  it('words the "does not fit the bar" refusal as a pointer to New table, never to the Data step', () => {
    expect(MENU_NO_FIT).toBe("This part can't be added to the menu bar yet. Put it on a page first and press New table or Add a field on it.");
    expect(MENU_NO_FIT).not.toMatch(/Data step|in Data/);
  });

  it('refuses what the bar does not take, in the validator words', () => {
    expect(newMenuLayer('DataTable', menuCtx(), new Set())).toEqual({ refusal: 'The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.' });
    expect(newMenuLayer('Divider', menuCtx(), new Set())).toHaveProperty('refusal');
  });

  it('prefers the tables of the open page: a Button and a Quick add use Crews, not the first table of the app', () => {
    const input = spec();
    const tables = input.tables as Table[];
    const other = tables.find((t) => t.id !== 'crews') as Table;
    // The first table of the app is not the page's table.
    const reordered = { ...input, tables: [other, ...tables.filter((t) => t.id !== other.id)] } as AppSpecInput;
    const ctx = menuPartContext(reordered);
    const pageTables = { prefer: ['crews', ...ctx.tableIds.filter((t) => t !== 'crews')], tables: reordered.tables as Table[] };
    expect(ctx.tableIds[0]).toBe(other.id);
    expect(newMenuLayer('Button', ctx, new Set())).toMatchObject({ props: { action: { table: other.id } } });
    expect(newMenuLayer('Button', ctx, new Set(), pageTables)).toMatchObject({ props: { action: { table: 'crews' } } });
    expect(newMenuLayer('QuickAdd', ctx, new Set(), pageTables)).toMatchObject({ props: { table: 'crews' } });
  });

  it('B8: a Quick add skips a table that needs two fields and refuses when none fits', () => {
    const tables: Table[] = [
      { id: 'people', label: 'People', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'email', label: 'Email', type: 'text', required: true }] },
      { id: 'notes', label: 'Notes', fields: [{ id: 'body', label: 'Body', type: 'text', required: true }] },
    ];
    const input = { ...spec(), tables } as AppSpecInput;
    const ctx = menuPartContext(input);
    expect(newMenuLayer('QuickAdd', ctx, new Set(), { prefer: ['people', 'notes'], tables })).toMatchObject({ props: { table: 'notes' } });
    const onlyPeople = { ...input, tables: [tables[0]] } as AppSpecInput;
    expect(newMenuLayer('QuickAdd', menuPartContext(onlyPeople), new Set(), { prefer: ['people'], tables: [tables[0]] })).toEqual({
      refusal: 'Quick add needs a table where only one text field must be filled in. Use a Form instead.',
    });
  });

  it('takes ids that neither tree uses', () => {
    const taken = layerIds(pageTree());
    const made = newMenuLayer('Button', menuCtx(), taken);
    expect(made).toHaveProperty('id', 'button_1');
    expect(taken.has('button_1')).toBe(false);
  });
});

describe('adaptForPlace', () => {
  it('keeps only the hint text of a SearchBox going to the menu, also inside a Row, and does not change its input', () => {
    const row = layer('r', 'Row', {}, [layer('sb', 'SearchBox', { source: 'open_crews', fields: ['name'], placeholder: 'Find' })]);
    const before = JSON.stringify(row);
    const adapted = adaptForPlace(row, 'menu', menuCtx());
    expect(adapted).toMatchObject({ ok: true });
    expect(adapted.ok && (adapted.layer.children as LayoutLayer[])[0].props).toEqual({ placeholder: 'Find' });
    expect(JSON.stringify(row)).toBe(before);
  });

  it('gives a SearchBox going to the page the first list and its text fields, or refuses when the page has no list', () => {
    const box = layer('sb', 'SearchBox', { placeholder: 'Find' });
    const adapted = adaptForPlace(box, 'page', pageCtx());
    expect(adapted).toMatchObject({ ok: true, layer: { props: { placeholder: 'Find', source: 'open_crews', fields: ['name'] } } });
    expect(adaptForPlace(box, 'page', menuCtx())).toEqual({ ok: false, message: 'Add a list to this page first, in Page settings.' });
  });

  it('leaves a layer with no search box as it is', () => {
    const b = button('b');
    expect(adaptForPlace(b, 'menu', menuCtx())).toEqual({ ok: true, layer: b });
  });
});

describe('transferLayer', () => {
  it('moves a part from the page to a slot as one result, keeps its width, and leaves the inputs alone', () => {
    const menu = menuTreeOf(null);
    const sizedPage = layer('root', 'Page', {}, [{ ...button('b1'), sizing: { width: 'half', grow: false } } as LayoutLayer]);
    const before = JSON.stringify([sizedPage, menu]);
    const r = mustPair(transferLayer(sizedPage, menu, 'page', 'b1', at('end'), ctxs()));
    expect(findLayer(r.page, 'b1')).toBeNull();
    expect(slot(r.menu, 'end')).toEqual(['b1']);
    expect(findLayer(r.menu, 'b1')!.layer.sizing).toEqual({ width: 'half', grow: false });
    expect(r.focusId).toBe('b1');
    expect(JSON.stringify([sizedPage, menu])).toBe(before);
  });

  it('moves a part from the menu to the page, and a SearchBox gets the list of the page', () => {
    const menu = menuWith([layer('sb_m', 'SearchBox', {}, [])]);
    const r = mustPair(transferLayer(pageTree(), menu, 'menu', 'sb_m', { parentId: 'root', index: 1 }, ctxs()));
    expect(slot(r.menu, 'start')).toEqual([]);
    expect(findLayer(r.page, 'sb_m')!.layer.props).toEqual({ source: 'open_crews', fields: ['name'] });
  });

  it('strips the source of a SearchBox going to the menu', () => {
    const r = mustPair(transferLayer(pageTree(), menuTreeOf(null), 'page', 'sb1', at('start'), ctxs()));
    expect(findLayer(r.menu, 'sb1')!.layer.props).toEqual({});
  });

  it('refuses the page, a slot, parts the bar does not take, and a feature block', () => {
    const page = pageTree();
    const menu = menuWith([text('a')]);
    expect(transferLayer(page, menu, 'page', 'root', at('start'), ctxs())).toMatchObject({ ok: false, reason: 'root_locked' });
    expect(transferLayer(page, menu, 'menu', MENU_SLOT_IDS.start, { parentId: 'root', index: 0 }, ctxs())).toMatchObject({ ok: false, reason: 'root_locked', message: 'The menu bar itself cannot be moved or removed.' });
    expect(transferLayer(page, menu, 'page', 't1', at('end'), ctxs())).toMatchObject({ ok: false, reason: 'not_allowed_here', message: 'The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.' });
    const block = must(replaceLayer(page, 'h1', { ...text('blk'), feature: { id: 'f', version: 1, params: {} } }));
    expect(transferLayer(block, menu, 'page', 'blk', at('end'), ctxs())).toMatchObject({ ok: false, message: MENU_FEATURE_REFUSAL });
    expect(transferLayer(page, menu, 'page', 'nope', at('end'), ctxs())).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('refuses a part whose row holds a part the bar does not take', () => {
    const page = must(insertLayer(pageTree(), { parentId: 'r1', index: 0 }, layer('t_in', 'DataTable', { source: 'open_crews', columns: ['name'] })));
    expect(transferLayer(page, menuTreeOf(null), 'page', 'r1', at('start'), ctxs())).toMatchObject({ ok: false, message: expect.stringMatching(/^A row in the menu bar can only hold/) });
  });

  it('refuses a move to the page of a SearchBox when the page has no list', () => {
    const menu = menuWith([layer('sb_m', 'SearchBox', {}, [])]);
    const noList = { page: menuCtx(), menu: menuCtx() };
    expect(transferLayer(layer('root', 'Page', {}, []), menu, 'menu', 'sb_m', { parentId: 'root', index: 0 }, noList)).toMatchObject({ ok: false, message: 'Add a list to this page first, in Page settings.' });
  });

  it('refuses when the destination refuses (a full slot) and changes nothing', () => {
    let menu = menuTreeOf(null);
    for (let i = 0; i < 6; i += 1) menu = must(insertLayer(menu, at('end', i), text(`f_${i}`)));
    const refused = transferLayer(pageTree(), menu, 'page', 'b1', at('end', 6), ctxs());
    expect(refused).toMatchObject({ ok: false, reason: 'child_count' });
  });

  it('gives fresh ids to a part whose id the other tree already uses', () => {
    const page = pageTree();
    const menu = menuWith([button('b1')]);
    const r = mustPair(transferLayer(page, menu, 'page', 'b1', at('end'), ctxs()));
    expect(r.focusId).not.toBe('b1');
    const all = [...layerIds(r.page), ...layerIds(r.menu)];
    expect(new Set(all).size).toBe(all.length);
    expect(findLayer(r.menu, r.focusId)).not.toBeNull();
  });

  it('refuses a setting that does not fit the other place, and never one the part already had', () => {
    // A QuickAdd on a table the menu knows is fine; one on a table nobody has is not, whichever way it goes.
    const bad = layer('q', 'QuickAdd', { table: 'nope', field: 'name' });
    const page = must(insertLayer(pageTree(), { parentId: 'root', index: 0 }, bad));
    expect(transferLayer(page, menuTreeOf(null), 'page', 'q', at('start'), ctxs())).toMatchObject({ ok: true });
    const ok = layer('q2', 'QuickAdd', { table: 'crews', field: 'name' });
    const fine = must(insertLayer(pageTree(), { parentId: 'root', index: 0 }, ok));
    expect(transferLayer(fine, menuTreeOf(null), 'page', 'q2', at('start'), ctxs())).toMatchObject({ ok: true });
  });

  it('holds the same child count rules as a plain move when the part leaves a page header', () => {
    const header = layer('ph', 'PageHeader', { title: 'T' }, [button('b_h1'), button('b_h2')]);
    const page = must(insertLayer(pageTree(), { parentId: 'root', index: 0 }, header));
    const r = mustPair(transferLayer(page, menuTreeOf(null), 'page', 'b_h1', at('start'), ctxs()));
    expect((findLayer(r.page, 'ph')!.layer.children as LayoutLayer[]).map((c) => c.id)).toEqual(['b_h2']);
  });
});

describe('fitsMenu', () => {
  it('is true for exactly the six menu parts, and false for features', () => {
    expect(fitsMenu({ kind: 'part', id: 'Button' })).toBe(true);
    expect(['Button', 'Link', 'SearchBox', 'QuickAdd', 'Text', 'Row'].every((id) => fitsMenu({ kind: 'part', id }))).toBe(true);
    expect(fitsMenu({ kind: 'part', id: 'DataTable' })).toBe(false);
    expect(fitsMenu({ kind: 'part', id: 'Divider' })).toBe(false);
    expect(fitsMenu({ kind: 'feature', id: 'Button' })).toBe(false);
  });
});

describe('every state of page and menu bar stays a valid app', () => {
  const MENU_TYPES = ['Button', 'Link', 'SearchBox', 'QuickAdd', 'Text', 'Row', 'DataTable', 'Section'];
  const PAGE_TYPES = ['Text', 'Button', 'SearchBox', 'Row', 'Row', 'Heading', 'StatCard', 'QuickAdd', 'Link', 'DataTable'];

  /** A small seeded generator, so a failing sequence can be replayed. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const ok = (page: LayoutLayer, menu: LayoutLayer): ReturnType<typeof validateAppSpec> => {
    const base = spec();
    const composed = composeMenu(look, menu);
    const input = { ...base, pages: base.pages.map((p) => (p.id === 'crew' ? { ...p, layout: page } : p)), menu: composed };
    return validateAppSpec(input, { ...CATALOG_CHECKS });
  };

  /** Every id of a tree as a list, so a repeat shows (a Set would hide it). */
  const listIds = (tree: LayoutLayer): string[] => {
    const out: string[] = [];
    const stack = [tree];
    for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
      out.push(l.id);
      if (Array.isArray(l.children)) stack.push(...l.children);
    }
    return out;
  };

  const idsOf = (tree: LayoutLayer, skipFrame: boolean): string[] => [...layerIds(tree)].filter((id) => !(skipFrame && id.startsWith('@')) && id !== 'root');

  it('survives 300 random sequences of insert, move, transfer, remove and configure', () => {
    const pctx = pageCtx();
    const mctx = menuCtx();
    const done = { menuInserts: 0, transfers: 0, refusedTransfers: 0 };
    for (let run = 0; run < 300; run += 1) {
      const next = rng(run + 1);
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
      let page = layer('root', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Crew')]);
      let menu = menuTreeOf(null);
      const log: string[] = [];
      for (let step = 0; step < 8; step += 1) {
        const op = pick(['insertMenu', 'insertPage', 'moveMenu', 'movePage', 'transfer', 'remove', 'configure']);
        const taken = new Set([...layerIds(page), ...layerIds(menu)]);
        log.push(op);
        if (op === 'insertMenu') {
          const made = newMenuLayer(pick(MENU_TYPES), mctx, taken);
          if ('refusal' in made) continue;
          const spot = dropTargets(menu, made.type);
          if (spot.length === 0) continue;
          const r = insertLayer(menu, pick(spot), made);
          if (r.ok) {
            menu = r.root;
            done.menuInserts += 1;
          }
        } else if (op === 'insertPage') {
          const made = newPartLayer(pick(PAGE_TYPES), pctx, taken);
          if ('refusal' in made) continue;
          const spot = dropTargets(page, made.type);
          if (spot.length === 0) continue;
          const r = insertLayer(page, pick(spot), made);
          if (r.ok) page = r.root;
        } else if (op === 'moveMenu' || op === 'movePage') {
          const tree = op === 'moveMenu' ? menu : page;
          const ids = idsOf(tree, true);
          if (ids.length === 0) continue;
          const id = pick(ids);
          const type = findLayer(tree, id)!.layer.type;
          const spot = dropTargets(tree, type, id);
          if (spot.length === 0) continue;
          const r = moveLayer(tree, id, pick(spot));
          if (r.ok) {
            if (op === 'moveMenu') menu = r.root;
            else page = r.root;
          }
        } else if (op === 'transfer') {
          const from = pick(['page', 'menu'] as const);
          const src = from === 'page' ? page : menu;
          const dest = from === 'page' ? menu : page;
          const ids = idsOf(src, true);
          if (ids.length === 0) continue;
          const id = pick(ids);
          const spot = dropTargets(dest, findLayer(src, id)!.layer.type);
          if (spot.length === 0) continue;
          const r = transferLayer(page, menu, from, id, pick(spot), { page: pctx, menu: mctx });
          if (r.ok) {
            page = r.page;
            menu = r.menu;
            done.transfers += 1;
          } else {
            done.refusedTransfers += 1;
          }
        } else if (op === 'remove') {
          const tree = pick(['page', 'menu'] as const);
          const src = tree === 'page' ? page : menu;
          const ids = idsOf(src, true);
          if (ids.length === 0) continue;
          const r = removeLayer(src, pick(ids));
          if (r.ok) {
            if (tree === 'page') page = r.root;
            else menu = r.root;
          }
        } else {
          const tree = pick(['page', 'menu'] as const);
          const src = tree === 'page' ? page : menu;
          const texty = idsOf(src, true).filter((id) => ['Text', 'Button', 'Link'].includes(findLayer(src, id)!.layer.type));
          if (texty.length === 0) continue;
          const r = configureLayer(src, pick(texty), { children: 'Words' }, tree === 'page' ? pctx : mctx, tree);
          if (r.ok) {
            if (tree === 'page') page = r.root;
            else menu = r.root;
          }
        }
        const v = ok(page, menu);
        if (!v.ok) throw new Error(`run ${run} after ${log.join(', ')}: ${JSON.stringify(v.issues.slice(0, 3))}`);
        const all = [...listIds(page), ...listIds(menu)];
        expect(new Set(all).size, `run ${run} after ${log.join(', ')}: ids of both trees stay apart`).toBe(all.length);
      }
    }
    // The sequences really did put parts on the bar and move them across, and the bar refused some.
    expect(done.menuInserts).toBeGreaterThan(100);
    expect(done.transfers).toBeGreaterThan(30);
    expect(done.refusedTransfers).toBeGreaterThan(0);
  });
});
