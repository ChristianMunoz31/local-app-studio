// Guided flow: describe an app in one box, check the plain review, use it, see it run, reach the Build step
// and flip the opt-in switch. No real build starts and nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { describeFakeChat } from '../support/describeFake.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { appCards, openStartBox } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: describeFakeChat });

test.describe.configure({ mode: 'serial' });

test('one box makes a plain review on Prompt, Use this opens Design, Data and Design lead to Preview, and Change something returns to Prompt', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper and the installer are not in a public build');
  await page.goto('/apps');
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill('Crew roster for my painting business.');
  await page.getByRole('button', { name: 'Make my app' }).click();

  // The review sits beside the prompt box on the same step: the address stays on Prompt.
  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/);
  await expect(page.getByRole('heading', { name: 'What the helper made' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Crews:').first()).toBeVisible();
  // "Show every change" is nested inside the "Show everything" fold.
  await page.getByText('Show everything').click();
  await page.getByText('Show every change').click();

  await page.getByRole('button', { name: 'Use this', exact: true }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(page.getByRole('heading', { level: 3, name: 'Design', exact: true })).toBeFocused();
  const steps = page.getByRole('navigation', { name: 'Steps' });
  await expect(steps.getByRole('link', { name: /Prompt/ })).toContainText('(done)');
  await expect(steps.getByRole('link', { name: /Design/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('region', { name: 'Page layout' })).toBeVisible();
  await page.getByRole('button', { name: 'Next: Data' }).click();
  await expect(page).toHaveURL(/\/data$/);
  await expect(page.getByRole('heading', { level: 3, name: 'Data', exact: true })).toBeFocused();
  await expect(page.getByText('The tables your app keeps and their fields.')).toBeVisible();
  await page.getByRole('button', { name: 'Next: Preview' }).click();
  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  // The describeFake app has no theme id (Classic), so the app shows in light whatever Studio's own mode is.
  await expect(page.getByTestId('preview-theme-scope')).toHaveAttribute('data-theme-mode', 'light');
  // The workspace header and the card title are headings too; the app's own heading comes last.
  await expect(page.getByRole('heading', { name: /Crew/ }).last()).toBeVisible();

  await page.getByLabel('What should change?').fill('Add a phone number to each crew.');
  await page.getByRole('button', { name: 'Ask for changes' }).click();
  // The launch arrives on Prompt and the review shows beside the box, so the address never changes again.
  await expect(page).toHaveURL(/\/prompt$/);
  // The edit runs on its own from the launch state and shows its answer in the right pane of the same step.
  await expect(page.getByRole('heading', { name: 'Your changes' })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/prompt$/);
  // The fake proposes the same spec again, so the review says Nothing changed, says the ask was not done, and offers Try again.
  await expect(page.getByText('Nothing changed.')).toBeVisible();
  await expect(page.getByText('Not done: Add a phone number to each crew')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('the Apps page shows a card with counts and Data shows plain types', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper and the installer are not in a public build');
  await page.goto('/apps');
  const card = appCards(page).filter({ has: page.getByRole('link', { name: /Crew/ }) }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText(/\d+ tables?, \d+ pages?/)).toBeVisible();
  await expect(card.getByRole('button', { name: /^More actions for / })).toBeVisible();

  await card.getByRole('link', { name: /Crew/ }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Data/ }).click();
  await expect(page).toHaveURL(/\/data$/);
  const type = page.getByLabel('Type').first();
  await expect(type).toBeVisible();
  await expect(type.getByRole('option', { name: 'Yes or no' })).toHaveCount(1);
  await expect(type.getByRole('option', { name: 'Link to another table' })).toHaveCount(1);
});

test('old /review, /review/data and /review/design links redirect to the Prompt, Data and Design steps and keep the search', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper and the installer are not in a public build');
  await page.goto('/apps');
  await page.getByRole('link', { name: /Crew/ }).first().click();
  // A designed app lands on Design.
  await expect(page).toHaveURL(/\/design$/);
  const href = page.url().replace(/\/design$/, '');
  const steps = page.getByRole('navigation', { name: 'Steps' });
  await page.goto(`${href}/review/data?x=1`);
  await expect(page).toHaveURL(/\/data\?x=1$/);
  await expect(steps.getByRole('link', { name: /Data/ })).toHaveAttribute('aria-current', 'step');
  await page.goto(`${href}/review/design?x=1`);
  await expect(page).toHaveURL(/\/design\?x=1$/);
  await expect(steps.getByRole('link', { name: /Design/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByText('Edit details')).toHaveCount(0);
  // The plain /review lands on Prompt, where the saved app's review shows.
  await page.goto(`${href}/review?x=1`);
  await expect(page).toHaveURL(/\/prompt\?x=1$/);
  await expect(steps.getByRole('link', { name: /Prompt/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('heading', { name: 'Your app', exact: true })).toBeVisible();
  // The redirect replaced the old address: Back does not return to /review.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/review/);
});

test('the Build step shows the toolchain check and the same opt-in switch Settings shows', { tag: '@pro' }, async ({ page, request, baseURL }) => {
  skipWithoutPro(test, 'the helper and the installer are not in a public build');
  await page.goto('/apps');
  await page.getByRole('link', { name: /Crew/ }).first().click();
  // Landing on a designed app goes to Design; the rail leads on to Preview and Build.
  await expect(page).toHaveURL(/\/design$/);
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Preview/ }).click();
  await expect(page).toHaveURL(/\/preview$/);
  await page.getByRole('button', { name: 'Next: Build' }).click();
  await expect(page).toHaveURL(/\/build$/);

  await expect(page.getByRole('button', { name: /Check again|Checking/ })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Allow downloads for builds' });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Make installer' })).toBeDisabled();

  await toggle.click();
  await expect(toggle).toBeChecked();
  const api = await (await request.get(`${baseURL}/api/settings/network`)).json();
  expect(JSON.stringify(api)).toMatch(/"id":"build"[^}]*"enabled":true/);

  await page.goto('/settings#network');
  await expect(page.getByRole('switch', { name: 'Allow downloads for builds' })).toBeChecked();
});

test('nothing left this computer', { tag: '@pro' }, async () => {
  skipWithoutPro(test, 'the helper and the installer are not in a public build');
  expect(ctx.server.outbound()).toEqual([]);
});
