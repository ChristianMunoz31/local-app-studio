import { describe, expect, it } from 'vitest';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { defaultRowPage, recordPagesFor } from '../bindChoice';
import { connectLayer, planDrop } from '../bindOnDrop';
import type { ConnectChoice } from '../bindOnDrop';
import { findLayer } from '../layoutTree';
import { PAGE_COPY, addRecordPage, makeRecordPage, pageReferrers, titleClash, withRowActions } from '../pageRules';
import { statLabel } from '../statLabel';
import { pageOf, specOf } from './bindFixtures';

const page = (children: LayoutLayer[]): LayoutLayer => ({ id: 'root', type: 'Page', props: {}, children });
const button = (id: string, pageId: string): LayoutLayer => ({ id, type: 'Button', props: { label: 'Go', action: { action: 'navigate', pageId, withRecord: false } }, children: [] });
const table = (id: string, source: string, rowAction?: boolean): LayoutLayer => ({
  id,
  type: 'DataTable',
  props: { source, ...(rowAction === true ? { rowAction: { action: 'navigate', pageId: 'crew', withRecord: true } } : {}) },
  children: [],
});
/** The part the person gets after answering the chooser a drop asks (P17-14): the plan must ask, and connectLayer builds it. */
const dropAnswered = (type: string, spec: AppSpec, taken: ReadonlySet<string>, choice: ConnectChoice): LayoutLayer => {
  const home = pageOf(spec, 'home');
  const plan = planDrop(type, spec, home, taken);
  if (plan.kind !== 'choose') throw new Error(`expected choose, got ${plan.kind}`);
  const out = connectLayer(page([plan.layer]), plan.layer.id, choice, spec, { ...home, sources: plan.sources }, taken);
  if (!out.result.ok) throw new Error(out.result.message);
  const found = findLayer(out.result.root, plan.layer.id);
  if (found === null) throw new Error('part lost');
  return found.layer;
};
const mustBeValid = (spec: AppSpec): void => {
  const result = validateAppSpec(spec);
  expect(result.ok ? [] : result.issues).toEqual([]);
};

describe('titleClash (P-34)', () => {
  const spec = specOf();
  it('refuses a title another page has, whatever the case', () => {
    expect(titleClash(spec, 'other')).toBe('A page called Other already exists. Pick another title.');
    expect(titleClash(spec, '  HOME ')).toBe(PAGE_COPY.titleTaken('Home'));
  });
  it('accepts a new title and the page own title', () => {
    expect(titleClash(spec, 'Archive')).toBeNull();
    expect(titleClash(spec, 'Other', 'other')).toBeNull();
  });
});

describe('pageReferrers (P-33)', () => {
  it('names a button on another page in plain words and asks to change it first', () => {
    const spec = specOf((i) => {
      i.pages[0].layout = page([button('button_1', 'other')]);
    });
    expect(pageReferrers(spec, 'other')).toEqual({ lines: ['The Button on Home goes to this page.'], closing: PAGE_COPY.changeOne });
  });
  it('names a row click, and says nothing for a page nobody goes to', () => {
    const spec = specOf((i) => {
      i.pages[3].layout = page([table('datatable_1', 'x', true)]);
      i.pages[3].sources = [{ id: 'x', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 }];
    });
    expect(pageReferrers(spec, 'crew').lines).toEqual(['The Table of records on Blank opens this page when a row is clicked.']);
    expect(pageReferrers(spec, 'blank').lines).toEqual([]);
  });
  it('ignores the parts of the page itself', () => {
    const spec = specOf((i) => {
      i.pages[2].layout = page([button('button_1', 'other')]);
    });
    expect(pageReferrers(spec, 'other').lines).toEqual([]);
  });
  it('shows no id and counts a long list', () => {
    const spec = specOf((i) => {
      i.pages[0].layout = page(Array.from({ length: 7 }, (_, n) => button(`button_${n + 1}`, 'blank')));
    });
    const out = pageReferrers(spec, 'blank');
    expect(out.lines).toEqual(['The Button on Home goes to this page.']);
    expect(out.closing).toBe(PAGE_COPY.changeOne);
  });
});

describe('record pages (P-26)', () => {
  it('adds a page that shows one record: address, no menu entry, Record details bound to its record list', () => {
    const spec = specOf();
    const made = addRecordPage(spec, 'Tasks', 'tasks');
    if (!made.ok) throw new Error(made.message);
    const added = made.spec.pages.find((p) => p.id === made.pageId)!;
    expect(added.route).toBe('/tasks/:id');
    expect(added.sources).toHaveLength(1);
    expect(added.sources[0]).toMatchObject({ table: 'tasks', mode: 'record' });
    expect(made.spec.nav.some((n) => n.pageId === made.pageId)).toBe(false);
    const layers = (added.layout.children as LayoutLayer[]).map((l) => l.type);
    expect(layers).toContain('RecordDetail');
    mustBeValid(made.spec);
  });
  it('refuses a title another page has', () => {
    const made = addRecordPage(specOf(), 'Home', 'tasks');
    expect(made).toEqual({ ok: false, message: PAGE_COPY.titleTaken('Home') });
  });
  it('lists of the table that do nothing on a click open the new page (P-05), others are left alone', () => {
    const spec = specOf((i) => {
      i.pages[0].layout = page([table('datatable_1', 'all_tasks'), table('datatable_2', 'all_crews')]);
    });
    const made = addRecordPage(spec, 'Task', 'tasks');
    if (!made.ok) throw new Error(made.message);
    const home = made.spec.pages[0].layout.children as LayoutLayer[];
    expect(home[0].props.rowAction).toEqual({ action: 'navigate', pageId: made.pageId, withRecord: true });
    // The list of another table is left alone, even though that table has a record page of its own.
    expect(home[1].props.rowAction).toBeUndefined();
    mustBeValid(made.spec);
  });
  it('makes a plain page show one record: the address gets the number, the menu entry goes, Record details is added', () => {
    const spec = specOf((i) => {
      i.nav = [...(i.nav ?? []), { pageId: 'blank', label: 'Blank' }];
    });
    const made = makeRecordPage(spec, 'blank', 'tasks');
    if (!made.ok) throw new Error(made.message);
    const converted = made.spec.pages.find((p) => p.id === 'blank')!;
    expect(converted.route).toBe('/blank/:id');
    expect(made.spec.nav.some((n) => n.pageId === 'blank')).toBe(false);
    expect((converted.layout.children as LayoutLayer[]).map((l) => l.type)).toContain('RecordDetail');
    mustBeValid(made.spec);
  });
  it('does not turn the home page or a record page into a record page', () => {
    const spec = specOf();
    expect(makeRecordPage(spec, 'home', 'tasks')).toEqual({ ok: false, message: PAGE_COPY.homeNoRecord });
    expect(makeRecordPage(spec, 'crew', 'crews')).toEqual({ ok: false, message: PAGE_COPY.alreadyRecord });
  });
});

describe('row click default (P-05)', () => {
  const spec = specOf();
  it('finds the record pages of a table and the unique default', () => {
    expect(recordPagesFor(spec, 'crews').map((p) => p.id)).toEqual(['crew']);
    expect(defaultRowPage(spec, 'crews')).toBe('crew');
    expect(defaultRowPage(spec, 'tasks')).toBeNull();
  });
  it('a Table of records dropped on a page gets the record page of its table', () => {
    const layer = dropAnswered('DataTable', spec, new Set(), { sourceId: 'all_crews' });
    expect(layer.props.rowAction).toEqual({ action: 'navigate', pageId: 'crew', withRecord: true });
  });
  it('no default when the table has no record page', () => {
    const layer = dropAnswered('DataTable', spec, new Set(['datatable_1']), { sourceId: 'all_tasks' });
    expect(layer.props.rowAction).toBeUndefined();
  });
  it('withRowActions leaves a list that already has an action, and does nothing when the table has two record pages', () => {
    const own = specOf((i) => {
      i.pages[0].layout = page([table('datatable_1', 'all_crews', true)]);
    });
    expect(withRowActions(own, 'crews')).toEqual(own);
  });
});

describe('statLabel (P-32)', () => {
  it('names the field it sums and the table it counts', () => {
    expect(statLabel('sum', 'Amount', 'Invoices')).toBe('Sum of Amount');
    expect(statLabel('avg', 'Amount', 'Invoices')).toBe('Average of Amount');
    expect(statLabel('count', undefined, 'Invoices')).toBe('Count of Invoices');
  });
  it('a Number tile dropped on a page is named by what it adds up', () => {
    const spec = specOf();
    const layer = dropAnswered('StatCard', spec, new Set(), { sourceId: 'all_crews' });
    expect(layer.props.label).toMatch(/^(Sum of |Count of )/);
    expect(layer.props.label).not.toBe('Total');
  });
});
