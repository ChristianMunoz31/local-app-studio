// Shared test data: the Crew Roster fixture extended with a record page, and a larger spec for the size targets.
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import type { AppSpecInput, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import type { PartContext } from '../types.ts';
import { partContextFor } from '../validateLayout.ts';

export const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({
  id,
  type,
  props,
  children,
});

export const ROOT_ONLY: LayoutLayer = layer('root', 'Page');

/** Crew Roster plus a page "crew" at /crews/:id with a list source and a record source of the same table. */
export function crewSpec(crewLayout: LayoutLayer = ROOT_ONLY): AppSpecInput {
  const base = crewRoster as AppSpecInput;
  return {
    ...base,
    pages: [
      ...base.pages,
      {
        id: 'crew',
        title: 'Crew',
        route: '/crews/:id',
        sources: [
          { id: 'open_crews', table: 'crews', where: [{ field: 'status', op: 'eq', value: 'active' }], orderBy: [{ field: 'name', dir: 'asc' }], limit: 50 },
          { id: 'one_crew', table: 'crews', mode: 'record' },
        ],
        layout: crewLayout,
      },
    ],
  };
}

/** A table of tasks of a crew: a required text, a yes/no, a date, a whole number and a reference. */
export const TASKS_TABLE: NonNullable<AppSpecInput['tables']>[number] = {
  id: 'tasks',
  label: 'Tasks',
  titleField: 'title',
  fields: [
    { id: 'title', label: 'Title', type: 'text', required: true },
    { id: 'done', label: 'Done', type: 'boolean' },
    { id: 'due', label: 'Due', type: 'date' },
    { id: 'hours', label: 'Hours', type: 'integer' },
    { id: 'crew_id', label: 'Crew', type: 'reference', table: 'crews' },
  ],
};

/** crewSpec() plus the tasks table and a list source "open_tasks" on the "crew" page, so every part example validates. */
export function exampleSpec(crewLayout: LayoutLayer = ROOT_ONLY): AppSpecInput {
  const base = crewSpec(crewLayout);
  return {
    ...base,
    tables: [...(base.tables ?? []), TASKS_TABLE],
    pages: base.pages.map((p) =>
      p.id === 'crew'
        ? { ...p, sources: [...(p.sources ?? []), { id: 'open_tasks', table: 'tasks', where: [{ field: 'done', op: 'eq', value: false }], orderBy: [{ field: 'due', dir: 'asc' }], limit: 50 }] }
        : p,
    ),
  };
}

/** The context of the "crew" page of exampleSpec: crewCtx() plus the tasks table and source. */
export function exampleCtx(): PartContext {
  const spec = exampleSpec();
  return partContextFor(spec, spec.pages[1]);
}

/** The context of the "crew" page: both sources, a record page, pages home and crew. */
export function crewCtx(): PartContext {
  const spec = crewSpec();
  return partContextFor(spec, spec.pages[1]);
}

/** The context of the "home" page of Crew Roster (one list source, not a record page). */
export function homeCtx(): PartContext {
  const spec = crewSpec();
  return partContextFor(spec, spec.pages[0]);
}

/** 10 tables of 6 fields (mixed types, one reference each) and a page with 8 sources, as the size targets name. */
export function bigCtx(): PartContext {
  const tables = Array.from({ length: 10 }, (_, i) => ({
    id: `table_${i}`,
    label: `Table ${i}`,
    titleField: 'name',
    fields: [
      { id: 'name', label: 'Name', type: 'text' as const, required: true },
      { id: 'notes', label: 'Notes', type: 'longtext' as const },
      { id: 'amount', label: 'Amount', type: 'real' as const },
      { id: 'count', label: 'Count', type: 'integer' as const },
      { id: 'status', label: 'Status', type: 'select' as const, options: ['open', 'closed', 'paused'] },
      i === 0 ? { id: 'due', label: 'Due', type: 'date' as const } : { id: 'parent_id', label: 'Parent', type: 'reference' as const, table: 'table_0' },
    ],
  }));
  const sources = Array.from({ length: 8 }, (_, i) => ({
    id: `source_${i}`,
    table: `table_${i}`,
    mode: i === 7 ? ('record' as const) : ('list' as const),
  }));
  const spec: AppSpecInput = {
    specVersion: 1,
    app: { name: 'Big App', slug: 'big-app', identifier: 'com.example.bigapp', version: '1.0.0' },
    tables,
    pages: [
      { id: 'home', title: 'Home', route: '/', layout: ROOT_ONLY },
      { id: 'detail', title: 'Detail', route: '/detail/:id', sources, layout: ROOT_ONLY },
    ],
  };
  return partContextFor(spec, spec.pages[1]);
}
