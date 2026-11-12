// Connecting data from Design, part 2: a Checklist on a table without a yes or no field says so and offers Add a field; adding "Done"
// connects it, Preview ticks it and the tick persists. Then Change table (the badge on a part) between two tables.
// Nothing leaves this computer. Studio API calls (estimate): about 100 (page loads and their status polls, one create, two saves
// and their reads, the Preview start, one data write and its reads), well under the 300 per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { preview } from '../pages/preview.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const APP = 'Task Board';

async function appRecord(page) {
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  const id = list.find((a) => a.name === APP).id;
  return (await (await page.request.get(`/api/studio/apps/${id}`)).json()).data;
}

test('a Checklist with no yes or no field to use offers Add a field; adding Done connects it and Save keeps it', async ({ page }) => {
  const created = await page.request.post('/api/studio/apps', { data: { name: APP } });
  expect(created.status()).toBe(201);
  const record = (await created.json()).data;
  const spec = record.spec;
  spec.tables = [
    { id: 'tasks', label: 'Tasks', titleField: 'title', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] },
    {
      id: 'crews',
      label: 'Crews',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'size', label: 'Size', type: 'integer', required: false },
      ],
    },
  ];
  spec.pages[0].sources = [{ id: 'all_tasks', table: 'tasks', mode: 'list' }];
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);

  const d = design(page);
  await d.open(APP);
  await d.addAt('Add here: Page, place 2', 'Checklist');
  await expect(d.notConnected('checklist_1')).toContainText('Needs a yes or no field');
  await expect(d.notConnected('checklist_1').getByRole('button', { name: 'Add a field for Checklist' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await d.addField('checklist_1', 'Done', 'Tasks');
  await expect(visibleNotice(page, 'Added the field Done to Tasks.')).toBeVisible();
  await expect(d.badge('checklist_1')).toHaveAccessibleName('Connected to Tasks. Change table');
  await d.save();

  const saved = (await appRecord(page)).spec;
  expect(saved.tables.find((t) => t.id === 'tasks').fields.map((f) => [f.label, f.type])).toEqual([
    ['Title', 'text'],
    ['Done', 'boolean'],
  ]);
  const checklist = saved.pages[0].layout.children.find((c) => c.type === 'Checklist');
  expect(checklist.props).toMatchObject({ source: 'all_tasks', field: 'done' });
  expect(ctx.server.outbound()).toEqual([]);
});

test('Preview ticks the task and the tick is still there after a reload', async ({ page, request, baseURL }) => {
  const p = preview(page);
  const scope = await p.open(APP);
  await expect(scope.getByText('Nothing to check off.')).toBeVisible();

  const made = await request.post(`${baseURL}/api/preview/data/tasks`, { data: { title: 'Write report' } });
  expect(made.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });

  const box = scope.getByRole('checkbox', { name: 'Write report' });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();

  await page.reload();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(scope.getByRole('checkbox', { name: 'Write report' })).toBeChecked();
  expect(ctx.server.outbound()).toEqual([]);
});

test('Change table: the badge of a Table of records switches it between two tables and back, and Save keeps the last one', async ({ page }) => {
  const d = design(page);
  await d.open(APP);
  await d.addAt('Add here: Page, place 3', 'Table of records');
  // P17-14: the page lists a table and the app has others, so the new part asks which table (the page's table first) and Studio waits for the answer.
  const asked = page.getByRole('dialog', { name: 'Settings for Table of records' });
  await expect(asked.getByLabel('Table', { exact: true })).toBeVisible();
  await asked.getByLabel('Table', { exact: true }).selectOption({ label: 'Tasks' });
  await expect(d.badge('datatable_1').first()).toHaveAccessibleName('Connected to Tasks. Change table');

  let dialog = await d.changeTable('datatable_1', 'Table of records');
  await expect(dialog.getByLabel('Table', { exact: true })).toBeFocused();
  await d.pickInSettings(dialog, 'Table', 'Crews');
  await expect(dialog).toHaveCount(0);
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Crews. Change table');

  dialog = await d.changeTable('datatable_1', 'Table of records');
  await d.pickInSettings(dialog, 'Table', 'Tasks');
  await expect(dialog).toHaveCount(0);
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Tasks. Change table');
  await d.save();

  const saved = (await appRecord(page)).spec;
  const table = saved.pages[0].layout.children.find((c) => c.type === 'DataTable');
  expect(table.props.source).toBe('all_tasks');
  expect(saved.pages[0].sources.find((s) => s.id === 'all_tasks')).toMatchObject({ table: 'tasks', mode: 'list' });
  expect(ctx.server.outbound()).toEqual([]);
});
