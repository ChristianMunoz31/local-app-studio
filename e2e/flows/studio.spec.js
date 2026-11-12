// Studio: create an app, shape its data, open it in Design, run the preview, and delete it.
import { test, expect, useApp } from '../support/fixtures.js';
import { LANDING_STEP, createBlankApp, expectLanding } from '../pages/apps.js';

useApp({ seed: true, ollama: 'fake' });

test.describe.configure({ mode: 'serial' });

test('the menu links to Apps and a new app lands on its first step (Prompt, or Design in a public build)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /menu/i }).first().click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Apps' }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.getByText('No apps yet.')).toBeVisible();

  await createBlankApp(page, 'Crew Roster');
  await expectLanding(page);
  await expect(page.getByRole('heading', { name: 'Crew Roster' }).first()).toBeVisible();

  // The old /describe link goes to Prompt.
  const appId = new RegExp(`/apps/([^/]+)/${LANDING_STEP}$`).exec(page.url())[1];
  await page.goto(`/apps/${appId}/describe`);
  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/);
  await expect(page.getByRole('heading', { level: 3, name: 'Prompt', exact: true })).toBeVisible();
});

test('the Data tab adds a table and the save survives a reload', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Data/ }).click();
  await expect(page).toHaveURL(/\/data$/);

  // The tables list and the empty state both offer Add table: use the list's.
  await page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: 'Add table' }).click();
  await page.getByLabel('Table name').fill('Crews');
  // The inside name lives under More options and does not follow the label, so set both: the preview checks /api/preview/data/crews.
  await page.locator('summary', { hasText: 'More options' }).click();
  await page.getByLabel('Inside name', { exact: true }).fill('crews');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: /Crews/ })).toBeVisible();
});

test('the Design tab opens the canvas with the home page, and Save waits for an edit', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(page.getByRole('region', { name: 'Page layout' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next: Data' })).toBeEnabled();
  // The canvas draws the page itself, not an iframe.
  await expect(page.getByRole('region', { name: 'Page layout' }).getByRole('heading', { name: 'Crew Roster' })).toBeVisible();
});

test('the Preview tab starts by itself, stops from Preview options, and the proxy answers 409 when it is stopped', async ({ page, request, baseURL }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: 'Preview' }).click();

  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  // The workspace header and the card title are headings too; the app's own heading comes last.
  await expect(page.getByRole('heading', { name: 'Crew Roster' }).last()).toBeVisible();
  const live = await request.get(`${baseURL}/api/preview/data/crews`);
  expect(live.status()).not.toBe(409);

  await page.getByText('Preview options').click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('The preview is stopped.')).toBeVisible();
  const stopped = await request.get(`${baseURL}/api/preview/data/crews`);
  expect(stopped.status()).toBe(409);
  expect((await stopped.json()).code).toBe('preview_not_running');
});

test('the Apps page deletes an app after the confirm dialog', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'More actions for Crew Roster' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete app' }).click();
  await expect(page.getByRole('link', { name: 'Crew Roster' })).toHaveCount(0);
  await expect(page.getByText('No apps yet.')).toBeVisible();
});
