// Phase 14 proof flows, taking out a field or table that parts use (DESIGN-phase14.md P-04). Breaker paths C2 and C6.
// The reason beside the greyed Save names the page in plain words, "Remove it from those parts too" takes it out of the parts, and Save works.
// Studio API calls (estimate): about 40, well under the 300 per 15 minutes. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { CREWS_TABLES, getApp, makeApp } from '../support/critiqueApps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

const REMOVE = 'Remove it from those parts too';

/** An app with People and Crews and a Home page that has a Chart grouped by Status and a Table of records that shows Status. */
const withUsers = (name) =>
  makeApp(ctxRequest(), name, (spec) => {
    spec.tables = structuredClone(CREWS_TABLES);
    spec.pages[0].sources = [{ id: 'all_crews', table: 'crews', mode: 'list' }];
    spec.pages[0].layout.children = [
      { id: 'h_home', type: 'Heading', props: { size: 'lg' }, children: 'Crews today' },
      { id: 'chart_1', type: 'Chart', props: { source: 'all_crews', groupBy: 'status', measure: 'count' }, children: [] },
      { id: 'table_1', type: 'DataTable', props: { source: 'all_crews', columns: ['name', 'status'] }, children: [] },
    ];
  });
let request = null;
const ctxRequest = () => request;

test.beforeEach(({ page }) => {
  request = page.request;
});

/** The words that must not be in the reason: ids, the hidden created_at, the old blame on tables. */
const NOT_PLAIN = /\bcrews\b|\bstatus\b|created_at|updated_at|\blead_id\b|Some tables need a fix|Use one of|There is no table/;

test('P-04 C2: delete a field a Chart groups by: the reason names the page, "Remove it from those parts too" makes Save work, the save succeeds', async ({ page }) => {
  const app = await withUsers('Removal Field');
  await page.goto(`/apps/${app.id}/data`);
  const tables = page.getByRole('navigation', { name: 'Tables' });
  await tables.getByRole('button', { name: /^Crews/ }).click();
  await page.getByRole('button', { name: 'Delete field Status' }).click();

  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  const reason = page.locator('#data-save-blocked');
  await expect(reason).toBeVisible();
  await expect(reason).toContainText('Home');
  expect(await reason.innerText()).not.toMatch(NOT_PLAIN);
  await expect(save).toHaveAttribute('aria-describedby', 'data-save-blocked');
  // No table is blamed.
  await expect(page.getByText('Needs a fix')).toHaveCount(0);
  // The list further down speaks in page, part and field words, with no ids.
  const list = page.getByText('These pages use what you changed. Fix them in Design:').locator('xpath=..');
  await expect(list).toBeVisible();
  expect(await list.innerText()).not.toMatch(/\bcrews\b|created_at|updated_at|Use one of/);

  await page.getByRole('button', { name: REMOVE }).click();
  await expect(save).toBeEnabled();
  await expect(page.getByRole('button', { name: REMOVE })).toHaveCount(0);
  await expect(page.getByText('Took it out of the parts that used it.')).toBeVisible();
  await save.click();
  const sure = page.getByRole('alertdialog', { name: 'Save and remove data?' });
  await expect(sure).toContainText('Removes the field "Status" from "Crews".');
  await sure.getByRole('button', { name: 'Save and remove' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');

  const saved = (await getApp(page.request, app.id)).spec;
  expect(saved.tables.find((t) => t.id === 'crews').fields.map((f) => f.id)).not.toContain('status');
  // Crews has no other choice field, so the Chart goes; the Table of records stays, without the Status column.
  const parts = saved.pages[0].layout.children;
  expect(parts.map((p) => p.type)).toEqual(['Heading', 'DataTable']);
  expect(JSON.stringify(saved.pages)).not.toContain('status');
  expect(ctx.server.outbound()).toEqual([]);
});

test('P-04 C6: delete a table that parts use: the reason names the page, one press takes the parts out, Save works', async ({ page }) => {
  const app = await withUsers('Removal Table');
  await page.goto(`/apps/${app.id}/data`);
  await page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: /^Crews/ }).click();
  await page.getByRole('button', { name: 'Delete table' }).click();

  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  const reason = page.locator('#data-save-blocked');
  await expect(reason).toContainText('Home');
  expect(await reason.innerText()).not.toMatch(NOT_PLAIN);

  await page.getByRole('button', { name: REMOVE }).click();
  await expect(save).toBeEnabled();
  await save.click();
  const sure = page.getByRole('alertdialog', { name: 'Save and remove data?' });
  await expect(sure).toBeVisible();
  await sure.getByRole('button', { name: 'Save and remove' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');

  const saved = (await getApp(page.request, app.id)).spec;
  expect(saved.tables.map((t) => t.id)).toEqual(['people']);
  expect(JSON.stringify(saved.pages)).not.toContain('"crews"');
});
