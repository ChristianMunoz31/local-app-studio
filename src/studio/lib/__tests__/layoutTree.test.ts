import { describe, expect, it } from 'vitest';
import { crewCtx, crewSpec, exampleCtx, homeCtx, layer } from '@/catalog/__tests__/fixtures';
import { PART_DEFINITIONS } from '@/catalog/definitions';
import { SEED_FEATURES } from '@/catalog/features';
import { checkLayer, partContextFor } from '@/catalog/validateLayout';
import { LIMITS, LayerSizingSchema } from '@local-app-studio/runtime/spec/schema';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { LAYER_WIDTHS } from '@local-app-studio/runtime/spec/sizing';
import {
  addColumn,
  addTab,
  autoValues,
  canHold,
  configureLayer,
  dropTargets,
  findLayer,
  insertBeside,
  insertLayer,
  moveBeside,
  moveBy,
  moveLayer,
  newFeatureLayer,
  newPartLayer,
  removeLayer,
  replaceLayer,
  resizePair,
  setSizing,
  sideTargets,
  stepWidth,
} from '../layoutTree';
import { steer } from '../bindChoice';
import { specOf } from './bindFixtures';
import { boardDef } from './boardFeature';
import type { TreeRefusal, TreeResult } from '../layoutTree';

const marker = { id: 'kpi_row', version: 1, params: { source: 'open_crews' } };

/** root > sec(h, grid(t)), blk (feature block: stat), tabs(tab1(t1), tab2), table. */
const tree = (): LayoutLayer =>
  layer('root', 'Page', {}, [
    layer('sec', 'Section', { title: 'Overview' }, [layer('h', 'Heading', { size: 'lg' }, 'Title'), layer('grid', 'Grid', { columns: 2 }, [layer('t', 'Text', {}, 'Hi')])]),
    { ...layer('blk', 'Section', {}, [layer('stat', 'StatCard', { source: 'open_crews', stat: 'count', label: 'Crews' })]), name: 'Number row', feature: marker },
    layer('tabs', 'Tabs', {}, [layer('tab1', 'Tab', { label: 'One' }, [layer('t1', 'Text', {}, 'One')]), layer('tab2', 'Tab', { label: 'Two' }, [])]),
    layer('table', 'DataTable', { source: 'open_crews' }),
  ]);

const ids = (root: LayoutLayer): string[] => {
  const out: string[] = [];
  const stack = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    out.push(l.id);
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return out;
};
const childIds = (root: LayoutLayer, id: string): string[] => {
  const kids = findLayer(root, id)?.layer.children;
  return Array.isArray(kids) ? kids.map((k) => k.id) : [];
};
const reason = (r: TreeResult): TreeRefusal | 'ok' => (r.ok ? 'ok' : r.reason);
const must = (r: TreeResult): LayoutLayer => {
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.message}`);
  return r.root;
};
const text = (id: string): LayoutLayer => layer(id, 'Text', {}, 'x');

describe('findLayer and canHold', () => {
  it('locates a layer with its parent, index and block state', () => {
    const root = tree();
    expect(findLayer(root, 'h')).toMatchObject({ parent: { id: 'sec' }, index: 0, inBlock: false });
    expect(findLayer(root, 'blk')).toMatchObject({ index: 1, inBlock: false });
    expect(findLayer(root, 'stat')?.inBlock).toBe(true);
    expect(findLayer(root, 'root')).toMatchObject({ parent: null, index: 0 });
    expect(findLayer(root, 'nope')).toBeNull();
  });

  it('follows the part definitions: never a Page, Tabs only hold Tab, Tab only inside Tabs', () => {
    const root = tree();
    const get = (id: string): LayoutLayer => findLayer(root, id)!.layer;
    expect(canHold(get('root'), 'Section')).toBe(true);
    expect(canHold(get('root'), 'Page')).toBe(false);
    expect(canHold(get('root'), 'Tab')).toBe(false);
    expect(canHold(get('tabs'), 'Tab')).toBe(true);
    expect(canHold(get('tabs'), 'Section')).toBe(false);
    expect(canHold(get('h'), 'Text')).toBe(false);
  });
});

describe('dropTargets', () => {
  it('offers every place in containers outside blocks, and nothing inside a block', () => {
    const targets = dropTargets(tree(), 'Text');
    expect(targets.filter((t) => t.parentId === 'root').map((t) => t.index)).toEqual([0, 1, 2, 3, 4]);
    expect(targets.some((t) => t.parentId === 'blk')).toBe(false);
    expect(targets.some((t) => t.parentId === 'tabs')).toBe(false);
    expect(targets.some((t) => t.parentId === 'tab2' && t.index === 0)).toBe(true);
  });

  it('offers only the end of a grid', () => {
    expect(dropTargets(tree(), 'Text').filter((t) => t.parentId === 'grid')).toEqual([{ parentId: 'grid', index: 1 }]);
  });

  it('offers the places of a tab inside Tabs only', () => {
    expect(dropTargets(tree(), 'Tab')).toEqual([
      { parentId: 'tabs', index: 0 },
      { parentId: 'tabs', index: 1 },
      { parentId: 'tabs', index: 2 },
    ]);
  });

  it('leaves out the moving layer, its subtree and the places that change nothing', () => {
    const targets = dropTargets(tree(), 'Section', 'sec');
    expect(targets.some((t) => t.parentId === 'sec' || t.parentId === 'grid')).toBe(false);
    expect(targets.filter((t) => t.parentId === 'root').map((t) => t.index)).toEqual([2, 3, 4]);
  });

  it('offers nothing for the root or for a layer inside a block', () => {
    expect(dropTargets(tree(), 'Page', 'root')).toEqual([]);
    expect(dropTargets(tree(), 'StatCard', 'stat')).toEqual([]);
  });
});

describe('insertLayer', () => {
  it('inserts at an index and focuses the new layer', () => {
    const r = insertLayer(tree(), { parentId: 'sec', index: 1 }, text('new'));
    expect(r.ok && r.focusId).toBe('new');
    expect(childIds(must(r), 'sec')).toEqual(['h', 'new', 'grid']);
  });

  it('never changes its input and shares what it did not touch', () => {
    const root = tree();
    const before = JSON.stringify(root);
    const next = must(insertLayer(root, { parentId: 'sec', index: 0 }, text('new')));
    expect(JSON.stringify(root)).toBe(before);
    expect(findLayer(next, 'tabs')!.layer).toBe(findLayer(root, 'tabs')!.layer);
  });

  it('refuses a missing parent, a feature block and anything inside one', () => {
    expect(reason(insertLayer(tree(), { parentId: 'nope', index: 0 }, text('n')))).toBe('not_found');
    expect(reason(insertLayer(tree(), { parentId: 'blk', index: 0 }, text('n')))).toBe('inside_block');
    expect(reason(insertLayer(tree(), { parentId: 'stat', index: 0 }, text('n')))).toBe('inside_block');
  });

  it('refuses parts the parent cannot hold, in plain words', () => {
    const tabs = insertLayer(tree(), { parentId: 'tabs', index: 0 }, text('n'));
    expect(tabs).toEqual({ ok: false, reason: 'not_allowed_here', message: 'Tabs only hold tab panels.' });
    expect(reason(insertLayer(tree(), { parentId: 'root', index: 0 }, layer('p', 'Page')))).toBe('not_allowed_here');
    expect(reason(insertLayer(tree(), { parentId: 'root', index: 0 }, layer('p', 'Tab')))).toBe('not_allowed_here');
    expect(reason(insertLayer(tree(), { parentId: 'h', index: 0 }, text('n')))).toBe('not_allowed_here');
  });

  it('refuses a bad place, a bad id and ids that are already used', () => {
    expect(reason(insertLayer(tree(), { parentId: 'sec', index: 9 }, text('n')))).toBe('bad_value');
    expect(reason(insertLayer(tree(), { parentId: 'sec', index: -1 }, text('n')))).toBe('bad_value');
    expect(reason(insertLayer(tree(), { parentId: 'sec', index: 0 }, text('h')))).toBe('bad_value');
    expect(reason(insertLayer(tree(), { parentId: 'sec', index: 0 }, text('bad id')))).toBe('not_allowed_here');
    expect(reason(insertLayer(tree(), { parentId: 'sec', index: 0 }, layer('a', 'Section', {}, [text('a')])))).toBe('bad_value');
  });

  it('enforces the layer count', () => {
    const full = layer('root', 'Page', {}, Array.from({ length: LIMITS.layersPerPage - 2 }, (_, i) => text(`t${i}`)));
    const last = insertLayer(full, { parentId: 'root', index: 0 }, text('last'));
    expect(last.ok).toBe(true);
    const over = insertLayer(must(last), { parentId: 'root', index: 0 }, text('over'));
    expect(over).toMatchObject({ ok: false, reason: 'too_many_layers', message: 'This page is full: at most 300 parts.' });
  });

  it('enforces the depth', () => {
    let deep = layer('s0', 'Section');
    for (let i = 1; i < LIMITS.layerDepth - 2; i += 1) deep = layer(`s${i}`, 'Section', {}, [deep]);
    const root = layer('root', 'Page', {}, [deep]);
    // root plus 14 sections is 15 levels, one more section fits (16), a section with a part inside does not.
    expect(insertLayer(root, { parentId: 's0', index: 0 }, layer('x', 'Section')).ok).toBe(true);
    expect(reason(insertLayer(root, { parentId: 's0', index: 0 }, layer('x', 'Section', {}, [text('y')])))).toBe('too_deep');
  });
});

describe('moving into another container from the list of drop targets', () => {
  it('every offered target for a moving layer is accepted by moveLayer and lands in that container', () => {
    const root = tree();
    const targets = dropTargets(root, 'Text', 't');
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some((x) => x.parentId === 'root')).toBe(true);
    expect(targets.every((x) => x.parentId !== 'blk' && x.parentId !== 'stat')).toBe(true);
    for (const target of targets) {
      const next = must(moveLayer(root, 't', target));
      expect(findLayer(next, 't')?.parent?.id).toBe(target.parentId);
    }
  });

  it('offers nothing for the page itself', () => {
    expect(dropTargets(tree(), 'Page', 'root')).toEqual([]);
  });
});

describe('moveLayer', () => {
  it('moves into another container and keeps the layer', () => {
    const r = moveLayer(tree(), 'h', { parentId: 'tab2', index: 0 });
    expect(r).toMatchObject({ ok: true, focusId: 'h' });
    expect(childIds(must(r), 'tab2')).toEqual(['h']);
    expect(childIds(must(r), 'sec')).toEqual(['grid']);
  });

  it('adjusts the index inside the same parent', () => {
    const root = must(insertLayer(tree(), { parentId: 'sec', index: 2 }, text('c')));
    expect(childIds(must(moveLayer(root, 'h', { parentId: 'sec', index: 3 })), 'sec')).toEqual(['grid', 'c', 'h']);
    expect(childIds(must(moveLayer(root, 'c', { parentId: 'sec', index: 0 })), 'sec')).toEqual(['c', 'h', 'grid']);
  });

  it('answers ok with the same root when nothing changes', () => {
    const root = tree();
    expect(must(moveLayer(root, 'h', { parentId: 'sec', index: 0 }))).toBe(root);
    expect(must(moveLayer(root, 'h', { parentId: 'sec', index: 1 }))).toBe(root);
  });

  it('refuses the root, a missing layer, a layer inside a block and a target in a block', () => {
    expect(reason(moveLayer(tree(), 'root', { parentId: 'sec', index: 0 }))).toBe('root_locked');
    expect(reason(moveLayer(tree(), 'nope', { parentId: 'sec', index: 0 }))).toBe('not_found');
    expect(reason(moveLayer(tree(), 'h', { parentId: 'nope', index: 0 }))).toBe('not_found');
    expect(reason(moveLayer(tree(), 'stat', { parentId: 'sec', index: 0 }))).toBe('inside_block');
    expect(reason(moveLayer(tree(), 'h', { parentId: 'blk', index: 0 }))).toBe('inside_block');
  });

  it('refuses to move a layer into itself or its own subtree', () => {
    expect(reason(moveLayer(tree(), 'sec', { parentId: 'sec', index: 0 }))).toBe('into_itself');
    expect(reason(moveLayer(tree(), 'sec', { parentId: 'grid', index: 0 }))).toBe('into_itself');
  });

  it('moves a block as one unit and refuses parts a parent cannot hold', () => {
    expect(childIds(must(moveLayer(tree(), 'blk', { parentId: 'tab2', index: 0 })), 'tab2')).toEqual(['blk']);
    expect(reason(moveLayer(tree(), 'h', { parentId: 'tabs', index: 0 }))).toBe('not_allowed_here');
    expect(reason(moveLayer(tree(), 'tab1', { parentId: 'root', index: 0 }))).toBe('not_allowed_here');
  });

  it('moves a tab inside Tabs', () => {
    expect(childIds(must(moveLayer(tree(), 'tab2', { parentId: 'tabs', index: 0 })), 'tabs')).toEqual(['tab2', 'tab1']);
  });

  it('refuses a move that nests the page too deep', () => {
    let deep = layer('s0', 'Section');
    for (let i = 1; i < LIMITS.layerDepth - 2; i += 1) deep = layer(`s${i}`, 'Section', {}, [deep]);
    const root = layer('root', 'Page', {}, [deep, layer('x', 'Section', {}, [text('y')])]);
    expect(reason(moveLayer(root, 'x', { parentId: 's0', index: 0 }))).toBe('too_deep');
  });
});

describe('moveBy', () => {
  it('swaps with the neighbour', () => {
    expect(childIds(must(moveBy(tree(), 'sec', 1)), 'root')).toEqual(['blk', 'sec', 'tabs', 'table']);
    expect(childIds(must(moveBy(tree(), 'table', -1)), 'root')).toEqual(['sec', 'blk', 'table', 'tabs']);
    expect(childIds(must(moveBy(tree(), 'tab1', 1)), 'tabs')).toEqual(['tab2', 'tab1']);
  });

  it('is ok and unchanged at an edge', () => {
    const root = tree();
    expect(must(moveBy(root, 'sec', -1))).toBe(root);
    expect(must(moveBy(root, 'table', 1))).toBe(root);
  });

  it('refuses the root, missing layers and layers inside a block', () => {
    expect(reason(moveBy(tree(), 'root', 1))).toBe('root_locked');
    expect(reason(moveBy(tree(), 'nope', 1))).toBe('not_found');
    expect(reason(moveBy(tree(), 'stat', 1))).toBe('inside_block');
  });
});

describe('removeLayer', () => {
  it('removes a layer with its subtree and focuses its parent', () => {
    const r = removeLayer(tree(), 'sec');
    expect(r).toMatchObject({ ok: true, focusId: 'root' });
    expect(ids(must(r))).not.toContain('grid');
  });

  it('removes a whole block but never a part of one', () => {
    expect(ids(must(removeLayer(tree(), 'blk')))).not.toContain('stat');
    expect(reason(removeLayer(tree(), 'stat'))).toBe('inside_block');
  });

  it('refuses the root and missing layers', () => {
    expect(reason(removeLayer(tree(), 'root'))).toBe('root_locked');
    expect(reason(removeLayer(tree(), 'nope'))).toBe('not_found');
  });
});

describe('replaceLayer', () => {
  it('replaces in place and may reuse the old ids', () => {
    const next = { ...layer('blk', 'Section', {}, [layer('stat', 'StatCard', { source: 'open_crews', stat: 'count', label: 'New' })]), feature: marker };
    const root = must(replaceLayer(tree(), 'blk', next));
    expect(childIds(root, 'root')).toEqual(['sec', 'blk', 'tabs', 'table']);
    expect((findLayer(root, 'stat')!.layer.props as { label: string }).label).toBe('New');
  });

  it('refuses the root, a layer inside a block, ids used elsewhere and parts the parent cannot hold', () => {
    expect(reason(replaceLayer(tree(), 'root', layer('root', 'Page')))).toBe('root_locked');
    expect(reason(replaceLayer(tree(), 'stat', layer('stat', 'StatCard')))).toBe('inside_block');
    expect(reason(replaceLayer(tree(), 'blk', layer('blk', 'Section', {}, [text('h')])))).toBe('bad_value');
    expect(reason(replaceLayer(tree(), 'tab1', layer('tab1', 'Section')))).toBe('not_allowed_here');
  });
});

describe('configureLayer', () => {
  const ctx = crewCtx();
  const page = (): LayoutLayer =>
    layer('root', 'Page', {}, [
      layer('list', 'DataTable', { source: 'open_crews', columns: ['name', 'size'] }),
      layer('head', 'Heading', { size: 'lg' }, 'Crews'),
      layer('sec', 'Section', { title: 'Overview' }),
      layer('stat', 'StatCard', { source: 'open_crews', stat: 'sum', field: 'size', label: 'People' }),
      { ...layer('blk', 'Section', { title: 'Block' }), feature: marker },
    ]);
  const propsOf = (root: LayoutLayer, id: string): Record<string, unknown> => findLayer(root, id)!.layer.props;

  it('writes text, title and field settings by their place', () => {
    expect(findLayer(must(configureLayer(page(), 'head', { children: 'People' }, ctx)), 'head')!.layer.children).toBe('People');
    expect(propsOf(must(configureLayer(page(), 'sec', { 'props.title': 'Totals' }, ctx)), 'sec').title).toBe('Totals');
    expect(propsOf(must(configureLayer(page(), 'stat', { 'props.field': 'size' }, ctx)), 'stat').field).toBe('size');
  });

  it('drops the field list when the list changes to a list of another table', () => {
    const other = { ...ctx, sourceIds: ['open_crews', 'people_list'], sources: { ...ctx.sources, people_list: { table: 'people', mode: 'list' as const } }, tableIds: ['crews', 'people'], fields: { ...ctx.fields, people: [{ id: 'name', type: 'text' as const }] } };
    const root = must(configureLayer(page(), 'list', { 'props.source': 'people_list' }, other));
    expect(propsOf(root, 'list').columns).toBeUndefined();
    const same = must(configureLayer(page(), 'list', { 'props.source': 'open_crews' }, ctx));
    expect(propsOf(same, 'list').columns).toEqual(['name', 'size']);
  });

  it('drops the field list when the table of a form changes', () => {
    const form = layer('root', 'Page', {}, [layer('form', 'RecordForm', { table: 'crews', fields: ['name', 'size'], submitLabel: 'Add' })]);
    const other = { ...ctx, tableIds: ['crews', 'people'], fields: { ...ctx.fields, people: [{ id: 'name', type: 'text' as const }] } };
    const root = must(configureLayer(form, 'form', { 'props.table': 'people' }, other));
    expect(propsOf(root, 'form').fields).toBeUndefined();
  });

  it('refuses className, style, handlers, prototype keys and other places that are not slots', () => {
    for (const key of ['props.className', 'props.style', 'props.onClick', 'props.__proto__.x', 'props.size', 'props.constructor', 'children.x', 'type', 'id', '']) {
      expect(reason(configureLayer(page(), 'head', { [key]: 'x' }, ctx)), key).toBe('bad_value');
    }
    expect(reason(configureLayer(page(), 'list', { 'props.__proto__': 'x' }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'list', { 'props.pageSize': '10' }, ctx))).toBe('bad_value');
  });

  it('refuses ids this page does not have, the wrong kind of list and bad texts', () => {
    expect(reason(configureLayer(page(), 'list', { 'props.source': 'nope' }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'list', { 'props.source': 'one_crew' }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'stat', { 'props.field': 'name' }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'head', { children: '' }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'head', { children: 'a'.repeat(LIMITS.layerTextChars + 1) }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'head', { children: 'a\u0007b' }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'head', { children: 5 as unknown as string }, ctx))).toBe('bad_value');
    expect(configureLayer(page(), 'head', { children: 'two\nlines' }, ctx).ok).toBe(true);
  });

  it('refuses a missing layer, a feature block and a part inside one', () => {
    expect(reason(configureLayer(page(), 'nope', { children: 'x' }, ctx))).toBe('not_found');
    expect(reason(configureLayer(page(), 'blk', { 'props.title': 'x' }, ctx))).toBe('inside_block');
    const nested = layer('root', 'Page', {}, [{ ...layer('b', 'Section', {}, [layer('inner', 'Heading', {}, 'x')]), feature: marker }]);
    expect(reason(configureLayer(nested, 'inner', { children: 'y' }, ctx))).toBe('inside_block');
  });

  it('never changes its input', () => {
    const root = page();
    const before = JSON.stringify(root);
    configureLayer(root, 'head', { children: 'People' }, ctx);
    configureLayer(root, 'list', { 'props.source': 'nope' }, ctx);
    expect(JSON.stringify(root)).toBe(before);
  });
});

describe('newPartLayer', () => {
  it('gives every part a valid layer on the pages of Crew Roster, or a refusal in plain words', () => {
    const spec = crewSpec();
    for (const page of spec.pages) {
      const ctx = partContextFor(spec, page);
      for (const def of PART_DEFINITIONS) {
        if (def.name === 'Page' || def.name === 'Tab') continue;
        const made = newPartLayer(def.name, ctx, new Set(['root']));
        if ('refusal' in made) {
          expect(made.refusal, `${page.id} ${def.name}`).toMatch(/^[A-Z][^_{}]*\.$/);
          continue;
        }
        expect(checkLayer(made, ctx, 'layer'), `${page.id} ${def.name}`).toEqual([]);
        expect(made.id).toMatch(new RegExp(`^${def.name.toLowerCase()}_\\d+$`));
      }
    }
  });

  it('adds every part on the record page, and refuses record parts on a page without a record', () => {
    const crew = exampleCtx();
    for (const def of PART_DEFINITIONS) {
      if (def.name === 'Page' || def.name === 'Tab' || def.name === 'Column') continue;
      const made = newPartLayer(def.name, crew, new Set());
      // A Checklist needs a yes/no field: it is pointed at the list that has one (tasks), not at the first list (crews).
      expect('refusal' in made, def.name).toBe(false);
      if (!('refusal' in made)) expect(checkLayer(made, crew, 'layer'), def.name).toEqual([]);
    }
    expect(newPartLayer('RecordDetail', homeCtx(), new Set())).toEqual({ refusal: 'Add a list to this page first, in Page settings.' });
  });

  it('a new Chart on a table with Done and Status groups by Status (the bind order), not Done', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'tasks' ? { ...t, fields: [...t.fields, { id: 'status', label: 'Status', type: 'select', options: ['a', 'b'] }] } : t));
    });
    const home = s.pages.find((p) => p.id === 'home')!;
    const ctx = steer(partContextFor(s, home), { sourceId: 'all_tasks', tableId: 'tasks' });
    const chart = newPartLayer('Chart', ctx, new Set()) as LayoutLayer;
    expect(chart.props).toMatchObject({ source: 'all_tasks', groupBy: 'status' });
  });

  it('refuses a page and a tab, and names nothing twice', () => {
    expect('refusal' in newPartLayer('Page', crewCtx(), new Set())).toBe(true);
    expect('refusal' in newPartLayer('Tab', crewCtx(), new Set())).toBe(true);
    const a = newPartLayer('Section', crewCtx(), new Set(['section_1'])) as LayoutLayer;
    expect(a.id).toBe('section_2');
    expect(ids(a)).toEqual([...new Set(ids(a))]);
  });

  it('starts with neutral words and points ids at the page', () => {
    const stat = newPartLayer('StatCard', crewCtx(), new Set()) as LayoutLayer;
    expect(stat.props.label).toBe('Total');
    const button = newPartLayer('Button', crewCtx(), new Set()) as LayoutLayer;
    expect(button.children).toBe('Button');
    expect(button.props.action).toMatchObject({ pageId: 'home' });
  });
});

describe('B9: a number tile with no number field', () => {
  it('counts rows and has no field', () => {
    const ctx = crewCtx();
    const noNumbers = { ...ctx, fields: Object.fromEntries(Object.entries(ctx.fields).map(([t, fs]) => [t, fs.filter((f) => f.type !== 'integer' && f.type !== 'real')])) };
    const stat = newPartLayer('StatCard', noNumbers, new Set()) as LayoutLayer;
    expect('refusal' in stat).toBe(false);
    expect(stat.props.stat).toBe('count');
    expect(stat.props.field).toBeUndefined();
    expect(checkLayer(stat, noNumbers, 'layer')).toEqual([]);
  });
});

describe('features', () => {
  it('autoValues picks the first valid choice or says there is none', () => {
    const def = SEED_FEATURES.find((f) => f.params.some((p) => p.type === 'source'))!;
    expect(autoValues(def, crewCtx())).not.toBeNull();
    expect(autoValues(def, { ...crewCtx(), sourceIds: [], sources: {} })).toBeNull();
  });

  it('autoValues puts a slot on one table: the list of the page leads, the table follows it, the field is a choice, the words are the canvas words', () => {
    const def = boardDef();
    expect(autoValues(def, exampleCtx())).toEqual({
      things: 'crews',
      things_list: 'open_crews',
      status: 'status',
      title_field: 'name',
      board_title: 'Status board',
    });
    // A page whose first list is of another table moves the table with it, never the first table of the app.
    const tasksFirst = { ...exampleCtx(), sourceIds: ['open_tasks', 'open_crews', 'one_crew'] };
    expect(autoValues(def, tasksFirst)).toMatchObject({ things: 'tasks', things_list: 'open_tasks', status: 'done' });
    // No list on the page: there is no choice.
    expect(autoValues(def, { ...exampleCtx(), sourceIds: [], sources: {} })).toBeNull();
  });

  it('newFeatureLayer expands at a free id with a marker and leaves the given set alone', () => {
    const lib = new Map(SEED_FEATURES.map((d) => [d.id, d]));
    const def = SEED_FEATURES.find((d) => autoValues(d, crewCtx()) !== null)!;
    const taken = new Set(['root', `${def.id}_1`]);
    const r = newFeatureLayer(def, autoValues(def, crewCtx())!, crewCtx(), lib, taken);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe(`${def.id}_2`);
      expect(r.value.feature?.id).toBe(def.id);
    }
    expect(taken.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Property test: seeded random sequences keep every invariant
// ---------------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Visit {
  layer: LayoutLayer;
  parent: LayoutLayer | null;
  depth: number;
}

function walk(root: LayoutLayer): Visit[] {
  const out: Visit[] = [];
  const stack: Visit[] = [{ layer: root, parent: null, depth: 1 }];
  for (let e = stack.pop(); e !== undefined; e = stack.pop()) {
    out.push(e);
    if (Array.isArray(e.layer.children)) for (const c of e.layer.children) stack.push({ layer: c, parent: e.layer, depth: e.depth + 1 });
  }
  return out;
}

/** The tree of the unit tests plus two half blocks side by side at the end of the page (phase 9). */
const sizedTree = (): LayoutLayer => {
  const base = tree();
  const half = (id: string): LayoutLayer => ({ ...layer(id, 'Text', {}, id), sizing: { width: 'half', grow: false } });
  return { ...base, children: [...(Array.isArray(base.children) ? base.children : []), half('hl'), half('hr')] };
};

const KEEPS_WIDTHS: ReadonlySet<string> = new Set(['insert', 'insertPart', 'move', 'moveValid', 'moveBy', 'remove']);
const SIZING_OPS: ReadonlySet<string> = new Set(['beside', 'moveBeside', 'sizing', 'resize', 'step']);

/** Widths after an accepted result: valid blocks only where they may be, moves keep them, a width op touches at most two. */
function checkSizing(root: LayoutLayer, previous: LayoutLayer, op: string): void {
  const all = walk(root);
  for (const { layer: l } of all) {
    if (l.sizing === undefined) continue;
    expect(LayerSizingSchema.safeParse(l.sizing).success).toBe(true);
    expect(Object.keys(l.sizing).sort()).toEqual(['grow', 'width']);
    expect(['Page', 'Tab', 'Column']).not.toContain(l.type);
  }
  const before = new Map(walk(previous).map((e) => [e.layer.id, JSON.stringify(e.layer.sizing ?? null)]));
  const changed = all.filter((e) => before.has(e.layer.id) && before.get(e.layer.id) !== JSON.stringify(e.layer.sizing ?? null));
  if (KEEPS_WIDTHS.has(op)) expect(changed.map((e) => e.layer.id)).toEqual([]);
  if (SIZING_OPS.has(op)) {
    expect(changed.length).toBeLessThanOrEqual(2);
    for (const e of changed) expect(e.layer.sizing?.width).not.toBe('full');
  }
}

function checkInvariants(root: LayoutLayer, previous: LayoutLayer, replacedId: string | null): void {
  const all = walk(root);
  expect(root.id).toBe(previous.id);
  expect(root.type).toBe('Page');
  const seen = new Set<string>();
  for (const { layer: l, parent, depth } of all) {
    expect(seen.has(l.id)).toBe(false);
    seen.add(l.id);
    expect(depth).toBeLessThanOrEqual(LIMITS.layerDepth);
    if (parent !== null) {
      expect(l.type).not.toBe('Page');
      expect(canHold(parent, l.type)).toBe(true);
    }
    // A Columns part keeps 2 to 4 columns through every operation.
    if (l.type === 'Columns' && l.feature === undefined && Array.isArray(l.children)) {
      expect(l.children.length).toBeGreaterThanOrEqual(2);
      expect(l.children.length).toBeLessThanOrEqual(4);
    }
  }
  expect(all.length).toBeLessThanOrEqual(LIMITS.layersPerPage);
  // A feature block's subtree is only ever replaced as a whole or removed with it. The block's own width is its place, not its content.
  const after = new Map(all.map((e) => [e.layer.id, e.layer]));
  const content = (l: LayoutLayer): string => JSON.stringify({ ...l, sizing: undefined });
  for (const e of walk(previous)) {
    if (e.layer.feature === undefined || e.layer.id === replacedId) continue;
    const now = after.get(e.layer.id);
    if (now !== undefined) expect(content(now)).toBe(content(e.layer));
  }
}

describe('random sequences', () => {
  const ctx = crewCtx();
  const TYPES = PART_DEFINITIONS.map((d) => d.name).filter((n) => n !== 'Page' && n !== 'Tab');

  it('keep a single root, unique ids, allowed children, the limits, untouched blocks and valid widths (500 sequences)', () => {
    let accepted = 0;
    let refused = 0;
    for (let seed = 1; seed <= 500; seed += 1) {
      const rand = rng(seed);
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
      let root = sizedTree();
      let counter = 0;
      for (let step = 0; step < 40; step += 1) {
        const all = walk(root).map((e) => e.layer);
        const anyId = (): string => (rand() < 0.05 ? 'missing' : pick(all).id);
        const before = JSON.stringify(root);
        const op = pick(['insert', 'insert', 'insertPart', 'move', 'move', 'moveValid', 'moveBy', 'remove', 'configure', 'replace', 'beside', 'moveBeside', 'sizing', 'resize', 'step']);
        let result: TreeResult;
        let replacedId: string | null = null;
        if (op === 'insert') {
          const type = pick(['Section', 'Text', 'Grid', 'Tabs', 'Tab', 'Page', 'Heading', 'Columns', 'Column', 'Row']);
          const parent = pick(all);
          counter += 1;
          const freshId = rand() < 0.1 ? parent.id : `n${seed}_${counter}`;
          const inner = type === 'Columns' ? [layer(`${freshId}a`, 'Column', {}, [text(`${freshId}x`)]), layer(`${freshId}b`, 'Column')] : [];
          const fresh = layer(freshId, type, type === 'Tab' ? { label: 'T' } : {}, type === 'Text' || type === 'Heading' ? 'x' : inner);
          result = insertLayer(root, { parentId: rand() < 0.1 ? 'missing' : parent.id, index: Math.floor(rand() * 6) - 1 }, fresh);
        } else if (op === 'insertPart') {
          const made = newPartLayer(pick(TYPES), ctx, new Set(all.map((l) => l.id)));
          if ('refusal' in made) continue;
          const targets = dropTargets(root, made.type);
          result = insertLayer(root, targets.length > 0 ? pick(targets) : { parentId: root.id, index: 0 }, made);
        } else if (op === 'move') {
          result = moveLayer(root, anyId(), { parentId: anyId(), index: Math.floor(rand() * 6) - 1 });
        } else if (op === 'moveValid') {
          const moving = pick(all);
          const targets = dropTargets(root, moving.type, moving.id);
          result = targets.length > 0 ? moveLayer(root, moving.id, pick(targets)) : moveBy(root, moving.id, 1);
        } else if (op === 'moveBy') {
          result = moveBy(root, anyId(), rand() < 0.5 ? -1 : 1);
        } else if (op === 'remove') {
          result = removeLayer(root, anyId());
        } else if (op === 'configure') {
          const key = pick(['children', 'props.title', 'props.source', 'props.className', 'props.label', 'props.__proto__.x']);
          result = configureLayer(root, pick(all).id, { [key]: pick(['Hello', 'open_crews', 'one_crew', 'nope', '']) }, ctx);
        } else if (op === 'beside') {
          const made = newPartLayer(pick(TYPES), ctx, new Set(all.map((l) => l.id)));
          if ('refusal' in made) continue;
          const sides = sideTargets(root, made.type);
          result = insertBeside(root, sides.length > 0 && rand() < 0.9 ? pick(sides) : { targetId: anyId(), side: pick(['left', 'right'] as const) }, made);
        } else if (op === 'moveBeside') {
          const moving = pick(all);
          const sides = sideTargets(root, moving.type, moving.id);
          result = moveBeside(root, moving.id, sides.length > 0 && rand() < 0.8 ? pick(sides) : { targetId: anyId(), side: pick(['left', 'right'] as const) });
        } else if (op === 'sizing') {
          result = setSizing(root, anyId(), { width: pick([...LAYER_WIDTHS, 'huge']), grow: rand() < 0.5 });
        } else if (op === 'resize') {
          result = resizePair(root, anyId(), Math.floor(rand() * 5) - 2);
        } else if (op === 'step') {
          result = stepWidth(root, anyId(), rand() < 0.5 ? -1 : 1);
        } else {
          const target = pick(all);
          counter += 1;
          replacedId = target.id;
          result = replaceLayer(root, target.id, layer(rand() < 0.5 ? target.id : `r${seed}_${counter}`, pick(['Section', 'Text', 'Tab', 'Card']), {}, []));
        }
        expect(JSON.stringify(root), 'input never changes').toBe(before);
        if (!result.ok) {
          refused += 1;
          expect(result.message.length).toBeGreaterThan(0);
          continue;
        }
        accepted += 1;
        checkInvariants(result.root, root, replacedId);
        checkSizing(result.root, root, op);
        expect(findLayer(result.root, result.focusId)).not.toBeNull();
        root = result.root;
      }
      // The catalog check of the whole page is slow, so it runs once per sequence: no width where it is refused.
      expect(checkLayer(root, ctx, 'layer', LIMITS.issues).filter((i) => i.code === 'sizing_not_allowed')).toEqual([]);
    }
    expect(accepted).toBeGreaterThan(2000);
    expect(refused).toBeGreaterThan(500);
    // About 10 s on a laptop with the width operations; the default 20 s is too tight when the whole suite runs at once.
  }, 60_000);
});

describe('addTab', () => {
  const taken = (root: LayoutLayer): ReadonlySet<string> => new Set(ids(root));

  it('adds a labelled, empty tab at the end of Tabs and returns its id', () => {
    const root = tree();
    const res = addTab(root, 'tabs', crewCtx(), taken(root));
    const next = must(res);
    expect(childIds(next, 'tabs')).toEqual(['tab1', 'tab2', 'tab_1']);
    const added = findLayer(next, 'tab_1')?.layer;
    expect(added).toMatchObject({ type: 'Tab', props: { label: 'Tab 3' } });
    expect(Array.isArray(added?.children) ? added.children.map((c) => c.type) : ['missing']).toEqual([]);
    expect(res.ok && res.focusId).toBe('tab_1');
    expect(checkLayer(next, crewCtx(), 'layer')).toEqual([]);
    expect(childIds(root, 'tabs')).toEqual(['tab1', 'tab2']);
  });

  it('picks a label and ids that are not taken', () => {
    const root = tree();
    const first = must(addTab(root, 'tabs', crewCtx(), taken(root)));
    const second = must(addTab(first, 'tabs', crewCtx(), taken(first)));
    expect(childIds(second, 'tabs')).toEqual(['tab1', 'tab2', 'tab_1', 'tab_2']);
    expect(findLayer(second, 'tab_2')?.layer.props.label).toBe('Tab 4');
    expect(new Set(ids(second)).size).toBe(ids(second).length);
  });

  it('refuses a part that is not Tabs, a missing part, a feature block and a full page', () => {
    const root = tree();
    expect(reason(addTab(root, 'sec', crewCtx(), taken(root)))).toBe('not_allowed_here');
    expect(reason(addTab(root, 'nope', crewCtx(), taken(root)))).toBe('not_found');
    const inBlock = layer('root', 'Page', {}, [{ ...layer('tabs', 'Tabs', {}, []), name: 'Tabbed', feature: marker }]);
    expect(reason(addTab(inBlock, 'tabs', crewCtx(), taken(inBlock)))).toBe('inside_block');
    const full = layer('root', 'Page', {}, [
      layer('tabs', 'Tabs', {}, []),
      ...Array.from({ length: LIMITS.layersPerPage - 2 }, (_, i) => text(`x${i}`)),
    ]);
    expect(reason(addTab(full, 'tabs', crewCtx(), taken(full)))).toBe('too_many_layers');
  });
});

describe('Columns and child counts', () => {
  const cols = (n: number, id = 'cols'): LayoutLayer =>
    layer(id, 'Columns', {}, Array.from({ length: n }, (_, i) => layer(`${id}_c${i + 1}`, 'Column', {}, [text(`${id}_t${i + 1}`)])));
  const page = (n: number): LayoutLayer => layer('root', 'Page', {}, [cols(n), layer('sec', 'Section', { title: 'S' }, [text('s1')])]);
  const ctx = crewCtx();
  const taken = (root: LayoutLayer): ReadonlySet<string> => new Set(ids(root));

  it('lets only Column go in Columns and Column go nowhere else', () => {
    const root = page(2);
    expect(canHold(findLayer(root, 'cols')!.layer, 'Column')).toBe(true);
    expect(canHold(findLayer(root, 'cols')!.layer, 'Text')).toBe(false);
    expect(canHold(findLayer(root, 'sec')!.layer, 'Column')).toBe(false);
    expect(canHold(findLayer(root, 'cols_c1')!.layer, 'Text')).toBe(true);
    expect(reason(insertLayer(root, { parentId: 'sec', index: 0 }, layer('x', 'Column')))).toBe('not_allowed_here');
    expect(reason(insertLayer(root, { parentId: 'cols', index: 0 }, text('x')))).toBe('not_allowed_here');
  });

  it('refuses a fifth column, a move that overfills Columns, and removing below two', () => {
    const four = page(4);
    const full = insertLayer(four, { parentId: 'cols', index: 4 }, layer('c5', 'Column'));
    expect(reason(full)).toBe('child_count');
    expect(!full.ok && full.message).toBe('Columns hold 2 to 4 columns.');
    const two = page(2);
    expect(reason(removeLayer(two, 'cols_c1'))).toBe('child_count');
    expect(!removeLayer(two, 'cols_c1').ok && (removeLayer(two, 'cols_c1') as { message: string }).message).toBe('Columns hold 2 to 4 columns.');
    expect(childIds(must(removeLayer(page(3), 'cols_c1')), 'cols')).toEqual(['cols_c2', 'cols_c3']);
    // Column to another Columns: the target must have room and the source must keep two.
    const both = layer('root', 'Page', {}, [cols(4, 'a'), cols(2, 'b'), cols(3, 'c')]);
    expect(reason(moveLayer(both, 'b_c1', { parentId: 'a', index: 0 }))).toBe('child_count');
    expect(reason(moveLayer(both, 'b_c1', { parentId: 'c', index: 0 }))).toBe('child_count');
    expect(reason(moveLayer(both, 'c_c1', { parentId: 'b', index: 0 }))).toBe('ok');
    expect(reason(moveLayer(both, 'a_c1', { parentId: 'a', index: 3 }))).toBe('ok');
  });

  it('offers only the places that keep the count', () => {
    const both = layer('root', 'Page', {}, [cols(4, 'a'), cols(2, 'b'), cols(3, 'c')]);
    const forNew = dropTargets(both, 'Column');
    expect(forNew.some((t) => t.parentId === 'a')).toBe(false);
    expect(forNew.some((t) => t.parentId === 'b')).toBe(true);
    const moving = dropTargets(both, 'Column', 'b_c1');
    expect(moving.filter((t) => t.parentId !== 'b')).toEqual([]);
    for (const t of dropTargets(both, 'Column', 'c_c1')) expect(moveLayer(both, 'c_c1', t).ok, `${t.parentId}:${t.index}`).toBe(true);
    // A part moves between the columns like between any two containers.
    const moved = must(moveLayer(page(2), 'cols_t1', { parentId: 'cols_c2', index: 1 }));
    expect(childIds(moved, 'cols_c1')).toEqual([]);
    expect(childIds(moved, 'cols_c2')).toEqual(['cols_t2', 'cols_t1']);
  });

  it('holds a page header to three buttons', () => {
    const button = (id: string): LayoutLayer => layer(id, 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go');
    const header = layer('root', 'Page', {}, [layer('hd', 'PageHeader', { title: 'T' }, [button('b1'), button('b2'), button('b3')]), button('b4')]);
    const refused = insertLayer(header, { parentId: 'hd', index: 3 }, button('b5'));
    expect(reason(refused)).toBe('child_count');
    expect(!refused.ok && refused.message).toBe('A page header holds at most 3 buttons, links or quick adds.');
    expect(reason(moveLayer(header, 'b4', { parentId: 'hd', index: 0 }))).toBe('child_count');
    expect(dropTargets(header, 'Button', 'b4').some((t) => t.parentId === 'hd')).toBe(false);
    expect(reason(removeLayer(header, 'b1'))).toBe('ok');
  });

  it('addColumn adds an empty Column N at the end, and refuses like an insert', () => {
    const root = page(2);
    const res = addColumn(root, 'cols', ctx, taken(root));
    const next = must(res);
    expect(childIds(next, 'cols')).toEqual(['cols_c1', 'cols_c2', 'column_1']);
    expect(res.ok && res.focusId).toBe('column_1');
    const added = findLayer(next, 'column_1')!.layer;
    expect(Array.isArray(added.children) ? added.children.map((c) => c.type) : ['missing']).toEqual([]);
    expect(checkLayer(next, ctx, 'layer')).toEqual([]);
    expect(reason(addColumn(page(4), 'cols', ctx, taken(page(4))))).toBe('child_count');
    expect(reason(addColumn(root, 'sec', ctx, taken(root)))).toBe('not_allowed_here');
    expect(reason(addColumn(root, 'nope', ctx, taken(root)))).toBe('not_found');
    const block = layer('root', 'Page', {}, [{ ...cols(2), name: 'Two sides', feature: marker }]);
    expect(reason(addColumn(block, 'cols', ctx, taken(block)))).toBe('inside_block');
  });

  it('a new Columns part starts equal with two columns, and a Column cannot be added alone', () => {
    const made = newPartLayer('Columns', exampleCtx(), new Set()) as LayoutLayer;
    expect(made.props.layout).toBeUndefined();
    expect(Array.isArray(made.children) ? made.children.map((c) => c.type) : []).toEqual(['Column', 'Column']);
    expect(newPartLayer('Column', exampleCtx(), new Set())).toEqual({ refusal: expect.stringMatching(/^[A-Z][^_{}]*\.$/) });
  });
});

describe('a new Grid', () => {
  it('starts empty like Columns and Tabs, with no placeholder Text', () => {
    const made = newPartLayer('Grid', exampleCtx(), new Set()) as LayoutLayer;
    expect(made.children).toEqual([]);
  });
});

describe('newPartLayer on bound parts', () => {
  it('drops an optional bound prop with no candidate and points a page bind at a page that opens without a record', () => {
    const crumb = newPartLayer('Breadcrumb', homeCtx(), new Set()) as LayoutLayer;
    expect(crumb.props.source).toBeUndefined();
    expect(crumb.props.page).toBe('home');
    const back = newPartLayer('BackLink', exampleCtx(), new Set()) as LayoutLayer;
    expect(back.props.action).toMatchObject({ pageId: 'home' });
    const onRecord = newPartLayer('Breadcrumb', exampleCtx(), new Set()) as LayoutLayer;
    expect(onRecord.props).toMatchObject({ page: 'home', source: 'one_crew' });
  });

  it('points a required field at the first list that has one', () => {
    const list = newPartLayer('Checklist', exampleCtx(), new Set()) as LayoutLayer;
    expect(list.props).toMatchObject({ source: 'open_tasks', field: 'done' });
    expect(newPartLayer('Checklist', crewCtx(), new Set())).toEqual({ refusal: expect.stringMatching(/^[A-Z][^_{}]*\.$/) });
  });
});

describe('configureLayer with choice and number settings', () => {
  const ctx = exampleCtx();
  const page = (): LayoutLayer =>
    layer('root', 'Page', {}, [
      layer('cols', 'Columns', {}, [layer('c1', 'Column', {}, []), layer('c2', 'Column', {}, [])]),
      layer('row', 'Row', { justify: 'between' }, []),
      layer('nav', 'NavLinks', { show: 'menu' }),
      layer('pb', 'ProgressBar', { source: 'open_crews', stat: 'count', label: 'Crews', target: 10 }),
      layer('chart', 'Chart', { source: 'open_crews', groupBy: 'status', measure: 'count', field: 'size' }),
      layer('note', 'Callout', { tone: 'note' }, 'Hi'),
      layer('head', 'Heading', { size: 'lg' }, 'Title'),
      { ...layer('blk', 'Columns', {}, []), feature: marker },
    ]);
  const propsOf = (root: LayoutLayer, id: string): Record<string, unknown> => findLayer(root, id)!.layer.props;

  it('writes an enum that is an option of the part, and a number inside its bounds', () => {
    expect(propsOf(must(configureLayer(page(), 'cols', { 'props.layout': 'wide-left', 'props.gap': 'lg' }, ctx)), 'cols')).toMatchObject({ layout: 'wide-left', gap: 'lg' });
    expect(propsOf(must(configureLayer(page(), 'row', { 'props.wrap': 'one-line' }, ctx)), 'row')).toMatchObject({ justify: 'between', wrap: 'one-line' });
    expect(propsOf(must(configureLayer(page(), 'note', { 'props.tone': 'danger' }, ctx)), 'note').tone).toBe('danger');
    expect(propsOf(must(configureLayer(page(), 'pb', { 'props.target': '25' }, ctx)), 'pb').target).toBe(25);
    expect(propsOf(must(configureLayer(page(), 'pb', { 'props.target': '1000000000' }, ctx)), 'pb').target).toBe(1000000000);
    expect(propsOf(must(configureLayer(page(), 'pb', { 'props.tone': 'success' }, ctx)), 'pb').tone).toBe('success');
  });

  it('refuses a value outside the options, bad numbers, and keys that are not choices', () => {
    const bad = (id: string, values: Record<string, string>): TreeRefusal | 'ok' => reason(configureLayer(page(), id, values, ctx));
    expect(bad('cols', { 'props.layout': 'thirds' })).toBe('bad_value');
    expect(bad('cols', { 'props.layout': '__proto__' })).toBe('bad_value');
    expect(bad('cols', { 'props.layout': '' })).toBe('bad_value');
    expect(bad('cols', { 'props.className': 'x' })).toBe('bad_value');
    expect(bad('cols', { 'props.style': 'x' })).toBe('bad_value');
    expect(bad('cols', { 'props.__proto__.x': 'x' })).toBe('bad_value');
    expect(bad('cols', { 'props.constructor': 'x' })).toBe('bad_value');
    expect(bad('head', { 'props.layout': 'equal' })).toBe('bad_value');
    for (const n of ['0', '10000000000', '1000000001', '1e10', '-5', '2.5', 'abc', '', ' 5']) expect(bad('pb', { 'props.target': n }), n).toBe('bad_value');
    expect(bad('blk', { 'props.layout': 'equal' })).toBe('inside_block');
  });

  it('keeps cross-prop rules: sum needs a number field, links to pages need pages', () => {
    const sum = reason(configureLayer(layer('root', 'Page', {}, [layer('c', 'Chart', { source: 'open_crews', groupBy: 'status', measure: 'count' })]), 'c', { 'props.measure': 'sum' }, ctx));
    expect(sum).toBe('bad_value');
    expect(propsOf(must(configureLayer(page(), 'chart', { 'props.measure': 'sum' }, ctx)), 'chart').measure).toBe('sum');
    expect(reason(configureLayer(page(), 'nav', { 'props.show': 'pages' }, ctx))).toBe('bad_value');
    const ok = must(configureLayer(page(), 'nav', { 'props.show': 'pages', 'props.pages': 'home' }, ctx));
    expect(propsOf(ok, 'nav')).toMatchObject({ show: 'pages', pages: ['home'] });
    expect(reason(configureLayer(page(), 'nav', { 'props.show': 'pages', 'props.pages': 'crew' }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'nav', { 'props.show': 'pages', 'props.pages': 'home,nope' }, ctx))).toBe('bad_value');
    expect(reason(configureLayer(page(), 'nav', { 'props.show': 'pages', 'props.pages': Array.from({ length: 9 }, () => 'home').join(',') }, ctx))).toBe('ok');
    const cleared = must(configureLayer(ok, 'nav', { 'props.show': 'menu', 'props.pages': '' }, ctx));
    expect(propsOf(cleared, 'nav').pages).toBeUndefined();
  });

  it('never changes its input', () => {
    const root = page();
    const before = JSON.stringify(root);
    configureLayer(root, 'cols', { 'props.layout': 'wide-left' }, ctx);
    configureLayer(root, 'pb', { 'props.target': '0' }, ctx);
    expect(JSON.stringify(root)).toBe(before);
  });
});

describe('navigation containers and the menu words', () => {
  const header = (children: LayoutLayer[]): LayoutLayer => layer('root', 'Page', {}, [layer('ph', 'PageHeader', { title: 'T' }, children)]);
  const link = (id: string): LayoutLayer => layer(id, 'Link', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go');

  it('lets a page header hold a button, a link and a quick add, but not a table', () => {
    const ph = findLayer(header([]), 'ph')!.layer;
    expect(canHold(ph, 'Button')).toBe(true);
    expect(canHold(ph, 'Link')).toBe(true);
    expect(canHold(ph, 'QuickAdd')).toBe(true);
    expect(canHold(ph, 'DataTable')).toBe(false);
    const refused = insertLayer(header([]), { parentId: 'ph', index: 0 }, layer('t', 'DataTable', { source: 'open_crews' }));
    expect(refused).toMatchObject({ ok: false, message: 'A page header can only hold buttons, links and quick adds.' });
  });

  it('refuses a fourth part in a page header with the new words', () => {
    const full = header([link('l1'), link('l2'), link('l3')]);
    expect(insertLayer(full, { parentId: 'ph', index: 3 }, link('l4'))).toMatchObject({ ok: false, reason: 'child_count', message: 'A page header holds at most 3 buttons, links or quick adds.' });
  });

  it('lets page links hold up to three buttons and links, and says so when it refuses', () => {
    const links = layer('root', 'Page', {}, [layer('nl', 'NavLinks', {}, [])]);
    expect(canHold(findLayer(links, 'nl')!.layer, 'Link')).toBe(true);
    expect(insertLayer(links, { parentId: 'nl', index: 0 }, text('t'))).toMatchObject({ ok: false, message: 'Page links can only hold buttons and links.' });
    const full = layer('root', 'Page', {}, [layer('nl', 'NavLinks', {}, [link('l1'), link('l2'), link('l3')])]);
    expect(insertLayer(full, { parentId: 'nl', index: 3 }, link('l4'))).toMatchObject({ ok: false, reason: 'child_count', message: 'Page links hold at most 3 buttons or links.' });
  });
});
