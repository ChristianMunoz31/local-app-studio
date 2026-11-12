// Phase 28: Import rows in Preview. A 300-row CSV (built in code, lines 58 and 201 bad) is checked: 298 rows can be added, 2 are left out
// and named; then imported: "Added 298 rows." and the unpaid count in the running app rises by 298. No timing waits.
import { test, expect, useApp } from '../support/fixtures.js';
import { useExample } from '../pages/apps.js';
import { preview } from '../pages/preview.js';
import { BAD_LINES, GOOD_ROWS, invoicesCsvFile } from '../support/csvRows.js';

useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const NAME = 'Invoices and Clients';

test('Import rows checks 300 rows (298 can be added, lines 58 and 201 named), then adds 298 and the app shows them', async ({ page }) => {
  await page.goto('/apps');
  await useExample(page, NAME);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = preview(page).scope;
  const seeded = (await (await page.request.get('/api/preview/data/invoices?limit=200')).json()).data;
  const unpaidBefore = seeded.rows.filter((r) => !r.paid).length;

  await page.getByRole('button', { name: 'Import rows', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import rows' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Table', { exact: true }).selectOption({ label: 'Invoices' });
  await dialog.getByLabel('Choose a CSV file').setInputFiles(invoicesCsvFile());
  await dialog.getByRole('button', { name: 'Check rows', exact: true }).click();

  await expect(dialog.getByText(`${GOOD_ROWS} rows can be added. ${BAD_LINES.length} rows will be left out.`, { exact: true })).toBeVisible({ timeout: 15_000 });
  for (const line of BAD_LINES) await expect(dialog.getByRole('listitem').filter({ hasText: new RegExp(`^Row ${line}:`) })).toHaveCount(1);
  await expect(dialog.getByRole('listitem')).toHaveCount(BAD_LINES.length);

  await dialog.getByRole('button', { name: `Import ${GOOD_ROWS} rows`, exact: true }).click();
  await expect(dialog.getByText(`Added ${GOOD_ROWS} rows.`, { exact: true })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);

  const total = (await (await page.request.get('/api/preview/data/invoices?limit=1')).json()).data.total;
  expect(total).toBe(seeded.total + GOOD_ROWS);
  await expect(scope.getByText(String(unpaidBefore + GOOD_ROWS), { exact: true })).toBeVisible({ timeout: 15_000 });
});
