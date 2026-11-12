// Phase 28: a numbered field. Invoices and Clients numbers its invoices (INV-, from 1001, four digits): the form says it is numbered when
// saved, and each Add takes the next number after the seeded ones. No timing waits; every wait is on a shown sentence or row.
import { test, expect, useApp } from '../support/fixtures.js';
import { useExample } from '../pages/apps.js';
import { preview } from '../pages/preview.js';

useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const NAME = 'Invoices and Clients';
const numberOf = (n) => `INV-${String(n).padStart(4, '0')}`;

/** The invoice numbers kept in Preview, as whole numbers. */
async function keptNumbers(page) {
  const res = await page.request.get('/api/preview/data/invoices?limit=200');
  expect(res.ok()).toBe(true);
  const { rows } = (await res.json()).data;
  return rows.map((r) => Number(/^INV-(\d+)$/.exec(r.number)?.[1] ?? NaN));
}

test('New invoice says the number is given when saved, and Add takes the next INV- number; a second Add takes the one after', async ({ page }) => {
  await page.goto('/apps');
  await useExample(page, NAME);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = preview(page).scope;
  const before = await keptNumbers(page);
  expect(before.length).toBeGreaterThan(0);
  expect(before.every(Number.isInteger)).toBe(true);
  const top = Math.max(...before);
  expect(top).toBeGreaterThanOrEqual(1001);

  for (const [i, amount] of ['125', '250'].entries()) {
    const expected = numberOf(top + 1 + i);
    await scope.getByRole('button', { name: 'New invoice', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add to Invoices' });
    await expect(form).toBeVisible();
    await expect(form.getByText('Numbered when saved')).toBeVisible();
    await expect(form.getByRole('textbox', { name: /^Number/ })).toHaveCount(0);
    await form.getByLabel('Amount').fill(amount);
    await form.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(form).toHaveCount(0);
    // The new invoice is unpaid, so the home table lists it under the next number.
    await expect(scope.getByText(expected, { exact: true })).toBeVisible({ timeout: 10_000 });
  }
  const after = await keptNumbers(page);
  expect(after.length).toBe(before.length + 2);
  expect(new Set(after).size).toBe(after.length);
});
