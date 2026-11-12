// Features: the library page, a custom feature created by import, its use in Design (shelf, insert, save), the app
// preview, and the delete refusal. Nothing leaves this computer and no /api/items route exists.
import { test, expect, useApp } from '../support/fixtures.js';
import { features } from '../pages/features.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

async function openDesign(page) {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(page.getByRole('region', { name: 'Page layout' })).toBeVisible();
}

test('the Features page lists the seeded features and built-in parts, and never asks for /api/items', async ({ page }) => {
  const asked = [];
  page.on('request', (req) => asked.push(new URL(req.url()).pathname));
  const f = features(page);
  await f.open();
  await expect(f.card('Number row')).toBeVisible();
  await expect(f.card('Search list')).toBeVisible();
  await expect(f.card('Table of records')).toBeVisible();
  const drawer = await f.openDetails('Number row');
  await expect(drawer).toContainText('Not used in an app yet');
  await f.closeDetails();
  expect(asked.filter((p) => p.startsWith('/api/items'))).toEqual([]);
  expect((await page.request.get('/api/items')).status()).toBe(404);
});

test('a custom feature is created by importing an exported file', async ({ page }, testInfo) => {
  const f = features(page);
  await f.open();
  const exported = await f.exportFile('Number row', testInfo.outputPath('kpi_row.feature.json'));
  expect(exported.suggested).toBe('kpi_row.feature.json');

  // The same file imports as a no-op (it says it is already in your library); a copy with another id and name becomes a new custom feature.
  await f.importJson(exported.json);
  await expect(page.getByRole('status')).toContainText('Number row is already in your library.');
  await expect(f.customCards()).toHaveCount(2);

  const copy = { ...exported.json, feature: { ...exported.json.feature, id: 'crew_total', label: 'Crew total' } };
  await f.importJson(copy, 'crew_total.feature.json');
  await expect(f.card('Crew total')).toBeVisible();
  await expect(f.customCards()).toHaveCount(3);
});

test('Design adds the custom feature from the shelf, and Save keeps it', async ({ page }) => {
  const created = await (await page.request.post('/api/studio/apps', { data: { name: 'Crew Roster' } })).json();
  const record = created.data;
  const spec = record.spec;
  spec.tables = [
    {
      id: 'crews',
      label: 'Crews',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', required: false, type: 'text' },
        { id: 'size', label: 'Size', required: false, type: 'integer' },
      ],
    },
  ];
  spec.pages[0].sources = [{ id: 'open_crews', table: 'crews', mode: 'list' }];
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);

  await openDesign(page);
  // The shelf lists your features next to the built-in parts; Add puts the feature on the page and opens its settings.
  await page.getByRole('searchbox', { name: 'Search parts and features' }).fill('Crew total');
  await page.getByRole('button', { name: 'Add Crew total' }).click();

  const settings = page.getByRole('dialog', { name: 'Settings for Crew total' });
  await expect(settings).toBeVisible();
  await settings.getByLabel('List').selectOption({ index: 0 });
  await settings.getByLabel('Number field').selectOption({ index: 0 });
  await settings.getByLabel('Title').fill('Crew size');
  await settings.getByRole('button', { name: 'Apply' }).click();
  await expect(settings).toBeHidden();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);

  // The block is a feature block: its settings say so.
  await page.locator('[data-canvas-block][data-layer-id^="crew_total"]').first().click();
  await page.getByRole('toolbar').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings for Crew total' })).toContainText('Feature: Crew total');
});

test('the preview shows the feature and the Features page counts the app', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Crew size').first()).toBeVisible();

  const f = features(page);
  await f.open();
  await expect(f.card('Crew total')).toBeVisible();
  const drawer = await f.openDetails('Crew total');
  await expect(drawer).toContainText('Used in 1 app');
  await f.closeDetails();
});

test('a feature that an app uses cannot be deleted, and nothing went out', async ({ page }) => {
  const f = features(page);
  await f.open();
  await f.menu('Crew total', 'Delete');
  // No question is asked: the page already knows who uses it and says so.
  await expect(page.getByRole('alert').filter({ hasText: 'Crew total is used by Crew Roster. Remove it there first.' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(f.card('Crew total')).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});
