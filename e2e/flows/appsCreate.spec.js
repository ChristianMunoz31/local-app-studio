// Phase 19 Create button (docs/phase19/DESIGN-phase19.md 3.4): the Apps page opens the start box on demand. Create opens it with the cursor in the
// prompt box, Cancel closes it and puts the focus back on Create, and the empty state has its own Create. A public build has no start box
// (publicBuild.spec.js proves Create opens the Blank app dialog there). Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { createButton, openStartBox } from '../pages/apps.js';
import { skipWithoutPro } from '../support/proBuild.js';

useApp({ seed: true, ollama: 'dead' });

test('Create opens the start box with the cursor in it, and Cancel closes it and returns the focus to Create', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto('/apps');
  await expect(createButton(page)).toBeVisible();
  await expect(page.getByLabel('Your prompt')).toHaveCount(0);
  await openStartBox(page);
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Your prompt')).toHaveCount(0);
  await expect(createButton(page)).toBeFocused();
});

test('the empty state says to press Create and shows a Create button beside Blank app', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto('/apps');
  await expect(page.getByText('No apps yet. Press Create to describe one, or import an app file.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Blank app', exact: true })).toHaveCount(1);
});
