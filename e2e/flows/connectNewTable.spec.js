// Connecting data from Design, part 1: a plain blank app, a Table of records dragged onto the page (a real drag, read aloud in plain
// words), New table "Crews" with a "Status" choice field made right on the part, a Quick add put beside it, Save, the table in the
// Data step, and the Preview: the empty table, a record added with the Quick add, and the row still there after a reload.
// Nothing leaves this computer. Studio API calls (estimate): about 90 (page loads and their status polls, one create, three saves
// of the spec reads, the Preview start and its data calls), well under the 300 per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { preview } from '../pages/preview.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const APP = 'Crew Board';

async function appRecord(page) {
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  const id = list.find((a) => a.name === APP).id;
  return (await (await page.request.get(`/api/studio/apps/${id}`)).json()).data;
}

test('a Table of records dragged onto a blank app offers New table; making Crews with a Status choice connects it, a Quick add goes beside it, and Save keeps them', async ({ page }) => {
  const created = await page.request.post('/api/studio/apps', { data: { name: APP } });
  expect(created.status()).toBe(201);

  const d = design(page);
  await d.open(APP);
  await d.dragTile('DataTable', 'root_home:1');

  // The screen reader hears the part and the place in plain words, never dnd-kit's ids.
  await expect(d.liveRegion()).toContainText('Dropped Table of records at Page, place 2');
  await expect(d.liveRegion()).not.toContainText('Draggable item');
  await expect(d.liveRegion()).not.toContainText('palette:part');

  await expect(d.notConnected('datatable_1')).toContainText('This app has no table yet.');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await d.newTable('datatable_1', 'Crews', [{ label: 'Status', type: 'Choice', choices: ['Open', 'Closed'] }]);
  await expect(visibleNotice(page, 'Made the table Crews and added a list of Crews to this page.')).toBeVisible();
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(d.notConnected('datatable_1')).toHaveCount(0);

  // A Quick add beside it adds to the same table.
  await d.named('Table of records').focus();
  await page.getByRole('button', { name: 'Put a part beside Table of records' }).click();
  await page.getByRole('button', { name: 'Add Quick add' }).click();
  await expect(d.badge('quickadd_1')).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Crews. Change table');

  await d.save();

  const saved = (await appRecord(page)).spec;
  expect(saved.tables).toHaveLength(1);
  expect(saved.tables[0]).toMatchObject({ id: 'crews', label: 'Crews' });
  expect(saved.tables[0].fields.map((f) => f.label)).toEqual(['Name', 'Status']);
  expect(saved.tables[0].fields[1]).toMatchObject({ type: 'select', options: ['Open', 'Closed'] });
  expect(saved.pages[0].sources).toEqual([expect.objectContaining({ table: 'crews', mode: 'list' })]);
  const types = saved.pages[0].layout.children.map((c) => c.type);
  expect(types).toContain('DataTable');
  expect(types).toContain('QuickAdd');
  expect(ctx.server.outbound()).toEqual([]);
});

test('the Data step lists Crews with 2 fields', async ({ page }) => {
  const d = design(page);
  await d.open(APP);
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Data/ }).click();
  await expect(page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: /Crews/ })).toContainText('2 fields');
});

test('Preview shows the empty table, a record added with the Quick add shows with both columns, and it is still there after a reload', async ({ page }) => {
  const p = preview(page);
  const scope = await p.open(APP);
  await expect(scope.getByText('Nothing here yet.')).toBeVisible();
  const table = scope.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Status']);

  await scope.getByPlaceholder('Add to Crews').fill('Alpha crew');
  await scope.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Status']);
  await expect(table.getByRole('cell', { name: 'Alpha crew' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(scope.getByRole('table').getByRole('cell', { name: 'Alpha crew' })).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});
