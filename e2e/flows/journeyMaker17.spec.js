// Phase 17 journey, the maker (CRITIQUE-phase17-maker.md; DESIGN-phase17.md P17-06 to P17-11 and P17-26): build a Status board once in the
// Feature builder (a list and a quick add on one table), use it in an app, add a row in Preview and see it in the list of the board,
// save a newer version and update the app to it. Run on the honest fake helper (cannedDescribeChat) so the app is made the way a person makes it.
// Actions are counted per stage with stageCounter.js and printed. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { NEVER_SHOWN_BUILDER } from '../pages/journey.js';
import { builder } from '../pages/builder.js';
import { design, visibleNotice } from '../pages/design.js';
import { features } from '../pages/features.js';
import { preview } from '../pages/preview.js';
import { stagedJourney } from '../support/stageCounter.js';
import { paneHeading } from '../support/helperApps.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { openStartBox } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });

test.describe.configure({ mode: 'serial' });

const IDEA = 'A tool lending log for my workshop: items, people and which person has which item.';
const NAME = 'Status board';
const LINE = 'A list and a quick add for the things you track.';
const ID_LIKE = /^[a-z]+(_[a-z0-9]+)+$|^(created_at|updated_at)$/;
let appId = '';
let appName = '';
let featureId = '';

test('the Feature builder: a list and a quick add join one table, and Save keeps them as Status board', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const j = stagedJourney(page);
  const b = builder(page);
  const d = b.d;
  j.stage('Feature builder');
  await page.goto('/features/new');
  await expect(b.heading('New feature')).toBeVisible();
  await j.click(page.getByRole('button', { name: 'Add Table of records', exact: true }));
  await j.click(d.notConnected('datatable_1').getByRole('button', { name: 'Add a table slot for Table of records' }));
  const slotDialog = page.getByRole('dialog', { name: 'Add a table slot' });
  await j.select(slotDialog.getByLabel('Sample rows', { exact: true }), { label: 'Tasks' });
  await j.fill(slotDialog.getByLabel('Shown as', { exact: true }), 'Things to track');
  await j.click(slotDialog.getByRole('button', { name: 'Add slot', exact: true }));
  await d.block('datatable_1').focus();
  await j.click(page.getByRole('button', { name: 'Add Quick add', exact: true }));
  // P17-06: the Quick add and the list are on one table slot, so there is one table choice.
  await expect(b.rows('table')).toHaveCount(1);
  await expect(d.badge('quickadd_1')).toHaveAccessibleName('Uses slot Things to track. Change table');

  const dialog = await b.openSave();
  await j.fill(dialog.getByLabel('Name', { exact: true }), NAME);
  await j.fill(dialog.getByLabel('What it is for, in one line', { exact: true }), LINE);
  await j.click(dialog.getByRole('button', { name: /^Save feature$/ }));
  await expect(visibleNotice(page, `Saved ${NAME}. It is in your features.`)).toBeVisible();
  await expect(page).toHaveURL(/\/features\/[^/]+\/edit$/);
  featureId = new URL(page.url()).pathname.split('/')[2];
  expect((await page.getByRole('main').innerText()).match(NEVER_SHOWN_BUILDER)).toBeNull();
  const record = (await (await page.request.get(`/api/studio/features/${featureId}`)).json()).data;
  // One table choice: the list and the table settings are one pair, never two boxes that can point at different tables.
  expect(record.params.filter((p) => p.type === 'table')).toHaveLength(1);
  j.report(test.info(), 'maker (builder)');
  expect(ctx.server.outbound()).toEqual([]);
});

test('Prompt: the lending app is made and used; Design: the board asks for one table in the app words, never ids', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(120_000);
  const j = stagedJourney(page);
  const f = features(page);
  const d = design(page);
  j.stage('Prompt');
  await page.goto('/apps');
  await openStartBox(page, (l) => j.click(l));
  await j.fill(page.getByLabel('Your prompt'), IDEA);
  await j.click(page.getByRole('button', { name: 'Make my app', exact: true }));
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });
  appId = /\/apps\/([^/]+)\/prompt$/.exec(page.url())[1];
  await j.click(page.getByRole('button', { name: 'Use this', exact: true }));
  await expect(page).toHaveURL(/\/design$/);
  appName = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.name;

  j.stage('Design');
  await f.open();
  await j.click(page.getByRole('button', { name: `More actions for ${NAME}` }));
  await j.click(page.getByRole('menuitem', { name: 'Use in app' }));
  const choose = page.getByRole('dialog', { name: `Use "${NAME}" in an app` });
  await j.select(choose.getByLabel('App', { exact: true }), { label: appName });
  await j.click(choose.getByRole('button', { name: 'Open Design' }));
  await expect(d.canvas).toBeVisible();
  // The board goes on the Items page, whose list shows every item.
  await j.select(d.page(), { label: 'Items' });
  await j.click(page.getByRole('button', { name: `Add ${NAME}`, exact: true }));
  const settings = page.getByRole('dialog', { name: `Settings for ${NAME}` });
  await expect(settings).toBeVisible();

  // P17-06: one table choice for the slot ("Things to track"), no second "Things to track list" box.
  await expect(settings.getByLabel('Things to track', { exact: true })).toHaveCount(1);
  await expect(settings.getByLabel(/^Things to track list/)).toHaveCount(0);
  // P17-08: every choice reads the names of the app, never a computer name (open_loans, date_out, created_at).
  const choices = await settings.locator('select option').allInnerTexts();
  expect(choices.length).toBeGreaterThan(0);
  for (const c of choices) expect(c.trim(), `a choice reads like an id: ${c}`).not.toMatch(ID_LIKE);
  expect(choices.some((c) => /^Items$/.test(c.trim()))).toBe(true);
  await j.click(settings.getByRole('button', { name: 'Apply' }));
  await expect(settings).toHaveCount(0);
  await j.click(page.getByRole('button', { name: 'Save', exact: true }));
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  j.report(test.info(), 'maker (app)');
  expect(ctx.server.outbound()).toEqual([]);
});

test('Preview: a row added with the Quick add shows in the list of the board', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(120_000);
  const j = stagedJourney(page);
  j.stage('Preview');
  const p = preview(page);
  const scope = await p.open(appName);
  await j.click(scope.getByRole('link', { name: 'Items', exact: true }));
  // P17-13: the words of the board follow the table it was given ("Add to Items"), never the builder's own name for the slot.
  const placeholder = scope.getByPlaceholder('Add to Items');
  await expect(placeholder).toBeVisible();
  await expect(scope.getByPlaceholder(/Things to track/)).toHaveCount(0);
  await j.fill(placeholder, 'Paint the fence');
  await j.click(scope.getByRole('button', { name: 'Add', exact: true }).last());
  // The row is in a table the page shows: the one the Quick add writes to is the one the board lists.
  // Both lists on the page (the page's own and the board's) show the row: the Quick add wrote where the board shows.
  const tables = scope.getByRole('table');
  await expect(tables).toHaveCount(2);
  for (const i of [0, 1]) await expect(tables.nth(i).getByText('Paint the fence')).toBeVisible();
  j.report(test.info(), 'maker (preview)');
  expect(ctx.server.outbound()).toEqual([]);
});

test('a newer version: the block says so beside its table, the strip counts it, and Update to latest fills the new words and says so', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(120_000);
  const j = stagedJourney(page);
  const b = builder(page);
  const d = b.d;

  // Feature builder: a heading whose words people can change, saved as version 2.
  j.stage('Feature builder');
  await page.goto(`/features/${featureId}/edit`);
  await expect(b.heading(`Edit ${NAME}`)).toBeVisible();
  await j.click(page.getByRole('button', { name: 'Add Heading', exact: true }));
  const words = b.rows('text').first();
  await j.click(words.getByRole('checkbox', { name: 'Let people change these words' }));
  const save = await b.openSave();
  await j.click(save.getByRole('button', { name: /^Save (feature|a new version)$/ }));
  await expect(visibleNotice(page, `Saved ${NAME}. It is in your features.`)).toBeVisible();
  const record = (await (await page.request.get(`/api/studio/features/${featureId}`)).json()).data;
  expect(record.version).toBe(2);

  // Design: the app is still on version 1 and says so before Settings is opened (P17-26).
  j.stage('Design');
  await page.goto(`/apps/${appId}/design`);
  await expect(d.canvas).toBeVisible();
  await j.select(d.page(), { label: 'Items' });
  const pill = page.locator('[data-indicator="newer_version"]');
  await expect(pill).toHaveText('Newer version');
  await expect(pill).toHaveCount(1);
  await expect(page.getByText('1 feature on this page has a newer version.')).toBeVisible();
  // It sits beside the connection pill, which still names the table.
  await expect(page.locator('[data-connection-badge]').filter({ hasText: 'Connected to Items' })).not.toHaveCount(0);

  await j.click(pill);
  const settings = page.getByRole('dialog', { name: `Settings for ${NAME}` });
  await expect(settings).toBeVisible();
  await expect(settings.getByText('A newer version is in your library.')).toBeVisible();
  await j.click(settings.getByRole('button', { name: 'Update to latest' }));
  // P17-07: the new words setting is filled from the words of the feature, the update is said in one sentence, and no line of code shows.
  await expect(visibleNotice(page, `Updated ${NAME} to the latest version.`)).toBeVisible();
  await expect(page.getByText(/needs a value for|Feature "/)).toHaveCount(0);
  await expect(page.locator('[data-indicator="newer_version"]')).toHaveCount(0);
  await expect(page.getByText('has a newer version.')).toHaveCount(0);
  j.report(test.info(), 'maker (update)');
  expect(ctx.server.outbound()).toEqual([]);
});

test('New table for a feature with an empty name says "Give the table a name." and nothing else', async ({ page }) => {
  test.setTimeout(120_000);
  const created = await page.request.post('/api/studio/apps', { data: { name: 'Blank Board' } });
  expect(created.status()).toBe(201);
  await page.goto('/features');
  await features(page).menu(NAME, 'Use in app');
  const choose = page.getByRole('dialog', { name: `Use "${NAME}" in an app` });
  await choose.getByLabel('App', { exact: true }).selectOption({ label: 'Blank Board' });
  await choose.getByRole('button', { name: 'Open Design' }).click();
  await page.getByRole('button', { name: `Add ${NAME}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `New table for ${NAME}`, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Table name').fill('');
  await dialog.getByRole('button', { name: 'Make table', exact: true }).click();
  await expect(dialog.getByText('Give the table a name.')).toBeVisible();
  const text = await dialog.innerText();
  expect(text).not.toMatch(/Too small|Invalid string|expected string|pattern/);
});
