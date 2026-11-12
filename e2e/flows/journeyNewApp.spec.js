// Proof flow J1 (DESIGN-phase12.md 2.9, WP-5): first idea to the running app and on to Build, counted. J1 uses the pointer and
// asserts the click budget; J1K does the same by keyboard only and asserts the key budget. A third test checks the light defaults.
// Nothing leaves this computer.
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { describeFakeChat } from '../support/describeFake.js';
import { design } from '../pages/design.js';
import { journey, NEVER_SHOWN } from '../pages/journey.js';
import { LANDING_STEP, createBlankApp, createButton, expectLanding, openStartBox } from '../pages/apps.js';
import { skipWithoutPro } from '../support/proBuild.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: describeFakeChat });

test.describe.configure({ mode: 'serial' });

const IDEA = 'Crew roster for my painting business.';
const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
const stepHeading = (page, name) => page.getByRole('heading', { level: 3, name, exact: true });
/** The heading of the review pane on the Prompt step (an h3 like the step heading, so the name tells them apart). */
const paneHeading = (page, name) => page.getByRole('heading', { level: 3, name, exact: true });
const announcer = (page, text) => page.getByRole('status').filter({ hasText: text });
/** No glossary "never shown" word in the Studio text of the screen (the running app is the person's own content). */
const expectPlainWords = async (page, where) => {
  const text = await page.locator('main').innerText();
  expect(text.match(NEVER_SHOWN), `a word that is never shown, on ${where}`).toBeNull();
};

test('J1: an idea becomes a running app and the Build screen in 5 actions from Apps', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper and the installer are not in a public build');
  const j = journey(page);
  await page.goto('/apps');
  await expectPlainWords(page, 'Apps');

  // Create opens the start box (the Phase 19 button): one more action than before.
  await openStartBox(page, (l) => j.click(l));
  await j.fill(page.getByLabel('Your prompt'), IDEA);
  await j.click(page.getByRole('button', { name: 'Make my app' }));

  // The helper's design shows beside the box on Prompt by itself; the review pane heading takes the focus and the arrival is announced once.
  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/, { timeout: 30_000 });
  await expect(paneHeading(page, 'What the helper made')).toBeFocused();
  await expect(announcer(page, 'The helper made a design. Check it, then press Use this.')).toContainText('The helper made a design. Check it, then press Use this.');
  await expect(page.getByTestId('save-status')).toHaveText("The helper's design is not used yet.");
  await expect(steps(page).getByRole('link', { name: /Prompt/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByText('You asked for:')).toBeVisible();
  await expectPlainWords(page, 'Prompt');

  await j.click(page.getByRole('button', { name: 'Use this and try it' }));
  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('preview-theme-scope')).toHaveAttribute('data-theme-mode', 'light');
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  for (const name of ['Prompt', 'Design', 'Data']) {
    await expect(steps(page).getByRole('link', { name: new RegExp(name) })).toContainText('(done)');
  }
  // The helper's first design (the fake one) has one table (Crews) and no Form, so Preview names it and says how to add records.
  await expect(page.getByText('Crews has no way to add records yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a form in Design' })).toBeVisible();
  await expectPlainWords(page, 'Preview');

  const toRunning = j.counts().actions;
  await j.click(page.getByRole('button', { name: 'Next: Build' }));
  await expect(page).toHaveURL(/\/build$/);
  await expect(page.getByText('Build tools').first()).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Allow downloads for builds' })).toBeVisible();
  await expectPlainWords(page, 'Build');

  // Idea to the running app: Create, fill, Make my app, Use this and try it (4). Idea to Build: 5. The Create press is the Phase 19 button
  // that opens the start box; the targets were 3 and 4 before it.
  const note = `J1 actions from Apps: ${toRunning} to the running app (target 4), ${j.counts().actions} to Build (target 5)`;
  test.info().annotations.push({ type: 'measured', description: note });
  expect(toRunning, note).toBeLessThanOrEqual(4);
  expect(j.counts().actions, `${note}\n${j.trail()}`).toBeLessThanOrEqual(5);
});

test('J1K: the same journey by keyboard only, focus on the step heading after every move, 18 keys or fewer from Apps', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper and the installer are not in a public build');
  const j = journey(page);
  /** Presses a key until the target has the focus, counting every press; fails past `max`. */
  const keyTo = async (target, max, key = 'Tab') => {
    for (let n = 0; n < max; n += 1) {
      if (await target.evaluate((el) => el === document.activeElement)) return n;
      await j.press(key);
    }
    await expect(target).toBeFocused();
    return max;
  };

  await page.goto('/apps');

  // Create is the first stop of the Apps card; Enter opens the start box with the cursor in it, so the box costs no more keys.
  const toBox = await keyTo(createButton(page), 12);
  await j.press('Enter');
  await expect(page.getByLabel('Your prompt')).toBeFocused();
  await j.typeText(IDEA);
  await keyTo(page.getByRole('button', { name: 'Make my app' }), 2);
  await j.press('Enter');

  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/, { timeout: 30_000 });
  await expect(paneHeading(page, 'What the helper made')).toBeFocused();
  const toUse = await keyTo(page.getByRole('button', { name: 'Use this and try it' }), 2);
  expect(toUse).toBeLessThanOrEqual(2);
  await j.press('Enter');

  await expect(page).toHaveURL(/\/preview$/);
  await expect(stepHeading(page, 'Preview')).toBeFocused();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  // Next: Build is in the rail, just before the step heading.
  await keyTo(page.getByRole('button', { name: 'Next: Build' }), 2, 'Shift+Tab');
  await j.press('Enter');
  await expect(page).toHaveURL(/\/build$/);
  await expect(stepHeading(page, 'Build')).toBeFocused();

  const note = `J1K keys from Apps to Build: ${j.counts().keys} (Tabs to reach the box: ${toBox}); target 18`;
  test.info().annotations.push({ type: 'measured', description: note });
  expect(j.counts().keys, `${note}\n${j.trail()}`).toBeLessThanOrEqual(18);
});

test('a new Blank app starts plain (pearl, no glow), and a Classic-themed app previews in light', async ({ page }) => {
  await page.goto('/apps');
  await createBlankApp(page, 'Plain Check');
  await expectLanding(page);
  const appId = new RegExp(`/apps/([^/]+)/${LANDING_STEP}$`).exec(page.url())[1];

  // The app is made, then saved once with the plain look (no theme id, solid background); wait until that save is in.
  await expect
    .poll(async () => (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.spec.theme)
    .toEqual({ preset: 'solid', radius: 'md' });

  await steps(page).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  const canvas = page.getByTestId('design-canvas');
  await expect(canvas).toHaveAttribute('data-theme-mode', 'light');
  // A blank sheet: pearl and no gradient (the starter page has a heading, so the empty-page hint is covered in DesignTab.test.tsx).
  await expect(canvas).toHaveCSS('background-color', 'rgb(251, 249, 246)');
  await expect(canvas).toHaveCSS('background-image', 'none');

  // The same pearl in Preview: add a table, save, and run the app.
  await page.getByRole('button', { name: 'Add Table of records' }).click();
  await design(page).newTable('datatable_1', 'Crews');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  await page.goto(`/apps/${appId}/preview`);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = page.getByTestId('preview-theme-scope');
  await expect(scope).toHaveAttribute('data-theme-mode', 'light');
  await expect(scope).toHaveCSS('background-color', 'rgb(251, 249, 246)');
  await expect(scope).toHaveCSS('background-image', 'none');

  // The Classic case (a theme with no id): an app file from before the themes, imported.
  const classicSpec = JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));
  expect(classicSpec.theme.id).toBeUndefined();
  const imported = await page.request.post('/api/studio/apps/import', { data: { spec: classicSpec } });
  expect(imported.status()).toBe(201);
  const made = (await imported.json()).data;
  await page.goto(`/apps/${made.id}/preview`);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('preview-theme-scope')).toHaveAttribute('data-theme-mode', 'light');
});

test('nothing left this computer', async () => {
  expect(ctx.server.outbound()).toEqual([]);
});
