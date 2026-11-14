// Set-up helpers for the phase 31 part flows (e2e/flows/boardParts.spec.js) and the a11y "parts" shard:
// a small synthetic app (crews with a status and one rule, people, and a record page for each) with ONE of the three parts on its home
// page, made through the Studio API, and a Preview opened on it with synthetic rows. Nothing here needs the helper, so it runs in both builds.
import { expect } from './fixtures.js';

export const PART_APPS = {
  kanban: { name: 'Board Kanban', slug: 'board-kanban' },
  search: { name: 'Board Search', slug: 'board-search' },
  table: { name: 'Board Table', slug: 'board-table' },
};

/** Synthetic rows. Alpha and Alpine both match "alp"; Alpina Reed is the one person that does. */
export const CREWS = [
  { name: 'Alpha', size: 4, status: 'todo' },
  { name: 'Bravo', size: 2, status: 'doing' },
  { name: 'Alpine', size: 3, status: 'todo' },
];
export const PEOPLE = [{ name: 'Alpina Reed' }, { name: 'Casey Stone' }];

const PART_LAYERS = {
  kanban: [{ id: 'board', type: 'Kanban', props: { source: 'all_crews', field: 'status', titleField: 'name' }, children: [] }],
  search: [{ id: 'find', type: 'GlobalSearch', props: { placeholder: 'Search the board' }, children: [] }],
  table: [{ id: 'grid', type: 'DataTable', props: { source: 'all_crews', columns: ['name', 'size', 'status', 'closed_on'], edit: 'cells' }, children: [] }],
};

/** The spec: Status becoming done sets Closed on to today (ADR-013); a record page for each table so a search hit has a page to open. */
export function boardSpec(part) {
  const meta = PART_APPS[part];
  return {
    specVersion: 1,
    app: { name: meta.name, slug: meta.slug, identifier: `com.example.${meta.slug.replace(/-/g, '')}`, version: '1.0.0', description: 'Crews on a board', icon: 'users' },
    tables: [
      { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
      {
        id: 'crews',
        label: 'Crews',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'size', label: 'Size', type: 'integer', default: 1 },
          { id: 'status', label: 'Status', type: 'select', options: ['todo', 'doing', 'done'], default: 'todo' },
          { id: 'closed_on', label: 'Closed on', type: 'date' },
        ],
        rules: [{ when: { field: 'status', is: 'done' }, then: [{ set: 'closed_on', to: 'today' }] }],
      },
    ],
    pages: [
      {
        id: 'home',
        title: 'Home',
        route: '/',
        sources: [{ id: 'all_crews', table: 'crews', orderBy: [{ field: 'name', dir: 'asc' }], limit: 50 }],
        layout: { id: 'root', type: 'Page', props: {}, children: [{ id: 'h1', type: 'Heading', props: { size: 'lg' }, children: 'The board' }, ...PART_LAYERS[part]] },
      },
      {
        id: 'crew',
        title: 'One crew',
        route: '/crews/:id',
        sources: [{ id: 'one_crew', table: 'crews', mode: 'record' }],
        layout: { id: 'root', type: 'Page', props: {}, children: [{ id: 'crew_detail', type: 'RecordDetail', props: { source: 'one_crew' }, children: [] }] },
      },
      {
        id: 'person',
        title: 'One person',
        route: '/people/:id',
        sources: [{ id: 'one_person', table: 'people', mode: 'record' }],
        layout: { id: 'root', type: 'Page', props: {}, children: [{ id: 'person_detail', type: 'RecordDetail', props: { source: 'one_person' }, children: [] }] },
      },
    ],
    nav: [{ pageId: 'home', label: 'Home', icon: 'home' }],
    theme: { preset: 'aurora', radius: 'md' },
  };
}

/** The id of the app of `part`, imported through the Studio API when this server does not have it yet. */
export async function ensureBoardApp(request, part) {
  const listed = (await (await request.get('/api/studio/apps')).json()).data;
  const found = listed.find((a) => a.name === PART_APPS[part].name);
  if (found) return found.id;
  const res = await request.post('/api/studio/apps/import', { data: { spec: boardSpec(part) } });
  expect(res.status()).toBe(201);
  return (await res.json()).data.id;
}

/**
 * Opens Preview of the app of `part` with the synthetic rows in it (added once, when the table is empty) and waits for the running app
 * (the Preview child needs a start before it takes rows, then a reload shows them). Returns the Preview scope.
 */
export async function openBoardPreview(page, part) {
  const id = await ensureBoardApp(page.request, part);
  await page.goto(`/apps/${id}/preview`);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const have = (await (await page.request.get('/api/preview/data/crews?limit=5')).json()).data.rows.length;
  if (have === 0) {
    for (const row of PEOPLE) expect((await page.request.post('/api/preview/data/people', { data: row })).status()).toBe(201);
    for (const row of CREWS) expect((await page.request.post('/api/preview/data/crews', { data: row })).status()).toBe(201);
    await page.reload();
    await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  }
  const scope = page.getByTestId('preview-theme-scope');
  await expect(scope).toBeVisible();
  return scope;
}

/** The crews as the Preview data holds them, by name. */
export async function crewsByName(request) {
  const rows = (await (await request.get('/api/preview/data/crews?limit=50')).json()).data.rows;
  return Object.fromEntries(rows.map((r) => [r.name, r]));
}
