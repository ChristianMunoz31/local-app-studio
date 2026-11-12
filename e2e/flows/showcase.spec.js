// The Features showcase: filter by category, search, open the details sheet, and send a part to an app's Design step.
// Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { features } from '../pages/features.js';

useApp({ seed: true, ollama: 'dead' });

test('filter to Input, search "form", open the details and use it in an app', async ({ page }) => {
  const made = await page.request.post('/api/studio/apps', { data: { name: 'Crew Roster' } });
  expect(made.ok()).toBe(true);

  const f = features(page);
  await f.open();

  await f.showCategory('Input');
  await expect(page.getByRole('region', { name: 'Input', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Records', exact: true })).toHaveCount(0);

  await f.search('form');
  await expect(f.card('Form')).toBeVisible();
  await expect(f.card('Search box')).toHaveCount(0);

  await f.card('Form').getByRole('button', { name: 'Show details for Form' }).click();
  const sheet = page.getByRole('dialog', { name: 'Form', exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('A form to add or change a record.')).toBeVisible();

  await sheet.getByRole('button', { name: 'Use in app' }).click();
  const choose = page.getByRole('dialog', { name: 'Use "Form" in an app' });
  await expect(choose.getByLabel('App', { exact: true })).toHaveValue(/.+/);
  await choose.getByRole('button', { name: 'Open Design' }).click();

  await expect(page).toHaveURL(/\/apps\/[^/]+\/design$/);
  const state = await page.evaluate(() => window.history.state?.usr ?? null);
  expect(state).toMatchObject({ addEntry: 'part:RecordForm' });
});

test('a search with no match says so and can be cleared', async ({ page }) => {
  const f = features(page);
  await f.open();
  await f.search('zzzz');
  await expect(page.getByText('Nothing matches "zzzz". Try another word.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(f.card('Heading')).toBeVisible();
});
