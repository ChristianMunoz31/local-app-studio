// Phase 14 proof flows, the helper fails (DESIGN-phase14.md P-07, P-08).
//   P-07: a model that answers plain text gets "did not give a usable answer", not advice to write less.
//   P-08: a first run that fails on an untouched app, then leaving, removes that empty app and puts the words back in the Apps box.
// Studio API calls (estimate): about 50, well under the 300 per 15 minutes. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { visibleNotice } from '../pages/design.js';
import { listApps } from '../support/critiqueApps.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { openStartBox } from '../pages/apps.js';

const ctx = useApp({
  seed: true,
  ollama: 'fake',
  // Every round is prose, never JSON.
  fakeChat: () => 'Sure! A crew roster sounds like a lovely idea, here is what I would do first.',
});

const IDEA = 'Crew roster for my painting business.';
const USABLE = 'The helper on this computer did not give a usable answer.';

async function makeMyApp(page) {
  await page.goto('/apps');
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill(IDEA);
  await page.getByRole('button', { name: 'Make my app' }).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/);
  await expect(page.getByRole('heading', { name: 'The helper could not make a design' })).toBeVisible({ timeout: 40_000 });
}

test('P-07: a model that answers plain text: the error card says the answer was not usable and never asks for a shorter description', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await makeMyApp(page);
  // The failure is announced by the live announcer, so the card itself is not an alert (no double reading).
  const card = page.getByRole('region', { name: 'The helper could not make a design.' });
  await expect(card).toContainText(USABLE);
  const text = await page.locator('main').innerText();
  expect(text).toContain(USABLE);
  expect(text.toLowerCase()).not.toContain('shorter');
  expect(text).not.toContain('could not generate');
  await expect(page.getByText('Your text is kept.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);
});

test('P-08: the helper fails on a first run, leave to Apps: the empty app is gone and the words are back in the box with the notice', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  // A clean list, so the name the retry gets can be compared with the name that was removed (P-07 left its app here).
  for (const a of await listApps(page.request)) expect((await page.request.delete(`/api/studio/apps/${a.id}`)).ok()).toBe(true);
  const before = 0;
  await makeMyApp(page);
  const firstName = (await listApps(page.request))[0].name;
  expect((await listApps(page.request)).length).toBe(before + 1);

  await page.getByRole('link', { name: 'Back to apps' }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(visibleNotice(page, /Removed the empty app .+\. Your words are back in the box\./)).toBeVisible();
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);
  expect((await listApps(page.request)).length).toBe(before);

  // A retry leaves no numbered twin behind.
  await page.getByRole('button', { name: 'Make my app' }).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/);
  await expect(page.getByRole('heading', { name: 'The helper could not make a design' })).toBeVisible({ timeout: 40_000 });
  expect((await listApps(page.request)).map((a) => a.name)).toEqual([firstName]);
  expect(ctx.server.outbound()).toEqual([]);
});
