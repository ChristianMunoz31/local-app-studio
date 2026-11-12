// Phase 20: the Examples gallery on the Apps page. Use an example, land on Preview with the sample records in the running app, change them, Reset
// brings the sample back, Design opens the app without connection issues and Export holds the design only. No @pro tag: the gallery, the
// import with sample records and the seeding are open code, so this file runs in a pro build and in a public build alike (docs/phase20/DESIGN-phase20.md, section 6.1).
// Sample text is read from the example's own records.json at test time, never typed here.
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { visibleNotice, design } from '../pages/design.js';
import { preview } from '../pages/preview.js';
import { appsRegion, examplesCard, exampleCard, useExample, useExampleButton, madeFromExample } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const EXAMPLE = 'Crew Board';
const EXAMPLE_NAMES = [
  'Crew Board',
  'Job Tracker',
  'Invoices and Clients',
  'Inventory',
  'Appointments',
  'Expense Log',
  'Membership and Attendance',
  'Reading List',
];
const records = (slug) => JSON.parse(fs.readFileSync(new URL(`../../public/examples/${slug}.records.json`, import.meta.url), 'utf8'));
const FIRST_PERSON = records('crew-board').tables.people[0].name;
const ADDED = 'Zed Testperson';
const SPEC_KEYS = ['specVersion', 'app', 'tables', 'pages', 'nav', 'theme', 'menu'];

let appId = '';

test('the Examples card lists eight cards, each with one Use this example, and none of them is in the Apps grid', async ({ page }) => {
  await page.goto('/apps');
  const gallery = examplesCard(page);
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole('listitem')).toHaveCount(8);
  await expect(gallery.getByRole('button', { name: /^Use this example/ })).toHaveCount(8);
  await expect(gallery.getByRole('link')).toHaveCount(0);
  for (const name of EXAMPLE_NAMES) {
    await expect(exampleCard(page, name)).toHaveCount(1);
    await expect(exampleCard(page, name).getByRole('button')).toHaveCount(1);
    await expect(useExampleButton(page, name)).toBeVisible();
  }
  // Examples are not apps: nothing in the Apps region carries an example name, and the empty state points at the gallery.
  const apps = appsRegion(page);
  await expect(apps).toBeVisible();
  await expect(apps.getByRole('listitem')).toHaveCount(0);
  for (const name of EXAMPLE_NAMES) await expect(apps.getByRole('link', { name })).toHaveCount(0);
  await expect(apps.getByText(/Or open an example below\./)).toBeVisible();
});

test('Use this example makes the app, lands on Preview with the notice, and the sample records show in the running app', async ({ page }) => {
  await page.goto('/apps');
  appId = await useExample(page, EXAMPLE);
  await expect(visibleNotice(page, madeFromExample(EXAMPLE))).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = preview(page).scope;
  await expect(scope).toBeVisible();
  await expect(scope.getByText(FIRST_PERSON).first()).toBeVisible({ timeout: 10_000 });
  expect(ctx.server.outbound()).toEqual([]);
});

test('a row added in Preview shows, and Reset preview data removes it and brings the sample row back', async ({ page }) => {
  const p = preview(page);
  await page.goto(`/apps/${appId}/preview`);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = p.scope;
  await expect(scope.getByText(FIRST_PERSON).first()).toBeVisible({ timeout: 10_000 });

  await scope.getByRole('button', { name: 'Add person', exact: true }).click();
  // "Add person" opens the app's form dialog (Modal, role dialog, titled "Add to <table label>").
  const form = page.getByRole('dialog', { name: 'Add to People' });
  await expect(form).toBeVisible();
  await form.getByLabel('Name').fill(ADDED);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(scope.getByText(ADDED).first()).toBeVisible({ timeout: 10_000 });

  await p.reset();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(p.note()).toContainText('Preview data was reset. The sample records are back.', { timeout: 10_000 });
  await expect(scope.getByText(FIRST_PERSON).first()).toBeVisible({ timeout: 10_000 });
  await expect(scope.getByText(ADDED)).toHaveCount(0);
});

test('Design opens the made app with no connection issues', async ({ page }) => {
  await page.goto(`/apps/${appId}/design`);
  const d = design(page);
  await expect(d.canvas).toBeVisible();
  await expect(d.canvas.getByRole('heading', { name: 'People' }).first()).toBeVisible();
  await expect(page.locator('[data-not-connected]')).toHaveCount(0);
  await expect(d.connections().getByRole('button', { name: 'Connect' })).toHaveCount(0);
});

test('Export downloads the app file with the design only, no sample records', async ({ page }) => {
  await page.goto('/apps');
  const card = appsRegion(page).getByRole('listitem').filter({ hasText: EXAMPLE });
  await card.getByRole('button', { name: `More actions for ${EXAMPLE}` }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${EXAMPLE} app.json`);
  const body = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
  expect(Object.keys(body).every((key) => SPEC_KEYS.includes(key))).toBe(true);
  expect(body.specVersion).toBe(1);
  expect(body.app.name).toBe(EXAMPLE);
  expect(JSON.stringify(body)).not.toContain(FIRST_PERSON);
  expect(body).not.toHaveProperty('sample');
  expect(body).not.toHaveProperty('records');
  await expect(visibleNotice(page, `Exported "${EXAMPLE}" as ${EXAMPLE} app.json.`)).toBeVisible({ timeout: 5_000 });
});

test('using the same example again makes it apart as Crew Board 2, with its own notice', async ({ page }) => {
  await page.goto('/apps');
  await useExample(page, EXAMPLE);
  await expect(visibleNotice(page, madeFromExample('Crew Board 2'))).toBeVisible({ timeout: 5_000 });
  await page.goto('/apps');
  await expect(appsRegion(page).getByRole('link', { name: 'Crew Board 2', exact: true })).toBeVisible();
  await expect(appsRegion(page).getByRole('link', { name: EXAMPLE, exact: true })).toBeVisible();
  await expect(examplesCard(page).getByRole('listitem')).toHaveCount(8);
});
