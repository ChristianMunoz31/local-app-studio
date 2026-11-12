// Phase 17 proof, the waiting design (DESIGN-phase17.md P17-01): the helper's design, its prompt and its asks live with the app on
// the server, so a closed browser, a new profile or another window finds the review again. The Apps card says a design is waiting,
// and Use this clears it. Nothing leaves this computer. Studio API calls (estimate): about 60.
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { openWindow } from '../support/twoContexts.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { appCards, openStartBox } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });

test.describe.configure({ mode: 'serial' });

const IDEA = 'Crew roster for my painting business.';
const paneHeading = (page, name) => page.getByRole('heading', { level: 3, name, exact: true });
const button = (page, name) => page.getByRole('button', { name, exact: true });

let appId = '';
let appName = '';

test('make a design, close the browser context, open a new one: the review, the words and the Apps card are back', { tag: '@pro' }, async ({ browser }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  const first = await openWindow(browser, ctx.server);
  const page = first.page;
  await page.goto('/apps');
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill(IDEA);
  await button(page, 'Make my app').click();
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });
  appId = /\/apps\/([^/]+)\/prompt$/.exec(page.url())[1];
  appName = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.name;
  await expect(button(page, 'Use this')).toBeVisible();

  // The browser goes away with its storage: a brand new context has nothing but the server.
  expect(first.consoleErrors).toEqual([]);
  await first.close();
  const win = await openWindow(browser, ctx.server);
  try {
    const fresh = win.page;
    await fresh.goto(`/apps/${appId}/prompt`);
    await expect(paneHeading(fresh, 'What the helper made')).toBeVisible({ timeout: 30_000 });
    await expect(button(fresh, 'Use this')).toBeVisible();
    await expect(button(fresh, 'Try again')).toBeVisible();
    await expect(fresh.getByLabel('Ask for a change')).toBeVisible();
    await expect(button(fresh, 'Ask')).toBeVisible();
    // The prompt words are back in the box, and nothing says "Nothing to check yet".
    await expect(fresh.getByLabel('Your prompt')).toHaveValue(IDEA);
    await expect(fresh.getByText('Nothing to check yet')).toHaveCount(0);
    await expect(fresh.getByText('You asked for:')).toBeVisible();

    // The Apps card says so too, in another browser as well.
    await fresh.goto('/apps');
    const card = appCards(fresh).filter({ hasText: appName });
    await expect(card).toContainText('A design is waiting: 1 table, 2 pages.');
    expect(win.consoleErrors).toEqual([]);
    expect(win.blocked).toEqual([]);
  } finally {
    await win.close();
  }
  expect(ctx.server.outbound()).toEqual([]);
});

test('Use this clears the waiting design: reopening shows no waiting design and the card no longer says one waits', { tag: '@pro' }, async ({ browser }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  const win = await openWindow(browser, ctx.server);
  try {
    const p = win.page;
    await p.goto(`/apps/${appId}/prompt`);
    await expect(paneHeading(p, 'What the helper made')).toBeVisible({ timeout: 30_000 });
    await button(p, 'Use this').click();
    await expect(p).toHaveURL(/\/design$/);
    await expect(p.getByTestId('save-status')).toHaveText('All changes saved');

    // Server side: nothing waits.
    const waiting = await p.request.get(`/api/studio/apps/${appId}/waiting`);
    const body = await waiting.json();
    expect(body.data).toBeNull();

    // A third window: the saved app, not a review of a waiting design.
    const other = await openWindow(browser, ctx.server);
    try {
      await other.page.goto(`/apps/${appId}/prompt`);
      await expect(paneHeading(other.page, 'Your app')).toBeVisible({ timeout: 30_000 });
      await expect(paneHeading(other.page, 'What the helper made')).toHaveCount(0);
      await expect(button(other.page, 'Use this')).toHaveCount(0);
      await other.page.goto('/apps');
      const card = appCards(other.page).filter({ hasText: appName });
      await expect(card).toBeVisible();
      await expect(card).not.toContainText('A design is waiting');
      await expect(card).toContainText('1 table, 2 pages');
    } finally {
      await other.close();
    }
  } finally {
    await win.close();
  }
  expect(ctx.server.outbound()).toEqual([]);
});
