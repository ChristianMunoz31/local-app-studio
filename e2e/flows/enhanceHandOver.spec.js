// Enhancement proof P-12 (DESIGN-phase14.md): after a failed helper run, "Build it yourself, starting with tables on Data" lands on Data.
// The fake helper answers every step with plain text, so the run fails the way a small local model can.
import { test, expect, useApp } from '../support/fixtures.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { openStartBox } from '../pages/apps.js';

useApp({ seed: true, ollama: 'fake', fakeChat: () => 'Sorry, I can only answer in plain sentences.' });

test('P-12: after a failed helper run, "Build it yourself, starting with tables on Data" lands on Data', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto('/apps');
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill('An app to track equipment loans for my tool rental shop: items, people and loans with a due date.');
  await page.getByRole('button', { name: 'Make my app' }).click();

  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/);
  // The person's copy is the heading; the hidden live region repeats the sentence a moment later (docs/DESIGN.md).
  await expect(page.getByRole('heading', { level: 3, name: 'The helper could not make a design.' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Your text is kept.')).toBeVisible();

  const toData = page.getByRole('button', { name: 'No helper? Build it yourself, starting with tables on Data' });
  await expect(toData).toBeVisible();
  await toData.click();

  await expect(page).toHaveURL(/\/apps\/[^/]+\/data$/);
  await expect(page.getByRole('heading', { level: 3, name: 'Data', exact: true })).toBeFocused();
  await expect(page.getByText('No tables yet. Add one to keep information in your app.')).toBeVisible();
});
