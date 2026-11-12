// Proof journey "builder" (DESIGN-phase14.md, CRITIQUE-phase14-builder.md): from a Blank app, two linked tables by hand, a list, a form and
// a chart on Home, a record page made by "A page that shows one record from a table", rows that open it in Preview, a Columns part that
// starts empty, Save as feature, and the feature used in a second Blank app whose Preview runs. The critic needed 19 actions for the
// record page and it never opened from the list; the new count is asserted below. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { journey } from '../pages/journey.js';
import { LANDING_STEP, blankAppButton, expectLanding } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
const saved = (page) => expect(page.getByTestId('save-status')).toHaveText('All changes saved');
/** The toolbar's Save (a Form drawn on the Design canvas has Save buttons of its own, of type submit). */
const saveButton = (page) => page.getByRole('button', { name: 'Save', exact: true }).and(page.locator('button[type="button"]'));
const FEATURE = 'Two column header';

/** The record page sub-goal: Page actions, Add a page, the record kind, the table, Add page. The critic needed 19 actions and it never opened. */
const RECORD_PAGE_BUDGET = 6;
/** The whole journey: 41 actions measured when this file was written, 42 after P17-14 (the table choice of a new Form); see the `measured` annotation. */
const BUDGET = 46;

let appId = '';
let counts = {};

test('a Blank app, two linked tables, a record page, then a list, a form and a chart on Home', async ({ page }) => {
  test.setTimeout(120_000);
  const j = journey(page);
  await page.goto('/apps');
  await j.click(blankAppButton(page));
  await j.fill(page.getByLabel('App name'), 'Field Jobs');
  await j.click(page.getByRole('button', { name: 'Create app' }));
  await expectLanding(page);
  appId = new RegExp(`/apps/([^/]+)/${LANDING_STEP}$`).exec(page.url())[1];
  counts.blank = j.counts().actions;

  // Two linked tables on Data: Clients (Name, Phone) and Jobs (Status, Client link).
  await j.click(steps(page).getByRole('link', { name: /Data/ }));
  const addTable = page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: 'Add table' });
  const addField = page.getByRole('button', { name: 'Add field', exact: true });
  const fresh = page.getByRole('group', { name: 'Field New field' });
  await j.click(addTable);
  await j.typeText('Clients');
  await j.click(addField);
  await j.typeText('Phone');
  await j.click(addTable);
  await j.typeText('Jobs');
  await j.click(addField);
  await j.typeText('Status');
  await j.select(page.getByRole('group', { name: 'Field Status' }).getByLabel('Type', { exact: true }), { label: 'Choice' });
  await j.fill(page.getByRole('group', { name: 'Field Status' }).getByLabel('Choices (one per line)'), 'Open\nDone');
  await j.click(addField);
  await expect(fresh.getByLabel('Field name')).toBeFocused();
  await j.typeText('Client');
  await j.select(page.getByRole('group', { name: 'Field Client' }).getByLabel('Type', { exact: true }), { label: 'Link to another table' });
  await j.select(page.getByRole('group', { name: 'Field Client' }).getByLabel('Links to'), { label: 'Clients' });
  await j.click(saveButton(page));
  await saved(page);
  counts.tables = j.counts().actions - counts.blank;

  // The record page first: one dialog, one kind, one table.
  await j.click(steps(page).getByRole('link', { name: /Design/ }));
  await expect(design(page).canvas).toBeVisible();
  const beforeRecord = j.counts().actions;
  await j.click(page.getByRole('button', { name: 'Page actions' }));
  await j.click(page.getByRole('menuitem', { name: 'Add a page' }));
  const dialog = page.getByRole('dialog', { name: 'Add a page' });
  await expect(dialog.getByText('What kind of page?')).toBeVisible();
  await j.click(dialog.getByText('A page that shows one record from a table'));
  await j.select(dialog.getByRole('combobox'), { label: 'Jobs' });
  await j.click(dialog.getByRole('button', { name: 'Add page', exact: true }));
  await expect(dialog).toHaveCount(0);
  counts.recordPage = j.counts().actions - beforeRecord;
  await expect(design(page).page().locator('option:checked')).toHaveText('Jobs (opens from a list)');

  // Back on Home: a list of Jobs (it opens the record page by itself), a Form and a Chart (both connect themselves).
  const beforeHome = j.counts().actions;
  await j.select(design(page).page(), { label: 'Home' });
  await j.click(page.getByRole('button', { name: 'Add List of records' }));
  await j.select(page.getByRole('dialog', { name: 'Settings for List of records' }).getByLabel('Table', { exact: true }), { label: 'Jobs' });
  // P17-14: the page lists Jobs but the app has Clients too, so a new data part asks which table instead of joining the list silently.
  await j.click(page.getByRole('button', { name: 'Add Form' }));
  await j.select(page.getByRole('dialog', { name: 'Settings for Form' }).getByLabel('Table', { exact: true }), { label: 'Jobs' });
  await expect(visibleNotice(page, 'Connected to Jobs.')).toBeVisible();
  await j.click(page.getByRole('button', { name: 'Add Chart' }));
  // Only Jobs has a field a Chart can group by (Clients has Name and Phone), so the Chart still connects itself and says so.
  await expect(visibleNotice(page, 'Connected the Chart to Jobs.')).toBeVisible();
  await expect(page.locator('[data-connection-badge]')).toHaveCount(3);
  await expect(page.locator('[data-connection-badge]').filter({ hasText: 'Connected to Jobs' })).toHaveCount(3);
  await expect(page.locator('[data-not-connected]')).toHaveCount(0);
  await j.click(saveButton(page));
  await saved(page);
  counts.home = j.counts().actions - beforeHome;
  counts.total = j.counts().actions;
  expect(ctx.server.outbound()).toEqual([]);
});

test('the record page: its sub-goal count, and the list opens it by itself', async ({ page }) => {
  const spec = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.spec;
  const record = spec.pages.find((p) => p.title === 'Jobs');
  expect(record.route).toMatch(/\/:id$/);
  expect(spec.nav.some((n) => n.pageId === record.id), 'a record page stays out of the menu').toBe(false);
  const list = JSON.stringify(spec.pages.find((p) => p.route === '/').layout);
  expect(list, 'the new list opens the record page when a row is clicked').toContain(`"pageId":"${record.id}"`);

  const note = `builder journey: record page ${counts.recordPage} actions (the critic needed 19 and it never opened); blank app ${counts.blank}, tables ${counts.tables}, home parts ${counts.home}, total so far ${counts.total}`;
  test.info().annotations.push({ type: 'measured', description: note });
  console.log(note);
  expect(counts.recordPage, note).toBeLessThanOrEqual(RECORD_PAGE_BUDGET);
});

test('Preview: a row opens the record page', async ({ page }) => {
  test.setTimeout(120_000);
  const jobs = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.spec;
  expect(jobs.tables.map((t) => t.id)).toEqual(['clients', 'jobs']);
  await page.goto(`/apps/${appId}/preview`);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const app = page.getByTestId('preview-theme-scope');
  const form = app.locator('form').first();
  await form.getByLabel('Name').fill('Repaint lobby');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved.')).toBeVisible();
  const row = app.getByText('Repaint lobby').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(app.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await expect(app.getByText('Repaint lobby').first()).toBeVisible();
  await expect(page).toHaveURL(/\/preview\/jobs\/[^/]+$/);
});

test('a Columns part starts empty, and Save as feature keeps it in the library', async ({ page }) => {
  const j = journey(page);
  await page.goto(`/apps/${appId}/design`);
  const d = design(page);
  await expect(d.canvas).toBeVisible();

  await j.click(page.getByRole('button', { name: 'Add Columns' }));
  // Two empty places, each with Add here, and no placeholder Text part in them.
  await expect(page.getByRole('button', { name: 'Add here: Column 1 of 2, place 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add here: Column 2 of 2, place 1' })).toBeVisible();
  await expect(d.named('Column 1 of 2').getByRole('group')).toHaveCount(0);
  await expect(d.named('Column 2 of 2').getByRole('group')).toHaveCount(0);

  await j.click(page.getByRole('button', { name: 'Add here: Column 1 of 2, place 1' }));
  await j.click(page.getByRole('button', { name: 'Add Heading' }));
  await expect(d.named('Column 1 of 2').getByRole('group', { name: 'Heading' })).toHaveCount(1);

  await d.named('Columns').first().focus();
  await j.click(page.getByRole('button', { name: 'Save as feature' }));
  const dialog = page.getByRole('dialog', { name: 'Save as feature' });
  await expect(dialog).toBeVisible();
  // The settings read in the app's own words, and a part still reading "Text" would be warned about.
  await expect(dialog.getByText('Text: Heading')).toBeVisible();
  await expect(dialog.getByText(/A part still reads "Text"/)).toHaveCount(0);
  await j.fill(dialog.getByLabel('Name', { exact: true }), FEATURE);
  await j.fill(dialog.getByLabel(/^What it is for/), 'A heading in the first of two columns. Use it at the top of a board.');
  await j.click(dialog.getByRole('button', { name: 'Save feature' }));
  await expect(visibleNotice(page, `Saved ${FEATURE} as a feature.`)).toBeVisible();
  counts.feature = j.counts().actions;
  counts.total += counts.feature;
});

test('a second Blank app uses the feature and its Preview runs', async ({ page }) => {
  test.setTimeout(120_000);
  const j = journey(page);
  await page.goto('/apps');
  await j.click(blankAppButton(page));
  await j.fill(page.getByLabel('App name'), 'Crew Board');
  await j.click(page.getByRole('button', { name: 'Create app' }));
  await expectLanding(page);
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Design/ }));
  const d = design(page);
  await expect(d.canvas).toBeVisible();

  await j.fill(page.getByLabel('Search parts and features'), 'two column');
  await j.click(page.getByRole('button', { name: `Add ${FEATURE}` }));
  await expect(d.canvas.getByRole('group', { name: FEATURE })).toHaveCount(1);
  await j.click(saveButton(page));
  await saved(page);

  // A saved page with a feature on it runs in Preview: the starter test no longer holds it back.
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Preview/ }));
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Describe it on Prompt, or build a page in Design.')).toHaveCount(0);
  await expect(page.getByTestId('preview-theme-scope').getByRole('heading').first()).toBeVisible();

  counts.second = j.counts().actions;
  counts.total += counts.second;
  const note = `builder journey total: ${counts.total} actions (blank app ${counts.blank}, tables ${counts.tables}, record page ${counts.recordPage}, home parts ${counts.home}, columns and feature ${counts.feature}, second app ${counts.second}); budget ${BUDGET}`;
  test.info().annotations.push({ type: 'measured', description: note });
  console.log(note);
  expect(counts.total, note).toBeLessThanOrEqual(BUDGET);
  expect(ctx.server.outbound()).toEqual([]);
});
