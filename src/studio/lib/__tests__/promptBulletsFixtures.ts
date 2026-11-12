// The seed specs of DESIGN-phase16.md 1.6, built by hand the way scripts/lib/fakeDescribeAnswers.js builds them.
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import type { AppSpec, LayoutLayer, Page, Source, Table } from '@local-app-studio/runtime/spec/schema';

type Field = Table['fields'][number];

export const crewRosterSpec = (): AppSpec => structuredClone(crewRoster) as unknown as AppSpec;

/** A page body like pageLayer: a Section with a Heading and a Table of records on the list, else a Button. */
function page(id: string, title: string, route: string, list: string | null, table: string | null): Page {
  const sources: Source[] = list === null || table === null ? [] : [{ id: list, table, mode: 'list', where: [], orderBy: [], limit: 50 }];
  const body: LayoutLayer[] = [{ id: `h_${id}`, type: 'Heading', props: {}, children: title }];
  if (list !== null) body.push({ id: `t_${id}`, type: 'DataTable', props: { source: list }, children: [] });
  else body.push({ id: `b_${id}`, type: 'Button', props: {}, children: 'Home' });
  const section: LayoutLayer = { id: `s_${id}`, type: 'Section', props: { title }, children: body };
  return { id, title, route, sources, layout: { id: `root_${id}`, type: 'Page', props: {}, children: [section] } };
}

const text = (id: string, label: string, required = false): Field => ({ id, label, type: 'text', required });
const date = (id: string, label: string): Field => ({ id, label, type: 'date', required: false });
const link = (id: string, label: string, table: string): Field => ({ id, label, type: 'reference', required: false, table });
const choice = (id: string, label: string, options: string[]): Field => ({ id, label, type: 'select', required: false, options });
const table = (id: string, label: string, fields: Field[]): Table => ({ id, label, titleField: 'name', fields });

function shell(name: string, tables: Table[], pages: Page[], nav: AppSpec['nav']): AppSpec {
  return {
    ...crewRosterSpec(),
    app: { name, slug: 'seed', identifier: 'com.example.seed', version: '1.0.0', description: '', icon: null },
    tables,
    pages,
    nav,
    theme: { preset: 'aurora', radius: 'md' },
  };
}

export const tasksSpec = (): AppSpec =>
  shell(
    'Team tasks',
    [
      table('projects', 'Projects', [text('name', 'Name', true), choice('status', 'Status', ['Planned', 'Active', 'Done'])]),
      table('tasks', 'Tasks', [
        text('name', 'Name', true),
        link('project', 'Project', 'projects'),
        { id: 'done', label: 'Done', type: 'boolean', required: false },
        date('due', 'Due'),
      ]),
    ],
    [page('home', 'Open tasks', '/', 'open_tasks', 'tasks'), page('projects', 'Projects', '/projects', 'all_projects', 'projects')],
    [
      { pageId: 'home', label: 'Open tasks', icon: 'home' },
      { pageId: 'projects', label: 'Projects', icon: 'folder' },
    ],
  );

export const loansSpec = (): AppSpec =>
  shell(
    'Tool loans',
    [
      table('things', 'Items', [text('name', 'Name', true), text('serial_number', 'Serial number'), choice('condition', 'Condition', ['Good', 'Fair', 'Needs repair'])]),
      table('people', 'People', [text('name', 'Name', true), text('phone', 'Phone')]),
      table('loans', 'Loans', [
        text('name', 'Name', true),
        link('item', 'Item', 'things'),
        link('person', 'Person', 'people'),
        date('date_out', 'Date out'),
        date('due_date', 'Due date'),
        { id: 'returned', label: 'Returned', type: 'boolean', required: false },
      ]),
    ],
    [
      page('home', 'Open loans', '/', 'open_loans', 'loans'),
      page('things', 'Items', '/things', 'all_things', 'things'),
      page('people', 'People', '/people', 'all_people', 'people'),
      page('loan', 'Loan', '/loans/:id', null, null),
    ],
    [
      { pageId: 'home', label: 'Open loans', icon: 'home' },
      { pageId: 'things', label: 'Items', icon: 'box' },
      { pageId: 'people', label: 'People', icon: 'users' },
    ],
  );
