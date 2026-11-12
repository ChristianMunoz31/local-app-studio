// Proof flow J5 (DESIGN-phase12.md 2.9, WP-5): when something goes wrong the screen says what happened in plain words and offers
// the next action. Helper off, a broken import file, a part that is not connected, leaving Design with and without a savable
// draft, and a preview that cannot start. Counted where 2.9 asserts a number. Nothing leaves this computer.
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { design } from '../pages/design.js';
import { journey, NEVER_SHOWN } from '../pages/journey.js';
import { preview } from '../pages/preview.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { openStartBox } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

// Not serial: a failing J5 case must not hide the ones after it. Each case that needs the Crew Roster app finds it or imports it.

const crewRoster = () => JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));
const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
const appCount = async (page) => (await (await page.request.get('/api/studio/apps')).json()).data.length;
const expectPlainWords = async (page, where) => {
  const text = await page.locator('main').innerText();
  expect(text.match(NEVER_SHOWN), `a word that is never shown, on ${where}`).toBeNull();
};
/** The id of the Crew Roster app, imported on first use (a worker restart after a failure starts a fresh server). */
async function crewId(page) {
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  const found = list.find((a) => a.name === 'Crew Roster');
  if (found) return found.id;
  const imported = await page.request.post('/api/studio/apps/import', { data: { spec: crewRoster() } });
  expect(imported.status()).toBe(201);
  return (await imported.json()).data.id;
}

/** Runs the preview, stops it, puts text where its database is and presses Start preview: the server answers 503 and remembers the failure. */
async function breakPreview(page, appId) {
  // An earlier case of this file may have left this app's database broken on the shared server: clear it, so the first start below works.
  const cleared = await page.request.post('/api/studio/preview/reset', { data: { appId, confirm: 'reset' } });
  expect(cleared.ok()).toBe(true);
  // A first start builds a fresh database, so run the preview first. The -wal and -shm files would otherwise carry the real pages.
  const p = preview(page);
  await p.open('Crew Roster');
  await p.stop();
  const dbFile = ctx.server.previewDbFile(appId);
  fs.writeFileSync(dbFile, 'this is not a database');
  for (const extra of ['-wal', '-shm']) fs.rmSync(`${dbFile}${extra}`, { force: true });
  // The server answers the failed start with a 503; Chrome logs that as a console error.
  test.info().annotations.push({ type: 'allow-console-errors' });
  await page.getByRole('button', { name: 'Start preview', exact: true }).click();
  await expect(page.getByText('The preview could not start.').first()).toBeVisible({ timeout: 30_000 });
}

test('J5: Make my app with the helper off makes no app, explains, and offers a blank app in 1 action', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  const j = journey(page);
  await page.goto('/apps');
  expect(await appCount(page)).toBe(0);
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill('Crew roster for my painting business.');
  await page.getByRole('button', { name: 'Make my app' }).click();

  await expect(page.getByRole('heading', { name: 'Set up the helper (Ollama)' })).toBeVisible();
  await expect(page.getByLabel('Your prompt')).toHaveValue('Crew roster for my painting business.');
  // No app was made, and the page did not move.
  await expect(page).toHaveURL(/\/apps$/);
  expect(await appCount(page)).toBe(0);
  await expect(page.getByRole('list').getByRole('link')).toHaveCount(0);
  await expectPlainWords(page, 'Apps with the helper off');

  await j.click(page.getByRole('button', { name: 'Start a blank app instead' }));
  const dialog = page.getByRole('dialog', { name: 'Start a blank app' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('App name')).not.toHaveValue('');
  expect(j.counts().actions, j.trail()).toBe(1);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await appCount(page)).toBe(0);
});

test('J5: a file that is not an app says so in plain words and imports nothing', async ({ page }) => {
  await page.goto('/apps');
  await page.getByTestId('import-file').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ hello: 'world' })) });
  const dialog = page.getByRole('dialog', { name: 'This file cannot be imported' });
  await expect(dialog).toBeVisible();
  const text = await dialog.innerText();
  expect(text).toContain('This is not an app file from Local App Studio, or it was changed by hand. Nothing was imported.');
  for (const raw of ['specVersion', 'app.name', 'Invalid input']) expect(text, `the dialog text shows "${raw}"`).not.toContain(raw);
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  expect(await appCount(page)).toBe(0);
});

test('J5: a part that is not connected is explained in words, blocks Save, and the connections list stays quiet', async ({ page }) => {
  await crewId(page);
  const d = design(page);
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await expect(d.canvas).toBeVisible();

  // Page actions > Add a page, then a Table of records on it. Two tables exist, so nothing connects by itself.
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Add a page' }).click();
  await page.getByLabel('Page title').fill('Archive');
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue(/archive/);
  const first = (await d.order())[0];
  await d.block(first).focus();
  await d.addAt('Add here: Page, place 2', 'Table of records');

  await expect(page.getByText('has no source')).toHaveCount(0);
  // The open page's own part is not a row of the connections list; the list shows only Fix all.
  await expect(d.connections().getByRole('listitem')).toHaveCount(0);
  await expect(d.connections().getByRole('button', { name: 'Fix all' })).toBeVisible();
  await expect(page.getByText('Needs a table', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.getByText('Connect the parts that need a table, or delete them, to save.').first()).toBeVisible();
  await expectPlainWords(page, 'Design with a part that is not connected');

  // Leaving with this draft cannot save it: the dialog says why and offers Discard changes or Stay.
  await steps(page).getByRole('link', { name: /Data/ }).click();
  const stuck = page.getByRole('alertdialog', { name: 'Your changes on Design cannot be saved yet' });
  await expect(stuck).toBeVisible();
  await expect(stuck.getByRole('button', { name: 'Discard changes' })).toBeVisible();
  await stuck.getByRole('button', { name: 'Stay' }).click();
  await expect(stuck).toHaveCount(0);
  await expect(page).toHaveURL(/\/design$/);
  await expect(d.canvas).toBeVisible();
});

test('J5: leaving Design with changes that can be saved saves them in 1 action', async ({ page }) => {
  const appId = await crewId(page);
  const j = journey(page);
  const d = design(page);
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await expect(d.canvas).toBeVisible();

  // A heading edit is a valid draft (set up outside the count, like the other flows' set-up).
  const dialog = await d.openSettings('Heading');
  await dialog.getByLabel('Text', { exact: true }).fill('Crews that are open');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(d.canvas.getByRole('heading', { name: 'Crews that are open' })).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes on Design');

  await j.click(steps(page).getByRole('link', { name: /Data/ }));
  await expect(page).toHaveURL(/\/data$/);
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(j.counts().actions, j.trail()).toBe(1);

  const stored = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.spec;
  expect(JSON.stringify(stored.pages[0].layout)).toContain('Crews that are open');
});

test('J5: browser Back from Design with a valid change saves it, says so, and Forward comes back to it', async ({ page }) => {
  const appId = await crewId(page);
  const d = design(page);
  await d.open('Crew Roster');
  // Two steps of history to go back through: Data, then Design again.
  await steps(page).getByRole('link', { name: /Data/ }).click();
  await expect(page).toHaveURL(/\/data$/);
  await steps(page).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(d.canvas).toBeVisible();

  const dialog = await d.openSettings('Heading');
  await dialog.getByLabel('Text', { exact: true }).fill('Crews after Back');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(d.canvas.getByRole('heading', { name: 'Crews after Back' })).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes on Design');

  await page.goBack();
  await expect(page).toHaveURL(/\/data$/);
  // Back goes through the save gate now: the move saves first, then says which step it saved.
  await expect(page.getByTestId('detached-announcer')).toHaveText('Saved your changes on Design.');
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const stored = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.spec;
  expect(JSON.stringify(stored.pages[0].layout)).toContain('Crews after Back');

  // Forward still works, and Design shows the saved change.
  await page.goForward();
  await expect(page).toHaveURL(/\/design$/);
  await expect(d.canvas.getByRole('heading', { name: 'Crews after Back' })).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
});

test('J5: a preview that cannot start is named once and never also called stopped', async ({ page }) => {
  await breakPreview(page, await crewId(page));
  // DESIGN-phase12.md 2.9 J5: one line says it could not start, and nothing says the preview is stopped.
  await expect.soft(page.getByText('The preview is stopped.')).toHaveCount(0);
  await expect.soft(page.getByText(/could not start/)).toHaveCount(1);
  await expectPlainWords(page, 'a preview that could not start');
});

test('J5: Reset preview data brings a preview that cannot start back in 2 actions', async ({ page }) => {
  const appId = await crewId(page);
  await breakPreview(page, appId);
  const j = journey(page);
  // Arrive on Preview again: the server remembers the failed start.
  await page.reload();
  await expect(page.getByText('The preview could not start.').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('The preview is stopped.')).toHaveCount(0);
  // One sentence, said once.
  await expect.soft(page.getByText(/could not start/)).toHaveCount(1);

  await j.click(page.getByRole('button', { name: 'Reset preview data', exact: true }));
  const confirm = page.getByRole('alertdialog', { name: 'Reset preview data?' });
  await expect(confirm).toBeVisible();
  await j.click(confirm.getByRole('button', { name: 'Reset preview data', exact: true }));
  // 2.9: after the reset the app is running. (Soft, so a missed target still reports how many actions it really took.)
  const running = page.getByText('Your app is running.');
  await expect.soft(running, 'the app runs after Reset preview data and its confirm').toBeVisible({ timeout: 30_000 });
  const tryAgain = page.getByRole('button', { name: 'Try again', exact: true });
  if (!(await running.isVisible()) && (await tryAgain.isVisible())) {
    await j.click(tryAgain);
    await expect(running).toBeVisible({ timeout: 30_000 });
  }
  expect(j.counts().actions, j.trail()).toBe(2);
  expect(ctx.server.outbound()).toEqual([]);
});
