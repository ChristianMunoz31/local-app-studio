import { describe, expect, it } from 'vitest';
import { exampleCtx, exampleSpec } from '@/catalog/__tests__/fixtures';
import { expandFeature } from '@/catalog/features';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { withOwnWords } from '../featureWords';
import { boardDef, boardLibrary } from './boardFeature';

const checked = validateAppSpec(exampleSpec());
if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
const spec: AppSpec = checked.value;
const ctx = exampleCtx();
const crews = { things: 'crews', things_list: 'open_crews', status: 'status', title_field: 'name', board_title: 'Status board' };
const tasks = { things: 'tasks', things_list: 'open_tasks', status: 'done', title_field: 'title', board_title: 'Status board' };

const find = (root: LayoutLayer, id: string): LayoutLayer => {
  const stack = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    if (l.id === id) return l;
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  throw new Error(id);
};

describe('withOwnWords (P17-13, the feature half)', () => {
  it('rewrites the words the builder made for its own table and field to the words for the chosen ones', () => {
    const words = withOwnWords(boardDef(), crews, ctx, spec).def;
    expect(find(words.fragment, 'ch').props.title).toBe('Crews by Status');
    expect(find(words.fragment, 'qa').props.placeholder).toBe('Add to Crews');
    expect(find(words.fragment, 'cnt').props.label).toBe('Count of Crews');
    // The group field follows too: a table whose field is Done reads "Tasks by Done".
    expect(find(withOwnWords(boardDef(), tasks, ctx, spec).def.fragment, 'ch').props.title).toBe('Tasks by Done');
    expect(find(withOwnWords(boardDef(), tasks, ctx, spec).def.fragment, 'qa').props.placeholder).toBe('Add to Tasks');
  });

  it('leaves words the person wrote in the builder alone, and the saved feature itself unchanged', () => {
    const def = boardDef();
    const typed: LayoutLayer = { ...def.fragment, children: (def.fragment.children as LayoutLayer[]).map((c) => (c.id === 'qa' ? { ...c, props: { ...c.props, placeholder: 'New task name' } } : c)) };
    const words = withOwnWords({ ...def, fragment: typed }, crews, ctx, spec).def;
    expect(find(words.fragment, 'qa').props.placeholder).toBe('New task name');
    expect(find(words.fragment, 'ch').props.title).toBe('Crews by Status');
    expect(find(def.fragment, 'ch').props.title).toBe('Things to track by Status');
  });

  it('keeps the words of a setting people fill in, and follows the builder default only while the setting still holds it', () => {
    const def = boardDef(2, true);
    const typed = withOwnWords(def, { ...crews, chart_title: 'Crew mix' }, ctx, spec);
    expect(typed.values.chart_title).toBe('Crew mix');
    const placed = expandFeature(typed.def, typed.values, ctx, boardLibrary(def), { rootId: 'board_1' });
    if (!placed.ok) throw new Error(JSON.stringify(placed.issues));
    expect((placed.value.children as LayoutLayer[]).find((c) => c.type === 'Chart')?.props.title).toBe('Crew mix');
    // The setting still holds the builder's own words: it follows the table and field chosen.
    expect(withOwnWords(def, { ...tasks, chart_title: 'Things to track by Status' }, ctx, spec).values.chart_title).toBe('Tasks by Done');
  });

  it('returns the same definition when no words are the builder\'s', () => {
    const def = { ...boardDef(), fragment: { ...boardDef().fragment, children: [] } };
    expect(withOwnWords(def, crews, ctx, spec).def).toBe(def);
  });
});

describe('withOwnWords identity (phase 17 round 2, L7)', () => {
  it('returns the very same values object when nothing changed', () => {
    const def = { ...boardDef(), fragment: { ...boardDef().fragment, children: [] } };
    const values = { ...crews };
    expect(withOwnWords(def, values, ctx, spec).values).toBe(values);
  });
});
