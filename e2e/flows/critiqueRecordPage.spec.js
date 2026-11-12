// Phase 14 proof flows, record pages and Preview of a hand-built app (DESIGN-phase14.md P-05, P-26, P-06).
//   P-05 and P-26: Add a page "A page that shows one record from a table"; in Preview a row of the Table of records opens that record page.
//   P-06: a Blank app with a saved page and no tables runs in Preview.
// Studio API calls (estimate): about 70, well under the 300 per 15 minutes. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design } from '../pages/design.js';
import { createBlankApp, expectLanding } from '../pages/apps.js';
import { preview } from '../pages/preview.js';
import { CREWS_TABLES, getApp, makeApp } from '../support/critiqueApps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

const steps = (page) => page.getByRole('navigation', { name: 'Steps' });

test('P-05 and P-26: add a record page, then in Preview clicking a row of the Table of records opens that record', async ({ page }) => {
  const app = await makeApp(page.request, 'Record Roster', (spec) => {
    spec.tables = [structuredClone(CREWS_TABLES[1])];
    spec.pages[0].sources = [{ id: 'all_crews', table: 'crews', mode: 'list' }];
    spec.pages[0].layout.children = [
      { id: 'h_home', type: 'Heading', props: { size: 'lg' }, children: 'Crews today' },
      { id: 'table_1', type: 'DataTable', props: { source: 'all_crews' }, children: [] },
    ];
  });
  const d = design(page);
  await d.open('Record Roster');

  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Add a page' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a page' });
  await expect(dialog.getByText('What kind of page?')).toBeVisible();
  await dialog.getByLabel('A page that shows one record from a table').check();
  await dialog.locator('select').selectOption({ label: 'Crews' });
  await dialog.getByLabel('Page title').fill('One crew');
  await dialog.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // Adding a page saves it (Save stays off: nothing is left to save).
  await expect.poll(async () => (await getApp(page.request, app.id)).spec.pages.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  const saved = (await getApp(page.request, app.id)).spec;
  const record = saved.pages.find((p) => p.title === 'One crew');
  expect(record.route).toContain('/:');
  expect(saved.nav.map((n) => n.pageId)).not.toContain(record.id);
  expect(JSON.stringify(record.layout)).toContain('RecordDetail');
  // The Table of records on the other page now opens it by default.
  expect(JSON.stringify(saved.pages[0].layout.children[1].props.rowAction)).toContain(record.id);

  // Preview: one record, one click on its row.
  await page.goto(`/apps/${app.id}/preview`);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const made = await page.request.post('/api/preview/data/crews', { data: { name: 'Alpha crew', status: 'open' } });
  expect(made.status()).toBe(201);
  await page.reload();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = preview(page).scope;
  const row = scope.getByRole('row').filter({ hasText: 'Alpha crew' });
  await expect(row).toBeVisible();
  const home = page.url();
  await row.getByText('Alpha crew').click();
  await expect(page).not.toHaveURL(home);
  await expect(page).toHaveURL(new RegExp(`/apps/${app.id}/preview/.+`));
  await expect(scope.getByText('Alpha crew').first()).toBeVisible();
  await expect(scope.getByRole('table')).toHaveCount(0);
  expect(ctx.server.outbound()).toEqual([]);
});

test('P-06: a Blank app with a saved page and no tables runs in Preview, with no "Write your prompt first"', async ({ page }) => {
  await page.goto('/apps');
  await createBlankApp(page, 'Page Only');
  await expectLanding(page);

  const d = design(page);
  await steps(page).getByRole('link', { name: /Design/ }).click();
  await expect(d.canvas).toBeVisible();
  // A page with more than the starter heading: a heading of its own words and a line under it.
  const settings = await d.openSettings('Heading');
  await settings.getByLabel('Text', { exact: true }).fill('Welcome to my page');
  await settings.getByRole('button', { name: 'Apply' }).click();
  await d.addAt('Add here: Page, place 2', 'Divider line');
  await d.save();

  await steps(page).getByRole('link', { name: /Preview/ }).click();
  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Write your prompt first')).toHaveCount(0);
  await expect(preview(page).scope.getByText('Welcome to my page')).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});
