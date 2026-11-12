// Connecting data from Design, part 3: Undo and Redo of New table. One Undo takes the table, its list and the connection away
// together (the part is then not connected again and Save says why); Redo brings all three back. Once the table is saved, undoing
// it asks "Save and remove data?" before Save sends anything: Keep editing sends nothing, Save and remove removes the table.
// Nothing leaves this computer. Studio API calls (estimate): about 50 (page loads and their status polls, one create, two saves
// and their reads), well under the 300 per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { design } from '../pages/design.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const APP = 'Undo Board';
const SAVE_HINT = 'Connect the parts that need a table, or delete them, to save.';

async function appRecord(page) {
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  const id = list.find((a) => a.name === APP).id;
  return (await (await page.request.get(`/api/studio/apps/${id}`)).json()).data;
}

test('Undo of New table takes the table, the list and the connection away together; Redo brings them back', async ({ page }) => {
  const created = await page.request.post('/api/studio/apps', { data: { name: APP } });
  expect(created.status()).toBe(201);

  const d = design(page);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await d.open(APP);
  await d.addAt('Add here: Page, place 2', 'Table of records');
  await expect(d.notConnected('datatable_1')).toContainText('This app has no table yet.');

  await d.newTable('datatable_1', 'Crews');
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(save).toBeEnabled();

  // One Undo: the part is not connected again, and Save is off with its reason.
  await d.undo().click();
  await expect(d.notConnected('datatable_1')).toContainText('This app has no table yet.');
  await expect(d.badge('datatable_1')).toHaveCount(0);
  await expect(save).toBeDisabled();
  await expect(page.getByText(SAVE_HINT)).toBeVisible();

  await d.redo().click();
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(d.notConnected('datatable_1')).toHaveCount(0);
  await expect(save).toBeEnabled();

  // Two Undos: the part itself goes too, and the page is as saved.
  await d.undo().click();
  await d.undo().click();
  await expect(d.block('datatable_1')).toHaveCount(0);
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('title', 'No changes to save.');
  expect(ctx.server.outbound()).toEqual([]);
});

test('Undo of a saved table asks Save and remove data?; Keep editing sends nothing, Save and remove removes the table and its list', async ({ page }) => {
  const puts = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/api\/studio\/apps\/[^/]+$/.test(new URL(req.url()).pathname)) puts.push(req.url());
  });

  const d = design(page);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await d.open(APP);
  await d.addAt('Add here: Page, place 2', 'Table of records');
  await d.newTable('datatable_1', 'Crews');
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Crews. Change table');
  await d.save();
  expect(puts).toHaveLength(1);

  const before = (await appRecord(page)).spec;
  expect(before.tables.map((t) => t.id)).toEqual(['crews']);
  expect(before.pages[0].sources).toHaveLength(1);

  // Undo twice (the table, then the part): the page is a blank page again and Save asks first.
  await d.undo().click();
  await d.undo().click();
  await expect(d.block('datatable_1')).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();
  const dialog = page.getByRole('alertdialog', { name: 'Save and remove data?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Removes the table "Crews" and its data.');

  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toHaveCount(0);
  expect(puts).toHaveLength(1);
  expect((await appRecord(page)).spec.tables.map((t) => t.id)).toEqual(['crews']);
  await expect(save).toBeEnabled();

  await save.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Save and remove' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
  await expect(dialog).toHaveCount(0);

  const after = (await appRecord(page)).spec;
  expect(after.tables).toEqual([]);
  expect(after.pages[0].sources).toEqual([]);
  expect(after.pages[0].layout.children.map((c) => c.type)).toEqual(['Heading']);
  expect(ctx.server.outbound()).toEqual([]);
});
