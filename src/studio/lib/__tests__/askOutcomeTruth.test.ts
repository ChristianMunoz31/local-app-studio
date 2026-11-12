import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer, Page } from '@local-app-studio/runtime/spec/schema';
import { EXIT_DATA, EXIT_DESIGN, askOutcome } from '../askOutcome';
import type { AskOutcome } from '../askOutcome';
import { changeBullets } from '../promptBullets';
import { diffSpecs, summarizeChanges } from '../specDiff';
import { tasksSpec } from './promptBulletsFixtures';

const judge = (ask: string, before: AppSpec, after: AppSpec): AskOutcome => askOutcome({ ask, changes: diffSpecs(before, after), before, after });
const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('fixture is missing a part');
  return value;
};
const onPage = (spec: AppSpec, id: string): Page => must(spec.pages.find((p) => p.id === id));
const grid = { id: 'grid_1', type: 'Grid', props: { placement: 'free', columns: 12, rows: 4 }, children: [{ id: 'h_g', type: 'Heading', props: {}, children: 'Hi', grid: { col: 1, span: 4, row: 1, rowSpan: 1 } }] } as unknown as LayoutLayer;
const withGrid = (spec: AppSpec, id: string): AppSpec => {
  const next = structuredClone(spec);
  (onPage(next, id).layout.children as LayoutLayer[]).push(structuredClone(grid));
  return next;
};
const form: LayoutLayer = { id: 'recordform_1', type: 'RecordForm', props: { table: 'projects' }, children: [] };
const withForm = (spec: AppSpec): AppSpec => {
  const next = structuredClone(spec);
  (onPage(next, 'projects').layout.children as LayoutLayer[]).push(structuredClone(form));
  return next;
};
const withPages = (spec: AppSpec): AppSpec => {
  const next = structuredClone(spec);
  for (const [id, title] of [['deposits', 'Task Deposits'], ['helpers', 'Helper Callers']]) {
    next.pages.push({ ...structuredClone(onPage(next, 'projects')), id, title, route: `/${id}` });
    next.nav.push({ pageId: id, label: title, icon: 'folder' });
  }
  return next;
};

describe('strip ask words judge the named page only', () => {
  const ask = 'On the page Open tasks: Put this page on a free grid';

  it('is Not done when only another page got the grid, and the header counts one page', () => {
    const before = tasksSpec();
    const after = withGrid(before, 'projects');
    const outcome = judge(ask, before, after);
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0].done).toBe(false);
    expect(outcome.lines[0].exit?.label).toBe(EXIT_DESIGN);
    expect(summarizeChanges(diffSpecs(before, after))).toBe('1 page changed');
  });

  it('is Done when the named page got a free grid it did not have', () => {
    const before = tasksSpec();
    expect(judge(ask, before, withGrid(before, 'home')).lines[0].done).toBe(true);
  });

  it('is Not done when the named page already had that grid', () => {
    const before = withGrid(tasksSpec(), 'home');
    const after = structuredClone(before);
    (onPage(after, 'home').layout.children as LayoutLayer[]).push({ id: 'h_2', type: 'Heading', props: {}, children: 'More' });
    expect(judge(ask, before, after).lines[0].done).toBe(false);
  });
});

describe('a field or table clause is judged by the tables only', () => {
  const ask = 'I need to keep track of a deposit, so please add a deposit to tasks. And I would like a list of the helpers I call: their name and phone.';

  it('is Not done when two pages were added and the tables did not change; the pages and the lost form are listed', () => {
    const before = withForm(tasksSpec());
    const after = withPages(before);
    onPage(after, 'projects').layout.children = (onPage(after, 'projects').layout.children as LayoutLayer[]).filter((l) => l.type !== 'RecordForm');
    const outcome = judge(ask, before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([false, false]);
    expect(outcome.lines.map((l) => l.exit?.label)).toEqual([EXIT_DATA, EXIT_DATA]);
    const shown = changeBullets(after, outcome.alsoChanged).shown;
    expect(shown).toContain('Added the page Task Deposits');
    expect(shown).toContain('Added the page Helper Callers');
    expect(shown).toContain('Removed the Projects form from Projects');
  });

  it('is Done for a field added to the named table', () => {
    const before = tasksSpec();
    const after = structuredClone(before);
    must(after.tables.find((t) => t.id === 'tasks')).fields.push({ id: 'deposit', label: 'Deposit', type: 'text', required: false });
    expect(judge(ask, before, after).lines[0].done).toBe(true);
  });
});

describe('a strip ask reads its clause without the page prefix (RV26-52, RV26-57)', () => {
  const list: LayoutLayer = { id: 'list_1', type: 'RecordList', props: { table: 'tasks' }, children: [] };
  const tile = (n: number): LayoutLayer => ({ id: `statcard_${n}`, type: 'StatCard', props: { table: 'tasks', label: `Tile ${n}` }, children: [] });

  it('is Done for a field added by "On the page Open tasks: add a deposit"', () => {
    const before = tasksSpec();
    const after = structuredClone(before);
    must(after.tables.find((t) => t.id === 'tasks')).fields.push({ id: 'deposit', label: 'Deposit', type: 'text', required: false });
    expect(judge('On the page Open tasks: add a deposit', before, after).lines[0].done).toBe(true);
  });

  it('still scopes three tiles to the named page', () => {
    const before = tasksSpec();
    const onHome = structuredClone(before);
    (onPage(onHome, 'home').layout.children as LayoutLayer[]).push(tile(1), tile(2), tile(3));
    const onOther = structuredClone(before);
    (onPage(onOther, 'projects').layout.children as LayoutLayer[]).push(tile(1), tile(2), tile(3));
    const ask = 'On the page Open tasks: make it a dashboard with three tiles';
    expect(judge(ask, before, onHome).lines[0].done).toBe(true);
    expect(judge(ask, before, onOther).lines[0].done).toBe(false);
  });

  it('lets the named page meet "add a list of chores"', () => {
    const before = tasksSpec();
    const after = structuredClone(before);
    (onPage(after, 'home').layout.children as LayoutLayer[]).push(structuredClone(list));
    expect(judge('On the page Open tasks: add a list of chores', before, after).lines[0].done).toBe(true);
  });

  it('keeps the scope when the ask renames its own page', () => {
    const before = tasksSpec();
    const after = withGrid(before, 'projects');
    onPage(after, 'home').title = 'Chores';
    expect(judge('On the page Open tasks: Put this page on a free grid', before, after).lines[0].done).toBe(false);
  });
});
