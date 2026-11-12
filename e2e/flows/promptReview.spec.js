// The merged Prompt step (DESIGN-phase16.md 1 and 5.1): the prompt box on the left and the review of what the helper made on the
// right. Covers the empty right pane, the two layouts (side by side at 1280, stacked at 800), the run that keeps the address on
// Prompt, focus and the announcement, the bullets (plain words only), Show everything, Ask for a change in a waiting design and
// in a saved app, the old /review addresses, and the five-step rail. Nothing leaves this computer.
// Studio API calls (estimate): about 90 (page loads and their polls, two app creates, one design run and its re-runs, one save,
// the spec reads), well under the 300 per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { describeFakeChat } from '../support/describeFake.js';
import { importCrewRoster, makeApp } from '../support/critiqueApps.js';
import { NEVER_SHOWN } from '../pages/journey.js';
import { skipWithoutPro } from '../support/proBuild.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: describeFakeChat });

test.describe.configure({ mode: 'serial' });

const IDEA = 'Crew roster for my painting business.';
const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
/** The announcer region the workspace speaks through (the one that is not the "Working on" line). */
const announcer = (page, text) => page.getByRole('status').filter({ hasText: text });
const paneHeading = (page, name) => page.getByRole('heading', { level: 3, name, exact: true });
/** The left pane (a region named Prompt) and the right pane (a region named by its heading). */
const promptPane = (page) => page.getByRole('region', { name: 'Prompt', exact: true });
const reviewPane = (page, heading) => page.getByRole('region', { name: heading, exact: true });

let appId = '';
let appPath = '';

test('a new app: the right pane says there is nothing to check yet, side by side at 1280 and stacked at 800', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  const made = await makeApp(page.request, 'Pane Check', () => {});
  appId = made.id;
  appPath = `/apps/${appId}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${appPath}/prompt`);

  await expect(paneHeading(page, 'Nothing to check yet')).toBeVisible();
  await expect(page.getByText("Write your prompt and the helper's design shows here.")).toBeVisible();
  await expect(page.getByLabel('Your prompt')).toBeVisible();
  // Nothing to ask about yet: no Ask box and no bullets.
  await expect(page.getByLabel('Ask for a change')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(0);

  const left = await promptPane(page).boundingBox();
  const right = await reviewPane(page, 'Nothing to check yet').boundingBox();
  expect(left, 'the prompt pane is laid out').not.toBeNull();
  expect(right, 'the review pane is laid out').not.toBeNull();
  // Side by side: the review starts to the right of where the prompt ends, and the tops are level.
  expect(right.x, `review left ${right.x} vs prompt right ${left.x + left.width}`).toBeGreaterThanOrEqual(left.x + left.width - 1);
  expect(Math.abs(right.y - left.y), 'the panes start at the same height').toBeLessThan(40);

  await page.setViewportSize({ width: 800, height: 900 });
  const topLeft = await promptPane(page).boundingBox();
  const topRight = await reviewPane(page, 'Nothing to check yet').boundingBox();
  // Stacked: the review is below the prompt, and neither pane sticks out sideways.
  expect(topRight.y, `review top ${topRight.y} vs prompt bottom ${topLeft.y + topLeft.height}`).toBeGreaterThanOrEqual(topLeft.y + topLeft.height - 1);
  expect(topRight.x + topRight.width).toBeLessThanOrEqual(800 + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Make my app keeps the address on Prompt, focuses the review heading, announces it and shows plain bullets', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${appPath}/prompt`);
  await page.getByLabel('Your prompt').fill(IDEA);
  await page.getByRole('button', { name: 'Make my app' }).click();

  const review = reviewPane(page, 'What the helper made');
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/prompt$/);
  await expect(paneHeading(page, 'What the helper made')).toBeFocused();
  await expect(announcer(page, 'The helper made a design. Check it, then press Use this.')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText("The helper's design is not used yet.");
  await expect(review.getByText('You asked for:')).toBeVisible();

  // The bullets: a lead, a line per table with its fields, a line per page.
  await expect(review.getByRole('list', { name: 'Tables' }).getByRole('listitem').filter({ hasText: /^Crews: Name, Status/ })).toHaveCount(1);
  await expect(review.getByRole('list', { name: 'Pages' }).getByRole('listitem').filter({ hasText: /^Home (shows|has) / })).toHaveCount(1);
  // No code word is on the pane, with the fold closed or open.
  const closed = await review.innerText();
  expect(closed.match(NEVER_SHOWN), 'a word that is never shown, in the review pane').toBeNull();

  // Show everything holds the full summary; closed, its headings are hidden.
  await expect(review.getByRole('heading', { name: 'Tables', exact: true })).toBeHidden();
  await review.getByText('Show everything', { exact: true }).click();
  await expect(review.getByRole('heading', { name: 'Tables', exact: true })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Fields', exact: true })).toBeVisible();
  const open = await review.innerText();
  expect(open.match(NEVER_SHOWN), 'a word that is never shown, in Show everything').toBeNull();
  await expect(page).toHaveURL(/\/prompt$/);
});

test('Ask for a change in a waiting design refines that design with the new words only, without leaving the step', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto(`${appPath}/prompt`);
  // The design the earlier test left waiting is kept on the server (P17-01): a fresh browser finds its words in the box. Wait for
  // them, then type the same words again (filling the box while it is being filled from the server would append to it).
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);
  await page.getByLabel('Your prompt').fill(IDEA);
  await page.getByRole('button', { name: 'Make my app' }).click();
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });

  const words = 'Add a phone number to each crew.';
  const ask = page.getByLabel('Ask for a change');
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
  await ask.fill(words);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();

  // The left box keeps the first prompt, the pane quotes the newest ask only, and a design waits again on the same address.
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);
  await expect(page.locator('q', { hasText: words })).toBeVisible();
  await expect(page.locator('q', { hasText: `${IDEA} ${words}` })).toHaveCount(0);
  await expect(page.getByLabel('Ask for a change')).toHaveValue('');
  await expect(page).toHaveURL(/\/prompt$/);
});

test('Use this saves the design, and the saved app shows Your app with an Ask box that asks for a change on the same step', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto(`${appPath}/prompt`);
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);
  await page.getByLabel('Your prompt').fill(IDEA);
  await page.getByRole('button', { name: 'Make my app' }).click();
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Use this', exact: true }).click();
  await expect(page).toHaveURL(/\/design$/);

  await steps(page).getByRole('link', { name: /Prompt/ }).click();
  await expect(page).toHaveURL(/\/prompt$/);
  const review = reviewPane(page, 'Your app');
  await expect(review).toBeVisible();
  await expect(review.getByRole('list', { name: 'Tables' }).getByRole('listitem').filter({ hasText: /^Crews: Name, Status/ })).toHaveCount(1);
  expect((await review.innerText()).match(NEVER_SHOWN), 'a word that is never shown, on Your app').toBeNull();

  await review.getByLabel('Ask for a change').fill('Add a phone number to each crew.');
  await review.getByRole('button', { name: 'Ask', exact: true }).click();
  // The fake helper answers with the same design again, so the answer is Nothing changed, beside the box, on Prompt.
  await expect(paneHeading(page, 'Your changes')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Nothing changed.')).toBeVisible();
  await expect(page.getByText('Not done: Add a phone number to each crew')).toBeVisible();
  await expect(page).toHaveURL(/\/prompt$/);
  // The ask is quoted in the right pane. The left pane is no second ask box: it shows the first prompt, as words.
  await expect(page.locator('q', { hasText: 'Add a phone number to each crew.' })).toBeVisible();
  await expect(page.getByLabel('What should change?')).toHaveCount(0);
  await expect(page.getByText('Your first prompt', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ask for a change')).toHaveCount(1);
});

test('the old /review, /review/data and /review/design addresses land on Prompt, Data and Design with the search kept, replacing the old entry', async ({ page }) => {
  const app = await importCrewRoster(page.request, 'Redirect Roster');
  const base = `/apps/${app.id}`;
  const cases = [
    ['/review?x=1', /\/prompt\?x=1$/, /Prompt/],
    ['/review/data?x=1', /\/data\?x=1$/, /Data/],
    ['/review/design?x=1', /\/design\?x=1$/, /Design/],
  ];
  for (const [from, to, step] of cases) {
    await page.goto(`${base}/build`);
    await expect(page).toHaveURL(/\/build$/);
    await page.goto(`${base}${from}`);
    await expect(page, `${from} redirects`).toHaveURL(to);
    await expect(steps(page).getByRole('link', { name: step })).toHaveAttribute('aria-current', 'step');
    // The redirect replaced the old address: Back goes to the step before, never to /review.
    await page.goBack();
    await expect(page, `Back from ${from}`).not.toHaveURL(/\/review/);
  }
});

test('the rail has five steps: Prompt, Design, Data, Preview and Build, and no Review', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto(`${appPath}/prompt`);
  const links = steps(page).getByRole('link');
  await expect(links).toHaveCount(5);
  for (const name of ['Prompt', 'Design', 'Data', 'Preview', 'Build']) {
    await expect(steps(page).getByRole('link', { name: new RegExp(name) })).toHaveCount(1);
  }
  await expect(steps(page).getByRole('link', { name: /Review/ })).toHaveCount(0);
  await expect(page.getByText(/^Step 1 of 5$/)).toBeVisible();
  await expect(page.getByText('Tell the helper what your app is for, then check what it made.')).toBeVisible();
});

test('nothing left this computer', async () => {
  expect(ctx.server.outbound()).toEqual([]);
});
