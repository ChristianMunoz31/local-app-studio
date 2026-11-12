// Enhancement proofs on the Design step (DESIGN-phase14.md): P-20 and P-21 (one word "Table" for one thing, and Studio says when it connects a
// part by itself), P-23 (every change says what it did, Ctrl+Z says "Undid: ..." with Redo) and P-26 (Add a page asks "What kind of page?").
// Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const textField = { id: 'name', label: 'Name', type: 'text', required: true };
const heading = { id: 'h_home', type: 'Heading', props: { size: 'lg' }, children: 'Equipment loans' };
const TABLES = [
  { id: 'equipment', label: 'Items', titleField: 'name', fields: [textField] },
  { id: 'people', label: 'People', titleField: 'name', fields: [textField] },
  {
    id: 'loans',
    label: 'Loans',
    titleField: 'name',
    fields: [
      textField,
      { id: 'item', label: 'Item', type: 'reference', table: 'equipment' },
      { id: 'person', label: 'Person', type: 'reference', table: 'people' },
    ],
  },
];

/** A blank app made through the Studio API and given tables and a Home page with one heading. */
async function makeApp(page, name, tables) {
  const created = await page.request.post('/api/studio/apps', { data: { name } });
  expect(created.status()).toBe(201);
  const record = (await created.json()).data;
  const spec = record.spec;
  spec.tables = tables;
  spec.pages = [{ id: 'home', route: '/', title: 'Home', sources: [], layout: { id: 'root', type: 'Page', props: {}, children: [heading] } }];
  spec.nav = [{ pageId: 'home', label: 'Home', icon: 'home' }];
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);
  return record.id;
}

const ids = {};

test('setup: an app with three tables and one with a single table', async ({ page }) => {
  ids.three = await makeApp(page, 'Shop Three', TABLES);
  ids.one = await makeApp(page, 'Shop One', [TABLES[1]]);
});

test('P-20: the chooser of a Table of records says Table, and the pill reads "Connected to <T>"', async ({ page }) => {
  await page.goto(`/apps/${ids.three}/design`);
  const d = design(page);
  await expect(d.canvas).toBeVisible();
  await page.getByRole('button', { name: 'Add Table of records' }).click();

  const dialog = page.getByRole('dialog', { name: 'Settings for Table of records' });
  await expect(dialog).toBeVisible();
  // One word for one thing: "Table", as on a Form. No "List" and no "New list of".
  const chooser = dialog.getByLabel('Table', { exact: true });
  await expect(chooser).toBeVisible();
  await expect(dialog.getByLabel('List', { exact: true })).toHaveCount(0);
  const options = await chooser.locator('option').allInnerTexts();
  expect(options.join(' | ')).not.toMatch(/New list of|\(list\)/);

  await chooser.selectOption({ label: 'Loans' });
  await expect(visibleNotice(page, 'Connected to Loans.')).toBeVisible();
  await expect(page.locator('[data-connection-badge]').first()).toContainText('Connected to Loans');
  await expect(page.locator('[data-connection-badge]').first()).not.toContainText('Table:');
  expect(ctx.server.outbound()).toEqual([]);
});

test('P-21: when Studio connects a part by itself the line says "Connected the Form to People."', async ({ page }) => {
  await page.goto(`/apps/${ids.one}/design`);
  await expect(design(page).canvas).toBeVisible();
  await page.getByRole('button', { name: 'Add Form' }).click();
  await expect(visibleNotice(page, 'Connected the Form to People.')).toBeVisible();
  await expect(page.locator('[data-connection-badge]').first()).toContainText('Connected to People');
});

test('P-23: Design add says "Added <part> after <part>.", Ctrl+Z says "Undid: ..." with Redo, Redo says "Redid: ..." with Undo', async ({ page }) => {
  await page.goto(`/apps/${ids.one}/design`);
  await expect(design(page).canvas).toBeVisible();

  await page.getByRole('button', { name: 'Add Divider' }).click();
  const added = visibleNotice(page, 'Added Divider line after Heading.');
  await expect(added).toBeVisible();
  await expect(added.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();

  // A second add names the part it went after.
  await page.getByRole('button', { name: 'Add Button' }).click();
  await expect(visibleNotice(page, /^Added Button after /)).toBeVisible();

  await page.keyboard.press('Control+z');
  const undid = visibleNotice(page, /^Undid: added Button after /);
  await expect(undid).toBeVisible();
  await expect(undid.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();

  await undid.getByRole('button', { name: 'Redo', exact: true }).click();
  const redid = visibleNotice(page, /^Redid: /);
  await expect(redid).toBeVisible();
  await expect(redid.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
});

test('P-26: Add a page asks "What kind of page?" and a record page shows one record of a table', async ({ page }) => {
  await page.goto(`/apps/${ids.three}/design`);
  const d = design(page);
  await expect(d.canvas).toBeVisible();
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Add a page' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add a page' });
  await expect(dialog.getByText('What kind of page?')).toBeVisible();
  await expect(dialog.getByText('A page of parts')).toBeVisible();
  const record = dialog.getByText('A page that shows one record from a table');
  await expect(record).toBeVisible();

  await record.click();
  await dialog.getByRole('combobox').selectOption({ label: 'People' });
  await expect(dialog.getByLabel('Page title')).toHaveValue('People');
  await dialog.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // The new page is open, titled with the table name, and carries Record details.
  await expect(d.page()).toHaveValue(/.+/);
  await expect(d.page().locator('option:checked')).toHaveText('People (opens from a list)');
  // Adding a page keeps it at once: the saved app has it.
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  const spec = (await (await page.request.get(`/api/studio/apps/${ids.three}`)).json()).data.spec;
  const made = spec.pages.find((p) => p.title === 'People');
  expect(made, 'the record page was saved').toBeTruthy();
  expect(made.route).toMatch(/:id$/);
  expect(spec.nav.some((n) => n.pageId === made.id), 'a record page stays out of the menu').toBe(false);
  expect(JSON.stringify(made.layout)).toContain('"type":"RecordDetail"');
  expect(ctx.server.outbound()).toEqual([]);
});
