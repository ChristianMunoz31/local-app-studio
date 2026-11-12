// Phase 14 proof flows, leaving the workspace (DESIGN-phase14.md P-01, P-02). Breaker paths B1b and F1b.
//   P-01: browser Back goes through the same leave gate as the rail ("cannot be saved yet" and "Stop the helper and leave?").
//   P-02: the prompt words come back after a reload of the Prompt step.
//   N1/N2 (re-review): Back on the first entry of a tab never leaves the Back button dead; Back after a step move lands on the step before it.
// Studio API calls (estimate): about 75, well under the 300 per 15 minutes the server allows. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { describeFakeChat } from '../support/describeFake.js';
import { design } from '../pages/design.js';
import { importCrewRoster, listApps } from '../support/critiqueApps.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { openStartBox } from '../pages/apps.js';

let slow = false;
const SLOW_MS = 20_000;
const ctx = useApp({
  seed: true,
  ollama: 'fake',
  fakeChat: async (body) => {
    if (slow) await new Promise((r) => setTimeout(r, SLOW_MS));
    return describeFakeChat(body);
  },
});

const IDEA = 'Crew roster for my painting business.';

test.beforeEach(() => {
  slow = false;
});

test('P-01 B1b: browser Back with a design draft that cannot be saved asks first; Stay keeps the part, Discard lets Back go', async ({ page }) => {
  await importCrewRoster(page.request);
  const d = design(page);
  await d.open('Crew Roster');

  // Page actions > Add a page "Archive" > Add here > Table of records: two tables fit, so it is not connected and cannot be saved.
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Add a page' }).click();
  await page.getByLabel('Page title').fill('Archive');
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(d.page()).toHaveValue(/archive/);
  const first = (await d.order())[0];
  await d.block(first).focus();
  await d.addAt('Add here: Page, place 2', 'Table of records');
  await expect(page.getByText('Needs a table', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  const blocks = await d.order();

  await page.goBack();
  const stuck = page.getByRole('alertdialog', { name: 'Your changes on Design cannot be saved yet' });
  await expect(stuck).toBeVisible();
  await expect(stuck.getByRole('button', { name: 'Discard changes' })).toBeVisible();
  await stuck.getByRole('button', { name: 'Stay' }).click();
  await expect(stuck).toHaveCount(0);
  await expect(page).toHaveURL(/\/design$/);
  expect(await d.order()).toEqual(blocks);
  await expect(page.getByText('Needs a table', { exact: true }).first()).toBeVisible();

  // The gate stays armed: Back again asks again, and Discard changes lets Back go.
  await page.goBack();
  await expect(stuck).toBeVisible();
  await stuck.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(stuck).toHaveCount(0);
});

test('P-01 F1b: browser Back while the helper works asks "Stop the helper and leave?"; Stay keeps it running', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  slow = true;
  await page.goto('/apps');
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill(IDEA);
  await page.getByRole('button', { name: 'Make my app' }).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/);
  await expect(page.getByRole('region', { name: 'Prompt' }).getByRole('button', { name: 'Cancel' })).toBeVisible();

  await page.goBack();
  const ask = page.getByRole('alertdialog', { name: 'Stop the helper and leave?' });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('The helper is still working on your app. If you leave the app now, it stops.');
  await ask.getByRole('button', { name: 'Stay' }).click();
  await expect(ask).toHaveCount(0);
  await expect(page).toHaveURL(/\/prompt$/);
  await expect(page.getByRole('region', { name: 'Prompt' }).getByRole('button', { name: 'Cancel' })).toBeVisible();

  await page.goBack();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Stop and leave' }).click();
  await expect(page).toHaveURL(/\/apps$/);
  expect(ctx.server.outbound()).toEqual([]);
});

test('P-02: Make my app, then reload the Prompt step: the words are in the box', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  slow = true;
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/apps');
  const before = (await listApps(page.request)).length;
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill(IDEA);
  await page.getByRole('button', { name: 'Make my app' }).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/);
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);
  expect((await listApps(page.request)).length).toBe(before + 1);

  await page.reload();
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);

  // Coming back later finds them too.
  const url = page.url();
  await page.goto('/apps');
  await page.goto(url);
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);
});

test('N1: a step opened as the first entry of a tab, edited: the first Back saves and shows Apps, the second Back never skips past the step', async ({ page }) => {
  const app = await importCrewRoster(page.request, 'Deep Link Roster');
  const fresh = await page.context().newPage();
  await fresh.goto(`/apps/${app.id}/data`);
  const tables = fresh.getByRole('navigation', { name: 'Tables' });
  await expect(tables).toBeVisible();
  const before = app.spec.tables.length;
  await tables.getByRole('button', { name: /Add table/ }).click();
  await expect(fresh.getByTestId('save-status')).toHaveText('Unsaved changes on Data');

  // There is no entry before the step, so the move replaces the sentinel: the app is not left and the change is saved first.
  await fresh.goBack();
  await expect(fresh).toHaveURL(/\/apps$/);
  await expect
    .poll(async () => (await (await page.request.get(`/api/studio/apps/${app.id}`)).json()).data.spec.tables.length)
    .toBe(before + 1);

  // The second Back is the browser's own: it returns to the step (saved), with no stuck dialog and no skip.
  await fresh.goBack();
  await expect(fresh).toHaveURL(new RegExp(`/apps/${app.id}/data$`));
  await expect(fresh.getByRole('alertdialog')).toHaveCount(0);
  await expect(fresh.getByTestId('save-status')).toHaveText('All changes saved');
});

test('N2: the old /review address, Design edit, Next to Data, Data edit, Back lands on Design (not Prompt)', async ({ page }) => {
  const app = await importCrewRoster(page.request, 'Step Back Roster');
  await page.goto(`/apps/${app.id}/review`);
  // The old address lands on Prompt, where the review now lives.
  await expect(page).toHaveURL(/\/prompt$/);
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  const d = design(page);
  await expect(page.locator('[data-canvas-block]').first()).toBeVisible();
  const first = (await d.order())[0];
  await d.block(first).focus();
  await d.addAt('Add here: Page, place 2', 'Divider line');
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes on Design');

  await page.getByRole('button', { name: 'Next: Data' }).click();
  await expect(page).toHaveURL(/\/data$/);
  const tables = page.getByRole('navigation', { name: 'Tables' });
  await tables.getByRole('button', { name: /Add table/ }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes on Data');

  await page.goBack();
  await expect(page).toHaveURL(/\/design$/);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // It stays on Design: no later correction sends it to Prompt.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/design$/);
});
