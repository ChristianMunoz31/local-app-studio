import { describe, expect, it } from 'vitest';
import { CATALOG_CHECKS } from '@/catalog/validateLayout';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, AppSpecInput, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { ADD_WAY_IN, addWaysIn, noWayHere, noWayInLine, tablesAddedTo, waysIn, waysInLabel, waysInOutcome } from '../waysIn';

const SLUGS = ['appointments', 'crew-board', 'expense-log', 'inventory', 'invoices-and-clients', 'job-tracker', 'membership-attendance', 'reading-list'] as const;

type Raw = { menu?: Record<string, unknown>; pages: Array<{ id: string; layout: LayoutLayer; sources: unknown[] }>; tables: unknown[] };
const SPECS = import.meta.glob<unknown>('../../../../public/examples/*.spec.json', { eager: true, import: 'default' });
const specJson = (slug: string): unknown => JSON.parse(JSON.stringify(SPECS[`../../../../public/examples/${slug}.spec.json`]));
const raw = (slug: string): Raw => specJson(slug) as Raw;
const build = (input: Raw): AppSpec => {
  const out = validateAppSpec(input as unknown as AppSpecInput, { ...CATALOG_CHECKS });
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out.value;
};
const load = (slug: string, edit: (r: Raw) => void = () => {}): AppSpec => {
  const r = raw(slug);
  edit(r);
  return build(r);
};
const find = (layer: LayoutLayer, id: string): LayoutLayer | null => {
  if (layer.id === id) return layer;
  if (Array.isArray(layer.children)) for (const c of layer.children) { const f = find(c, id); if (f !== null) return f; }
  return null;
};
const drop = (layer: LayoutLayer, id: string): void => {
  if (!Array.isArray(layer.children)) return;
  layer.children = layer.children.filter((c) => c.id !== id);
  layer.children.forEach((c) => drop(c, id));
};
const page = (r: Raw, id: string) => r.pages.find((p) => p.id === id)!;
const crewsNoButtons = (r: Raw): void => {
  drop(page(r, 'home').layout, 'b1');
  drop(page(r, 'crews').layout, 'b1');
};
const noMenu = (r: Raw): void => {
  delete r.menu;
};
const H1 = (r: Raw): void => crewsNoButtons(r);
const H2 = (r: Raw): void => {
  crewsNoButtons(r);
  noMenu(r);
};
const text = (l: unknown): unknown => (l as LayoutLayer).children;
const kidTypes = (spec: AppSpec, id: string): string[] => {
  const p = spec.pages.find((x) => x.id === id)!;
  return Array.isArray(p.layout.children) ? p.layout.children.map((c) => `${c.type}:${c.id}`) : [];
};
const valid = (spec: AppSpec): boolean => validateAppSpec(spec, { ...CATALOG_CHECKS }).ok;

describe('the eight examples have a way in for every table', () => {
  for (const slug of SLUGS) {
    it(slug, () => {
      const spec = load(slug);
      expect(waysIn(spec)).toEqual([]);
      const out = addWaysIn(spec);
      expect(out.spec).toBe(spec);
      expect(out.added).toEqual([]);
      expect(out.left).toEqual([]);
    });
  }
});

describe('hand-made gaps', () => {
  it('H1 menu on: a menu button for each table, at the end', () => {
    const spec = load('crew-board', H1);
    expect(waysIn(spec)).toEqual([{ table: 'crews', tableLabel: 'Crews' }, { table: 'people', tableLabel: 'People' }]);
    const out = addWaysIn(spec);
    expect(out.left).toEqual([]);
    expect(out.added.map((a) => [a.kind, a.table, a.kind === 'menu' ? a.slot : ''])).toEqual([['menu', 'crews', 'end'], ['menu', 'people', 'end']]);
    expect((out.spec.menu?.end ?? []).map(text)).toEqual(['Add to Crews', 'Add to People']);
    expect(out.spec.menu?.end?.[0].props.action).toEqual({ action: 'open-form', table: 'crews', mode: 'create' });
    expect(waysIn(out.spec)).toEqual([]);
    expect(valid(out.spec)).toBe(true);
    expect(waysInOutcome(out)).toBe('Added a menu button for Crews and a menu button for People.');
    expect(waysInLabel(out)).toBe('added 2 ways to add records');
  });

  it('H2 menu off: a Form after the first list of each table', () => {
    const spec = load('crew-board', H2);
    const out = addWaysIn(spec);
    expect(out.left).toEqual([]);
    expect(kidTypes(out.spec, 'home')).toEqual(['PageHeader:h1', 'FilterBar:fb', 'DataTable:t1', 'RecordForm:recordform_2']);
    expect(kidTypes(out.spec, 'crews')).toEqual(['PageHeader:h1', 'RecordList:rl', 'RecordForm:recordform_1']);
    expect(out.added.map((a) => a.kind === 'form' && [a.table, a.pageId])).toEqual([['crews', 'crews'], ['people', 'home']]);
    expect(out.spec.menu).toBeUndefined();
    expect(valid(out.spec)).toBe(true);
    expect(waysIn(out.spec)).toEqual([]);
  });

  it('H2b Design scope: the open page only, the rest says where to go', () => {
    const out = addWaysIn(load('crew-board', H2), { pageId: 'home' });
    expect(out.added.map((a) => a.table)).toEqual(['people']);
    expect(out.left).toEqual([{ reason: 'other_page', table: 'crews', tableLabel: 'Crews', pageId: 'crews', pageTitle: 'Crews' }]);
    expect(waysInOutcome(out)).toBe('Added a Form for People on People. Open Crews to add one for Crews.');
    expect(waysInLabel(out)).toBe('added a way to add records');
  });

  it('H3 Quick add counts, wherever it is', () => {
    expect(waysIn(load('reading-list'))).toEqual([]);
    const spec = load('reading-list', (r) => {
      delete r.menu?.end;
    });
    expect(waysIn(spec)).toEqual([{ table: 'books', tableLabel: 'Books' }]);
    const out = addWaysIn(spec);
    expect((out.spec.menu?.end ?? []).map(text)).toEqual(['Add to Books']);
    expect(tablesAddedTo(out.spec).has('books')).toBe(true);
  });

  it('H4 an edit form on a record page does not count', () => {
    const edit = (r: Raw): void => {
      const rf = find(page(r, 'job').layout, 'rf')!;
      page(r, 'job').sources.push({ id: 'one_step', table: 'steps', mode: 'record' });
      rf.props = { table: 'steps', mode: 'edit', source: 'one_step' };
    };
    const on = load('job-tracker', edit);
    expect(waysIn(on)).toEqual([{ table: 'steps', tableLabel: 'Steps' }]);
    expect((addWaysIn(on).spec.menu?.end ?? []).map(text)).toEqual(['Add to Steps']);
    const off = addWaysIn(load('job-tracker', (r) => { edit(r); noMenu(r); }));
    expect(off.left).toEqual([]);
    expect(kidTypes(off.spec, 'job').slice(-2)).toEqual(['DataTable:t1', 'RecordForm:recordform_1']);
    expect(valid(off.spec)).toBe(true);
  });

  it('H5 a table nothing shows: a menu button, or not_shown without a menu', () => {
    const vendors = (r: Raw): void => {
      r.tables.push({ id: 'vendors', label: 'Vendors', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] });
    };
    const on = load('expense-log', vendors);
    expect(waysIn(on)).toEqual([{ table: 'vendors', tableLabel: 'Vendors' }]);
    expect((addWaysIn(on).spec.menu?.end ?? []).map(text)).toEqual(['Add to Vendors']);
    const off = addWaysIn(load('expense-log', (r) => { vendors(r); noMenu(r); }));
    expect(off.added).toEqual([]);
    expect(off.left).toEqual([{ reason: 'not_shown', table: 'vendors', tableLabel: 'Vendors' }]);
    expect(waysInOutcome(off)).toBe('Nothing was added. Nothing shows Vendors yet: put a list of it on a page first.');
  });

  it('H6 an edit form only: a side menu gets the button', () => {
    const spec = load('appointments', (r) => drop(page(r, 'clients').layout, 'b1'));
    expect(waysIn(spec)).toEqual([{ table: 'clients', tableLabel: 'Clients' }]);
    const out = addWaysIn(spec);
    expect(out.spec.menu?.position).toBe('side');
    expect((out.spec.menu?.end ?? []).map(text)).toEqual(['Add to Clients']);
  });

  it('H7 a row action that opens a create form counts', () => {
    const spec = load('crew-board', (r) => {
      H1(r);
      find(page(r, 'home').layout, 't1')!.props.rowAction = { action: 'open-form', table: 'people', mode: 'create' };
    });
    expect(waysIn(spec)).toEqual([{ table: 'crews', tableLabel: 'Crews' }]);
    expect(addWaysIn(spec).added.map((a) => a.table)).toEqual(['crews']);
  });

  it('H8 a full menu bar falls back to Forms', () => {
    const full = (): unknown[] => Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, type: 'Text', props: {}, children: 'Hi' }));
    const spec = load('crew-board', (r) => {
      H1(r);
      r.menu = { ...r.menu, start: full().map((l, i) => ({ ...(l as object), id: `s${i}` })), end: full().map((l, i) => ({ ...(l as object), id: `e${i}` })) };
    });
    const out = addWaysIn(spec);
    expect(out.added.map((a) => a.kind)).toEqual(['form', 'form']);
    expect(out.spec.menu).toBe(spec.menu);
    expect(valid(out.spec)).toBe(true);
  });

  it('H9 only', () => {
    const spec = load('crew-board', H1);
    const out = addWaysIn(spec, { only: ['crews'] });
    expect(out.added.map((a) => a.table)).toEqual(['crews']);
    expect((out.spec.menu?.end ?? []).map(text)).toEqual(['Add to Crews']);
    expect(waysIn(spec).length).toBe(2);
  });

  it('H10 a list inside a free Grid: the Form goes after the Grid', () => {
    const spec = load('crew-board', (r) => {
      H2(r);
      const root = page(r, 'home').layout;
      const kids = root.children as LayoutLayer[];
      const t1 = kids.find((c) => c.id === 't1')!;
      const grid: LayoutLayer = {
        id: 'g1',
        type: 'Grid',
        props: { placement: 'free', rows: 4, columns: 12 },
        children: [{ ...t1, grid: { col: 1, span: 12, row: 1, rowSpan: 3 } }],
      };
      root.children = kids.map((c) => (c.id === 't1' ? grid : c));
    });
    const out = addWaysIn(spec, { only: ['people'] });
    expect(out.left).toEqual([]);
    expect(kidTypes(out.spec, 'home')).toEqual(['PageHeader:h1', 'FilterBar:fb', 'Grid:g1', 'RecordForm:recordform_1']);
    expect(valid(out.spec)).toBe(true);
  });

  it('a Form that does not fit is left as no_room', () => {
    const spec = load('crew-board', H2);
    const stuffed = { ...spec, pages: spec.pages.map((p) => (p.id === 'crews' ? { ...p, layout: { ...p.layout, children: [...(p.layout.children as LayoutLayer[]), ...Array.from({ length: 300 }, (_, i) => ({ id: `pad${i}`, type: 'Divider', props: {}, children: [] }))] } } : p)) } as AppSpec;
    const out = addWaysIn(stuffed, { only: ['crews'] });
    expect(out.left).toEqual([{ reason: 'no_room', table: 'crews', tableLabel: 'Crews', pageTitle: 'Crews' }]);
    expect(out.spec).toBe(stuffed);
    expect(waysInOutcome(out)).toBe('Nothing was added. Crews has no room for a Form for Crews.');
  });
});

describe('words', () => {
  const gap = (label: string) => ({ table: label.toLowerCase(), tableLabel: label });
  it('names every gap', () => {
    expect(ADD_WAY_IN).toBe('Add a way to add records');
    expect(noWayInLine([gap('Crews')])).toBe('Crews has no way to add records yet.');
    expect(noWayInLine([gap('Crews'), gap('Steps')])).toBe('Crews and Steps have no way to add records yet.');
    expect(noWayInLine([gap('Crews'), gap('Steps'), gap('Jobs')])).toBe('Crews, Steps and Jobs have no way to add records yet.');
  });
  it('says what to do when nothing can be added', () => {
    expect(noWayHere(1)).toBe(' Show it on a page in Design first.');
    expect(noWayHere(2)).toBe(' Show them on a page in Design first.');
  });
});

describe('a malformed spec', () => {
  it('does not throw and does not skip the pages after a broken one', () => {
    const spec = load('crew-board', H2);
    const pages = spec.pages as unknown as Array<Record<string, unknown>>;
    const broken = { id: 'broken', title: 'Broken', route: '/broken' };
    const messy = { ...spec, pages: [broken, { id: 'blank', title: 'Blank', route: '/blank', layout: { id: 'r', type: 'Page', children: [undefined, { id: 'x', type: 'DataTable' }] } }, ...pages] } as unknown as AppSpec;
    expect(() => waysIn(messy)).not.toThrow();
    expect(waysIn(messy)).toEqual(waysIn(spec));
    expect([...tablesAddedTo(messy)]).toEqual([...tablesAddedTo(spec)]);
    const out = addWaysIn(messy);
    expect(out.added.map((a) => [a.kind, a.table, a.kind === 'form' ? a.pageId : ''])).toEqual([['form', 'crews', 'crews'], ['form', 'people', 'home']]);
  });
});
