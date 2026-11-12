// Proof flow J4 (DESIGN-phase12.md 2.9, WP-5): the Features page and an app's Design agree on the same parts, a part is saved as a feature,
// the feature is used in a second app, and a damaged feature is explained and removed. Counted where 2.9 asserts a number.
// Nothing leaves this computer.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { features } from '../pages/features.js';
import { journey, NEVER_SHOWN } from '../pages/journey.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const crewRoster = () => JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));
const expectPlainWords = async (page, where) => {
  const text = await page.locator('main').innerText();
  expect(text.match(NEVER_SHOWN), `a word that is never shown, on ${where}`).toBeNull();
};
/** The names of the tiles shown, in order: on the Features page ("Show details for X") or on the shelf ("Select X"). */
const tileNames = (page) =>
  page.locator('[data-entry-key]').evaluateAll((els) =>
    els.map((el) => el.querySelector('button[aria-label^="Show details for "], button[aria-label^="Select "]')?.getAttribute('aria-label').replace(/^(Show details for|Select) /, '')),
  );

test('J4: the Features page and the shelf of Design list the same names in the same order, 3 clicks apart', async ({ page }) => {
  const imported = await page.request.post('/api/studio/apps/import', { data: { spec: crewRoster() } });
  expect(imported.status()).toBe(201);

  const f = features(page);
  const j = journey(page);
  await f.open();
  await expectPlainWords(page, 'Features');
  await page.getByLabel('Search parts and features').fill('number');
  await expect(page.getByTestId('feature-tile').first()).toBeVisible();
  const onPage = await tileNames(page);
  expect(onPage.length).toBeGreaterThan(0);
  expect(onPage).toContain('Number tile');

  // Features to an app's Design: menu, Apps, the app's card (3).
  await j.click(page.getByRole('button', { name: /menu/i }).first());
  await j.click(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Apps' }));
  await j.click(page.getByRole('link', { name: 'Crew Roster' }));
  await expect(page).toHaveURL(/\/design$/);
  await expect(design(page).canvas).toBeVisible();
  expect(j.counts().actions, j.trail()).toBeLessThanOrEqual(3);

  await page.getByRole('searchbox', { name: 'Search parts and features' }).fill('number');
  await expect(page.locator('[data-entry-key]').first()).toBeVisible();
  expect(await tileNames(page)).toEqual(onPage);
  test.info().annotations.push({ type: 'measured', description: `J4 Features page to Design: ${j.counts().actions} clicks (target 3); ${onPage.length} tiles agree` });
});

test('J4: a part is saved as a feature and used in a second app (7 actions or fewer from Features)', async ({ page }) => {
  const d = design(page);
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await expect(d.canvas).toBeVisible();

  // Save a part as a feature, page saved: select the heading, Save as feature, name, what it is for, Save feature, Save (6).
  const save = journey(page);
  await save.click(d.block('h1'));
  await save.click(page.getByRole('button', { name: 'Save as feature' }));
  const dialog = page.getByRole('dialog', { name: 'Save as feature' });
  await expect(dialog).toBeVisible();
  await save.fill(dialog.getByLabel('Name', { exact: true }), 'Crew title');
  await save.fill(dialog.getByLabel('What it is for (the helper reads this to know when to use it)'), 'A big title for a crews page.');
  await save.click(dialog.getByRole('button', { name: 'Save feature' }));
  await expect(dialog).toHaveCount(0);
  await expect(visibleNotice(page, 'This page now uses it')).toBeVisible();
  await save.click(page.getByRole('button', { name: 'Save', exact: true }));
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
  expect(save.counts().actions, save.trail()).toBeLessThanOrEqual(6);

  // A second app, made through the API.
  const second = crewRoster();
  second.app = { ...second.app, name: 'Second Roster', slug: 'second-roster', identifier: 'com.example.secondroster' };
  expect((await page.request.post('/api/studio/apps/import', { data: { spec: second } })).status()).toBe(201);

  // Use it there: search, the tile's menu, Use in app, the app, Open Design, Add, Save (7).
  const f = features(page);
  const use = journey(page);
  await f.open();
  await use.fill(page.getByLabel('Search parts and features'), 'crew title');
  await use.click(page.getByRole('button', { name: 'More actions for Crew title' }));
  await use.click(page.getByRole('menuitem', { name: 'Use in app' }));
  const choose = page.getByRole('dialog', { name: 'Use "Crew title" in an app' });
  await use.select(choose.getByLabel('App', { exact: true }), { label: 'Second Roster' });
  await use.click(choose.getByRole('button', { name: 'Open Design' }));
  await expect(page).toHaveURL(/\/design$/);
  await expect(d.canvas).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search parts and features' })).toHaveValue(/crew title/i);
  await expect(page.locator('[data-entry-key]').first()).toHaveAttribute('data-entry-key', /crew_title/);
  await use.click(page.getByRole('button', { name: 'Add Crew title' }));
  const settings = page.getByRole('dialog', { name: 'Settings for Crew title' });
  const settingsOpen = await settings.isVisible().catch(() => false);
  if (settingsOpen) await use.click(settings.getByRole('button', { name: 'Apply' }));
  await use.click(page.getByRole('button', { name: 'Save', exact: true }));
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
  const note = `J4 use a saved feature in another app: ${use.counts().actions} actions (target 7; settings dialog ${settingsOpen ? 'opened and needed Apply' : 'did not open'})`;
  test.info().annotations.push({ type: 'measured', description: note });
  expect(use.counts().actions, `${note}\n${use.trail()}`).toBeLessThanOrEqual(7);

  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  const stored = (await (await page.request.get(`/api/studio/apps/${list.find((a) => a.name === 'Second Roster').id}`)).json()).data.spec;
  expect(JSON.stringify(stored.pages[0].layout)).toContain('crew_title');
});

test('J4: a damaged feature says why it cannot be added, and Delete feature removes it after a confirm', async ({ page }) => {
  const db = new DatabaseSync(`${ctx.server.dataDir}/app.db`);
  try {
    db.prepare("INSERT INTO studio_features (id, label, description, body) VALUES ('broken_one', 'Broken tile', 'A damaged feature made for the test.', '{\"params\":\"nope\"}')").run();
  } finally {
    db.close();
  }

  const f = features(page);
  const j = journey(page);
  await f.open();
  await expect(f.card('Broken tile')).toBeVisible();
  const drawer = await f.openDetails('Broken tile');
  await expect(drawer).toContainText('This feature is damaged, so it cannot be added.');
  await expect(drawer.getByRole('region', { name: 'What is wrong' }).getByRole('listitem').first()).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Use in app' })).toBeDisabled();
  await expectPlainWords(page, 'a damaged feature');

  // Open (1), Delete feature (2), confirm (3).
  await j.click(drawer.getByRole('button', { name: 'Delete feature' }));
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await j.click(confirm.getByRole('button', { name: 'Delete feature' }));
  await expect(f.card('Broken tile')).toHaveCount(0);
  expect(j.counts().actions + 1, j.trail()).toBeLessThanOrEqual(3);
  expect(ctx.server.outbound()).toEqual([]);
});
