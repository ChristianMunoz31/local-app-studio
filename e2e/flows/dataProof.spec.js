// The data proof: two tables with a reference between them, a QuickAdd and a DataTable dropped on one page and a Number tile and a
// Chart on another, each showing its connection badge. Save, open Preview, add two records through the QuickAdd, reload, and see both
// rows in the table, the count 2 and two Chart groups. Then the Preview app.db on disk holds the two rows, they survive Stop and Start,
// and Reset preview data empties them. The app (tables, pages, sources) is made through the Studio API like the other flows; every part is
// dropped on the Design canvas with Add here. Nothing leaves this computer.
import { DatabaseSync } from 'node:sqlite';
import { test, expect, useApp } from '../support/fixtures.js';
import { design } from '../pages/design.js';
import { preview } from '../pages/preview.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const APP = 'Crew Ledger';
const heading = (id, text) => ({ id, type: 'Heading', props: { size: 'lg' }, children: text });

async function appRecord(page) {
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  const id = list.find((a) => a.name === APP).id;
  return (await (await page.request.get(`/api/studio/apps/${id}`)).json()).data;
}

/** A new data part on a page that lists a table asks which table: answer it in the part's settings. */
async function chooseTable(page, part, table) {
  const dialog = page.getByRole('dialog', { name: `Settings for ${part}`, exact: true });
  await expect(dialog.getByLabel('Table', { exact: true })).toBeVisible();
  await dialog.getByLabel('Table', { exact: true }).selectOption({ label: table });
}

/** Every row of `crews` read straight from the Preview database file (read only). */
function crewRowsOnDisk(appId) {
  const db = new DatabaseSync(ctx.server.previewDbFile(appId), { readOnly: true });
  try {
    return db
      .prepare('SELECT name, status FROM crews ORDER BY name')
      .all()
      .map((r) => ({ ...r }));
  } finally {
    db.close();
  }
}

test('two tables with a reference, a QuickAdd and a table on one page, a number tile and a chart on another: each shows its table and Save keeps them', async ({ page }) => {
  const created = await page.request.post('/api/studio/apps', { data: { name: APP } });
  expect(created.status()).toBe(201);
  const record = (await created.json()).data;
  const spec = record.spec;
  spec.tables = [
    { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
    {
      id: 'crews',
      label: 'Crews',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'status', label: 'Status', type: 'select', options: ['open', 'closed'], default: 'open' },
        { id: 'lead_id', label: 'Lead', type: 'reference', table: 'people' },
      ],
    },
  ];
  spec.pages = [
    { id: 'crews', route: '/', title: 'Crews', sources: [{ id: 'all_crews', table: 'crews', mode: 'list' }], layout: { id: 'root', type: 'Page', props: {}, children: [heading('h_crews', 'Crews')] } },
    { id: 'stats', route: '/stats', title: 'Stats', sources: [{ id: 'crew_stats', table: 'crews', mode: 'list' }], layout: { id: 'root', type: 'Page', props: {}, children: [heading('h_stats', 'Numbers')] } },
  ];
  spec.nav = [
    { pageId: 'crews', label: 'Crews', icon: 'home' },
    { pageId: 'stats', label: 'Stats', icon: 'home' },
  ];
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);

  const d = design(page);
  await d.open(APP);
  await d.page().selectOption({ label: 'Crews' });
  // P17-14: each page already lists Crews and the app has more tables, so each new data part asks which table before it connects.
  await d.addAt('Add here: Page, place 2', 'Quick add');
  await chooseTable(page, 'Quick add', 'Crews');
  await d.addAt('Add here: Page, place 3', 'Table of records');
  await chooseTable(page, 'Table of records', 'Crews');
  await expect(page.locator('[data-connection-badge]')).toHaveText(['Connected to Crews', 'Connected to Crews']);
  for (const badge of await page.locator('[data-connection-badge]').all()) await expect(badge).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(d.connections()).toHaveCount(0);
  await d.save();

  await d.page().selectOption({ label: 'Stats' });
  await d.addAt('Add here: Page, place 2', 'Number tile');
  await chooseTable(page, 'Number tile', 'Crews');
  // Only Crews has a field a Chart can group by, so the Chart connects itself.
  await d.addAt('Add here: Page, place 3', 'Chart');
  await expect(page.locator('[data-connection-badge]')).toHaveText(['Connected to Crews', 'Connected to Crews']);
  for (const badge of await page.locator('[data-connection-badge]').all()) await expect(badge).toHaveAccessibleName('Connected to Crews. Change table');
  await d.save();

  const saved = (await appRecord(page)).spec;
  const typesOf = (id) => saved.pages.find((p) => p.id === id).layout.children.map((c) => c.type);
  expect(typesOf('crews')).toEqual(['Heading', 'QuickAdd', 'DataTable']);
  expect(typesOf('stats')).toEqual(['Heading', 'StatCard', 'Chart']);
  expect(saved.pages[0].layout.children[1].props).toMatchObject({ table: 'crews', field: 'name' });
  expect(saved.pages[0].layout.children[2].props.source).toBe('all_crews');
  expect(saved.pages[1].layout.children[1].props).toMatchObject({ source: 'crew_stats', stat: 'count' });
  expect(saved.pages[1].layout.children[2].props).toMatchObject({ source: 'crew_stats', groupBy: 'status' });
  expect(ctx.server.outbound()).toEqual([]);
});

test('Preview shows the data banner; two QuickAdd records show in the table, the count is 2 and the chart has two groups; the rows are in app.db', async ({
  page,
  request,
  baseURL,
}) => {
  const p = preview(page);
  const scope = await p.open(APP);
  await expect(p.banner()).toContainText('Preview data stays on this computer, apart from any app you build.');
  await expect(page.getByRole('button', { name: 'Reset preview data', exact: true })).toBeVisible();

  for (const name of ['Alpha crew', 'Beta crew']) {
    await scope.getByPlaceholder('Add to Crews').fill(name);
    await scope.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(scope.getByText(name).first()).toBeVisible();
  }

  // QuickAdd fills one text field, so both rows are "open"; the second one is closed through the Preview data route to get two groups.
  const list = await (await request.get(`${baseURL}/api/preview/data/crews?sort=name:asc`)).json();
  const rows = list.data.rows ?? list.data;
  expect(rows.map((r) => r.name)).toEqual(['Alpha crew', 'Beta crew']);
  const patched = await request.patch(`${baseURL}/api/preview/data/crews/${rows[1].id}`, { data: { status: 'closed' } });
  expect(patched.status()).toBe(200);

  await page.reload();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const table = scope.getByRole('table').first();
  await expect(table.getByText('Alpha crew')).toBeVisible();
  await expect(table.getByText('Beta crew')).toBeVisible();

  const appId = (await appRecord(page)).id;
  // The app has no menu bar, so the second page is opened by its route under the Preview base path.
  await page.goto(`/apps/${appId}/preview/stats`);
  await expect(scope).toBeVisible();
  // The Number tile's label is "Count of Crews"; its value is the row count.
  await expect(scope.getByText('Count of Crews', { exact: true }).locator('xpath=../..')).toHaveText(/^Count of Crews\s*2$/);
  const figure = scope.getByRole('figure');
  await expect(figure.getByRole('row').filter({ hasText: /^open\s*1$/ })).toHaveCount(1);
  await expect(figure.getByRole('row').filter({ hasText: /^closed\s*1$/ })).toHaveCount(1);

  expect(crewRowsOnDisk(appId)).toEqual([
    { name: 'Alpha crew', status: 'open' },
    { name: 'Beta crew', status: 'closed' },
  ]);
  expect(ctx.server.outbound()).toEqual([]);
});

test('the rows are still there after Stop and Start, and Reset preview data empties them', async ({ page }) => {
  const p = preview(page);
  const appId = (await appRecord(page)).id;
  const scope = await p.open(APP);
  await p.stop();
  expect(crewRowsOnDisk(appId)).toHaveLength(2);
  await p.start();
  await expect(scope.getByText('Alpha crew').first()).toBeVisible();
  await expect(scope.getByText('Beta crew').first()).toBeVisible();
  expect(crewRowsOnDisk(appId).map((r) => r.name)).toEqual(['Alpha crew', 'Beta crew']);

  await p.reset();
  await expect(p.note()).toHaveText('Preview data was reset.');
  await expect(scope.getByText('Alpha crew')).toHaveCount(0);
  await expect(scope.getByText('Beta crew')).toHaveCount(0);
  expect(crewRowsOnDisk(appId)).toEqual([]);
  expect(ctx.server.outbound()).toEqual([]);
});
