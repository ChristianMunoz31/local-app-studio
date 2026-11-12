// Set-up for the phase 17 proof flows that run on the honest fake helper (scripts/lib/fakeDescribeAnswers.js `cannedDescribeChat`):
// an app made the way a person makes it, from the Apps page with a prompt, and the words the review shows.
import { expect } from './fixtures.js';
import { openStartBox } from '../pages/apps.js';

export const paneHeading = (page, name) => page.getByRole('heading', { level: 3, name, exact: true });
export const reviewPane = (page, heading) => page.getByRole('region', { name: heading, exact: true });
/** The announcer region the workspace speaks through (sr-only), found by its text. */
export const announcer = (page, text) => page.getByRole('status').filter({ hasText: text });

/** Types the prompt on the Apps page, presses Make my app and waits for the review. Returns the new app's id. */
export async function makeWithHelper(page, prompt) {
  await page.goto('/apps');
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill(prompt);
  await page.getByRole('button', { name: 'Make my app', exact: true }).click();
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });
  return /\/apps\/([^/]+)\/prompt$/.exec(page.url())[1];
}

/**
 * Records every text a role=status region holds from now on, so a one-moment announcement can be checked after the fact.
 * Returns `said()`, the texts so far joined with " | ".
 */
export async function recordStatus(page) {
  await page.evaluate(() => {
    window.__said = [];
    const take = () => {
      for (const el of document.querySelectorAll('[role="status"]')) if (el.textContent) window.__said.push(el.textContent.trim());
    };
    new MutationObserver(take).observe(document.body, { subtree: true, childList: true, characterData: true });
    take();
  });
  return async () => (await page.evaluate(() => window.__said)).join(' | ');
}

/** Presses Use this on a waiting design, and waits for Design. */
export async function useThis(page) {
  await page.getByRole('button', { name: 'Use this', exact: true }).click();
  await expect(page).toHaveURL(/\/design$/);
}

/** The saved record of an app. */
export async function savedApp(page, id) {
  return (await (await page.request.get(`/api/studio/apps/${id}`)).json()).data;
}

/** Asks for a change in the right pane's Ask box. */
export async function ask(page, words) {
  await page.getByLabel('Ask for a change').fill(words);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
}
