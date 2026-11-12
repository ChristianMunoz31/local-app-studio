// Features search: a plain word finds the part, the name match is highlighted, and Back after Use in app keeps the query.
// Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { features } from '../pages/features.js';

useApp({ seed: true, ollama: 'dead' });

test('"spreadsheet" finds Table of records first, highlights it, and Back keeps the query', async ({ page }) => {
  const made = await page.request.post('/api/studio/apps', { data: { name: 'Crew Roster' } });
  expect(made.ok()).toBe(true);

  const f = features(page);
  await f.open();
  await f.search('spreadsheet');

  const first = page.getByTestId('feature-tile').first();
  await expect(first).toHaveAttribute('data-entry-key', 'part:DataTable');
  await expect(page).toHaveURL(/\?q=spreadsheet$/);

  // A name match is marked: typing the start of the name highlights it.
  await f.search('table');
  await expect(page.getByTestId('feature-tile').first().locator('mark')).toHaveText('Table');
  await f.search('spreadsheet');

  await f.card('Table of records').getByRole('button', { name: 'Show details for Table of records' }).click();
  await page.getByRole('dialog', { name: 'Table of records', exact: true }).getByRole('button', { name: 'Use in app' }).click();
  await page.getByRole('dialog', { name: 'Use "Table of records" in an app' }).getByRole('button', { name: 'Open Design' }).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+\/design$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/features\?q=spreadsheet$/);
  await expect(page.getByLabel('Search parts and features')).toHaveValue('spreadsheet');
  await expect(page.getByTestId('feature-tile').first()).toHaveAttribute('data-entry-key', 'part:DataTable');
});

test('"/" focuses the search and Escape clears it', async ({ page }) => {
  const f = features(page);
  await f.open();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search parts and features')).toBeFocused();
  await page.keyboard.type('form');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Search parts and features')).toHaveValue('');
});
