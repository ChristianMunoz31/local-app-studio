// Shared spec for the bind-on-drop tests: the phase 10 audit app (Crew Audit). Tables people, crews, tasks; pages home
// (sources all_crews, all_tasks), crew at /crews/:id (record source one_crew), other (crews_list), blank (no source).
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, AppSpecInput } from '@local-app-studio/runtime/spec/schema';
import type { DraftPage, Source } from '../bindOnDrop';

const ROOT = { id: 'root', type: 'Page', props: {}, children: [] };
const list = (id: string, table: string): Source => ({ id, table, mode: 'list', where: [], orderBy: [], limit: 50 });

export function auditInput(): AppSpecInput {
  return {
    specVersion: 1,
    app: { name: 'Crew Audit', slug: 'crew-audit', identifier: 'com.example.crewaudit', version: '1.0.0', description: 'Audit', icon: 'users' },
    tables: [
      { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
      {
        id: 'crews',
        label: 'Crews',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'size', label: 'Size', type: 'integer' },
          { id: 'status', label: 'Status', type: 'select', options: ['open', 'closed'] },
          { id: 'lead_id', label: 'Lead', type: 'reference', table: 'people' },
        ],
      },
      {
        id: 'tasks',
        label: 'Tasks',
        titleField: 'title',
        fields: [
          { id: 'title', label: 'Title', type: 'text', required: true },
          { id: 'done', label: 'Done', type: 'boolean' },
          { id: 'due', label: 'Due', type: 'date' },
          { id: 'crew_id', label: 'Crew', type: 'reference', table: 'crews' },
        ],
      },
    ],
    pages: [
      { id: 'home', title: 'Home', route: '/', sources: [list('all_crews', 'crews'), list('all_tasks', 'tasks')], layout: ROOT },
      { id: 'crew', title: 'Crew', route: '/crews/:id', sources: [{ id: 'one_crew', table: 'crews', mode: 'record' }], layout: ROOT },
      { id: 'other', title: 'Other', route: '/other', sources: [list('crews_list', 'crews')], layout: ROOT },
      { id: 'blank', title: 'Blank', route: '/blank', sources: [], layout: ROOT },
    ],
    nav: [{ pageId: 'home', label: 'Home', icon: 'home' }],
    theme: { preset: 'aurora', radius: 'md' },
  } as AppSpecInput;
}

export function specOf(edit: (input: AppSpecInput) => void = () => {}): AppSpec {
  const input = auditInput();
  edit(input);
  const result = validateAppSpec(input);
  if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  return result.value;
}

export const pageOf = (spec: AppSpec, id: string): DraftPage => {
  const p = spec.pages.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no page ${id}`);
  return { id: p.id, title: p.title, route: p.route, sources: p.sources };
};
