import { describe, expect, it } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { followResult, followTitle, followWords } from '../followWords';
import { pageOf, specOf } from './bindFixtures';

const spec = specOf();
const sources = pageOf(spec, 'home').sources;
const layer = (type: string, props: LayoutLayer['props'], children: LayoutLayer['children'] = []): LayoutLayer => ({ id: `${type.toLowerCase()}_1`, type, props, children });
const adds = (table: string, text: string): LayoutLayer => layer('Button', { action: { action: 'open-form', table, mode: 'create' } }, text);

describe('followWords', () => {
  it('a menu Button "Add to Crews" becomes "Add to Tasks" when its table changes', () => {
    const out = followWords(adds('crews', 'Add to Crews'), adds('tasks', 'Add to Crews'), spec, sources);
    expect(out.children).toBe('Add to Tasks');
  });
  it('a Button with typed words keeps them', () => {
    const after = adds('tasks', 'Join the crew');
    expect(followWords(adds('crews', 'Join the crew'), after, spec, sources)).toBe(after);
  });
  it('a Button that does not add (navigate) is left alone', () => {
    const go = layer('Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Add to Crews');
    expect(followWords(go, go, spec, sources)).toBe(go);
  });
  it('a Quick add placeholder follows its table', () => {
    const out = followWords(layer('QuickAdd', { table: 'crews', field: 'name', placeholder: 'Add to Crews' }), layer('QuickAdd', { table: 'tasks', field: 'title', placeholder: 'Add to Crews' }), spec, sources);
    expect(out.props.placeholder).toBe('Add to Tasks');
  });
  it('a Chart "Crews by Status" becomes "Tasks by Done" with the list and the group, and keeps a typed title', () => {
    const a = layer('Chart', { source: 'all_crews', groupBy: 'status', title: 'Crews by Status' });
    const b = layer('Chart', { source: 'all_tasks', groupBy: 'done', title: 'Crews by Status' });
    expect(followWords(a, b, spec, sources).props.title).toBe('Tasks by Done');
    const typed = layer('Chart', { source: 'all_tasks', groupBy: 'done', title: 'Where we stand' });
    expect(followWords(layer('Chart', { source: 'all_crews', groupBy: 'status', title: 'Where we stand' }), typed, spec, sources)).toBe(typed);
  });
  it('a Chart whose group field changes inside the same table follows the group', () => {
    const a = layer('Chart', { source: 'all_crews', groupBy: 'status', title: 'Crews by Status' });
    const b = layer('Chart', { source: 'all_crews', groupBy: 'lead_id', title: 'Crews by Status' });
    expect(followWords(a, b, spec, sources).props.title).toBe('Crews by Lead');
  });
  it('a Progress bar label and a Number tile label follow', () => {
    expect(followWords(layer('ProgressBar', { source: 'all_crews', label: 'Crews' }), layer('ProgressBar', { source: 'all_tasks', label: 'Crews' }), spec, sources).props.label).toBe('Tasks');
    const a = layer('StatCard', { source: 'all_crews', stat: 'sum', field: 'size', label: 'Sum of Size' });
    const b = layer('StatCard', { source: 'all_tasks', stat: 'count', label: 'Sum of Size' });
    expect(followWords(a, b, spec, sources).props.label).toBe('Count of Tasks');
  });
  it('a Number tile the person labelled "Total" keeps it when its table changes', () => {
    const a = layer('StatCard', { source: 'all_crews', stat: 'count', label: 'Total' });
    const b = layer('StatCard', { source: 'all_tasks', stat: 'count', label: 'Total' });
    expect(followWords(a, b, spec, sources)).toBe(b);
  });
  it('words typed in the same Apply stay, and a part with no default rule is untouched', () => {
    const a = layer('Chart', { source: 'all_crews', groupBy: 'status', title: 'Crews by Status' });
    const typed = layer('Chart', { source: 'all_tasks', groupBy: 'done', title: 'My chart' });
    expect(followWords(a, typed, spec, sources)).toBe(typed);
    const h = layer('Heading', { size: 'lg' }, 'Add to Crews');
    expect(followWords(h, h, spec, sources)).toBe(h);
  });
  it('does not mutate its inputs', () => {
    const before = adds('crews', 'Add to Crews');
    const after = adds('tasks', 'Add to Crews');
    const frozen = JSON.stringify([before, after]);
    followWords(before, after, spec, sources);
    expect(JSON.stringify([before, after])).toBe(frozen);
  });
});

describe('followResult', () => {
  const root = (child: LayoutLayer): LayoutLayer => ({ id: 'root', type: 'Page', props: {}, children: [child] });
  it('rewrites the words of the changed part inside the new tree and keeps the focus', () => {
    const was = root(adds('crews', 'Add to Crews'));
    const result = followResult(was, { ok: true, root: root(adds('tasks', 'Add to Crews')), focusId: 'button_1' }, 'button_1', spec, sources);
    expect(result.ok && Array.isArray(result.root.children) ? result.root.children[0].children : null).toBe('Add to Tasks');
    expect(result.ok && result.focusId).toBe('button_1');
  });
  it('passes a refusal through', () => {
    const refused = { ok: false as const, reason: 'bad_value' as const, message: 'no' };
    expect(followResult(root(adds('crews', 'x')), refused, 'button_1', spec, sources)).toBe(refused);
  });
});

describe('followTitle', () => {
  const tree = (): LayoutLayer => ({
    id: 'root',
    type: 'Page',
    props: {},
    children: [
      { id: 'h1', type: 'Heading', props: { size: 'lg' }, children: 'Home' },
      { id: 'h2', type: 'Heading', props: { size: 'md' }, children: 'Typed words' },
      { id: 's1', type: 'Section', props: { title: 'Home' }, children: [{ id: 'ph', type: 'PageHeader', props: { title: 'Home' }, children: [] }] },
      { id: 't1', type: 'Text', props: {}, children: 'Home' },
    ],
  });
  it('rewrites a Heading, Section title and Page header title that equal the old title, and nothing else', () => {
    const out = followTitle(tree(), 'Home', 'Dashboard');
    const kids = out.children as LayoutLayer[];
    expect(kids[0].children).toBe('Dashboard');
    expect(kids[1].children).toBe('Typed words');
    expect(kids[2].props.title).toBe('Dashboard');
    expect(((kids[2].children as LayoutLayer[])[0]).props.title).toBe('Dashboard');
    expect(kids[3].children).toBe('Home');
  });
  it('returns the same layout when nothing equals the old title or the title did not change', () => {
    const root = tree();
    expect(followTitle(root, 'Other', 'Dashboard')).toBe(root);
    expect(followTitle(root, 'Home', 'Home')).toBe(root);
  });
});
