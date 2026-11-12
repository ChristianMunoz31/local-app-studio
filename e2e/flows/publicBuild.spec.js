// A public build (APP_PRO_DIR=none, docs/ARCHITECTURE.md 'The pro seam'): the helper and the installer are not in it, and everything else works.
// Prompt and the Apps start card say so in one line and offer the way that works; Design, Data, Preview and Features open; Build says so
// and Export downloads the app file.
//
// Both halves of the run must be public: the page comes from dist/ and the server from APP_PRO_DIR, so
//   APP_PRO_DIR=none npm run build
//   APP_PRO_DIR=none npx playwright test e2e/flows/publicBuild.spec.js --project=flows
// In a pro build this file is skipped with its reason (the @pro specs are its mirror). Nothing leaves this computer.
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { visibleNotice } from '../pages/design.js';
import { PUBLIC_BUILD } from '../support/proBuild.js';
import { useExample, madeFromExample } from '../pages/apps.js';
import { preview } from '../pages/preview.js';

test.skip(!PUBLIC_BUILD, 'a pro build has the helper and the installer, so there is nothing public to prove (run with APP_PRO_DIR=none)');

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const HELPER_LINE = 'The helper is not in this build. Build it yourself in Design.';
const INSTALLER_LINE = 'Making an installer is not in this build. Export the app instead.';
const NAME = 'Public Roster';
const steps = (page) => page.getByRole('navigation', { name: 'Steps' });

test('the Apps start card says the helper is not in this build and its button opens the Blank app dialog', async ({ page }) => {
  await page.goto('/apps');
  await expect(page.getByText(HELPER_LINE)).toBeVisible();
  await expect(page.getByLabel('Your prompt')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Make my app', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Start a blank app instead' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a blank app' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('App name').fill(NAME);
  await dialog.getByRole('button', { name: 'Create app' }).click();
  // The public build starts a new app on Design (startStep in src/studio/lib/steps.ts), the step that works without the helper.
  await expect(page).toHaveURL(/\/apps\/[^/]+\/design$/);
});

test('Create opens the Blank app dialog, with no prompt box, and the helper line stays', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Create', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Start a blank app' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Your prompt')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(HELPER_LINE)).toBeVisible();
});

test('Prompt shows the same line and Build it yourself opens Design', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: NAME }).click();
  // Opening an app lands on Design in this build; the Prompt step is still one click away in the steps.
  await expect(page).toHaveURL(/\/design$/);
  await steps(page).getByRole('link', { name: /Prompt/ }).click();
  await expect(page).toHaveURL(/\/prompt$/);
  await expect(page.getByText(HELPER_LINE)).toBeVisible();
  await expect(page.getByLabel('Your prompt')).toHaveCount(0);

  await page.getByRole('button', { name: 'Build it yourself', exact: true }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(page.getByRole('region', { name: 'Page layout' })).toBeVisible();
  // The page strip that asks the helper for a change is not there.
  await expect(page.getByLabel('Ask the helper to change this page')).toHaveCount(0);
});

test('Design, Data, Preview and Features open and work', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: NAME }).click();

  await steps(page).getByRole('link', { name: /Design/ }).click();
  await expect(page.getByRole('region', { name: 'Page layout' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Page layout' }).getByRole('heading', { name: NAME })).toBeVisible();

  await steps(page).getByRole('link', { name: /Data/ }).click();
  await expect(page).toHaveURL(/\/data$/);
  await page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: 'Add table' }).click();
  await page.getByLabel('Table name').fill('Crews');
  await page.locator('summary', { hasText: 'More options' }).click();
  await page.getByLabel('Inside name', { exact: true }).fill('crews');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: /Crews/ })).toBeVisible();

  await steps(page).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });

  await page.goto('/features');
  await expect(page.getByRole('heading', { level: 3, name: 'Features', exact: true })).toBeVisible();
  await expect(page.getByTestId('feature-tile').first()).toBeVisible();
});

test('Build says an installer is not in this build and Export downloads the app file', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: NAME }).click();
  await steps(page).getByRole('link', { name: /Build/ }).click();
  await expect(page).toHaveURL(/\/build$/);
  await expect(page.getByText(INSTALLER_LINE)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make installer' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Allow downloads for builds' })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${NAME} app.json`);
  await expect(visibleNotice(page, `Exported "${NAME}" as ${NAME} app.json.`)).toBeVisible();
});

test('Use this example works with no helper: Reading List opens on Preview, runs, and a sample book shows', async ({ page }) => {
  const books = JSON.parse(fs.readFileSync(new URL('../../public/examples/reading-list.records.json', import.meta.url), 'utf8')).tables.books;
  await page.goto('/apps');
  await expect(page.getByText(HELPER_LINE)).toBeVisible();
  await useExample(page, 'Reading List');
  await expect(visibleNotice(page, madeFromExample('Reading List'))).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = preview(page).scope;
  await expect(scope).toBeVisible();
  // The home page lists the Reading and Want to read books (the Finished section starts closed).
  const shown = books.filter((b) => b.status !== 'Finished').map((b) => b.title);
  await expect(scope.getByText(shown[0]).first()).toBeVisible({ timeout: 10_000 });
});

test('the helper and the installer routes answer feature_unavailable, and nothing left this computer', async ({ request }) => {
  const describe = await request.post('/api/studio/apps/any/describe', { data: { prompt: 'x' } });
  expect(describe.status()).toBe(403);
  expect((await describe.json()).code).toBe('feature_unavailable');
  const tools = await request.get('/api/studio/build/toolchain');
  expect(tools.status()).toBe(403);
  expect((await tools.json()).feature).toBe('installer');
  expect(ctx.server.outbound()).toEqual([]);
});
