// Phase 28: an automation. Ticking Paid on an invoice sets Paid on to today and says so; unticking clears it and says so; the Data step
// shows the rule in words. Today is the local date of this machine (the server and this process share the clock).
import { test, expect, useApp } from '../support/fixtures.js';
import { useExample } from '../pages/apps.js';
import { preview } from '../pages/preview.js';

useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const NAME = 'Invoices and Clients';
const pad = (n) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

let appId = '';

test('ticking Paid and saving sets Paid on to today and says so; unticking clears it and says so', async ({ page }) => {
  await page.goto('/apps');
  appId = await useExample(page, NAME);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = preview(page).scope;
  const res = await page.request.get('/api/preview/data/invoices?limit=200');
  const unpaid = (await res.json()).data.rows.find((r) => !r.paid);
  expect(unpaid, 'the sample has an unpaid invoice').toBeTruthy();

  await scope.getByRole('cell', { name: unpaid.number, exact: true }).click();
  const paid = scope.getByLabel('Paid', { exact: true });
  const paidOn = scope.getByLabel('Paid on', { exact: true });
  await expect(paid).not.toBeChecked();
  await paid.check();
  await scope.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(scope.getByText('Paid on was set to today.')).toBeVisible({ timeout: 10_000 });
  await expect(paidOn).toHaveValue(localToday());

  await paid.uncheck();
  await scope.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(scope.getByText('Paid on was cleared.')).toBeVisible({ timeout: 10_000 });
  await expect(paidOn).toHaveValue('');
});

test('the Data step shows the rule in words', async ({ page }) => {
  await page.goto(`/apps/${appId}/data`);
  await page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: /^Invoices/ }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Automations', exact: true })).toBeVisible();
  await expect(page.getByText('When Paid is ticked, set Paid on to today.', { exact: true })).toBeVisible();
  await expect(page.getByText('When Paid is unticked, clear Paid on.', { exact: true })).toBeVisible();
});
