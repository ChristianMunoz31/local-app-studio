// Studio accessibility, part 3 (DESIGN-phase12.md WP-5, section 1.5): reduced motion, a visible focus ring on the canvas part
// and the shelf Add button, and the document title. Axe is the studioAxe*.spec.js shards, contrast studioContrast.spec.js (separate
// files, see studioShared.js).
import { test, expect } from '../support/fixtures.js';
import { setupStudio, steps, theme } from './studioShared.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { expectStartCard } from '../pages/apps.js';

const { path, openDesign } = setupStudio();

test.describe('studio keyboard and motion', () => {
  test('a focused canvas part and a focused shelf Add button have a visible focus ring', async ({ page }) => {
    await theme(page, 'light');
    await openDesign(page);
    const ring = (locator) =>
      locator.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow };
      });
    const visible = ({ outline, shadow }) => (outline !== 'none 0px' && !/^none/.test(outline) && !outline.endsWith(' 0px')) || (shadow !== '' && shadow !== 'none');

    const part = page.locator('[data-canvas-block][data-layer-id="h1"]');
    await part.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(part).toBeFocused();
    const partRing = await ring(part);
    expect(visible(partRing), `canvas part focus style ${JSON.stringify(partRing)}`).toBe(true);

    const add = page.getByRole('button', { name: 'Add Heading' });
    await add.scrollIntoViewIfNeeded();
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    const addRing = await ring(add);
    expect(visible(addRing), `shelf Add focus style ${JSON.stringify(addRing)}`).toBe(true);
  });

  test('the Prompt step tabs through the prompt box, Make my app, then the review, with no other stops first', { tag: '@pro' }, async ({ page }) => {
    skipWithoutPro(test, 'the helper is not in a public build');
    await theme(page, 'light');
    await page.goto(path('prompt'));
    // The Crew Roster is a designed app: start over with a new prompt so the button reads Make my app.
    await page.getByRole('button', { name: 'Start over with a new prompt' }).click();
    const box = page.getByLabel('Your prompt');
    await expect(box).toBeVisible();
    await box.fill('An app to track equipment loans for my rental shop.');
    await box.focus();
    await expect(box).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Make my app' })).toBeFocused();
    await page.keyboard.press('Enter');

    // The review pane heading takes the focus when the design lands; the pane's buttons follow in order.
    await expect(page.getByRole('heading', { name: 'What the helper made' })).toBeFocused({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/prompt$/);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Use this', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Use this and try it' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByText('Show everything', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Ask for a change')).toBeFocused();
    // Ask stays off until words are typed, so it is not a stop.
    await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
  });

  test('on Design the page strip comes after the skip link and before the page picker', { tag: '@pro' }, async ({ page }) => {
    skipWithoutPro(test, 'the helper is not in a public build');
    await theme(page, 'light');
    await openDesign(page);
    const skip = page.getByRole('link', { name: 'Go to the page' });
    await skip.focus();
    await expect(skip).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Ask the helper to change this page')).toBeFocused();
    // Ask is off until words are typed, so the next stop is the page picker.
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Page', { exact: true })).toBeFocused();
  });

  test('with reduced motion a spinner does not animate', async ({ page }) => {
    await theme(page, 'light');
    await page.goto('/apps');
    await expectStartCard(page);
    // The Prompt and Preview spinners are `animate-spin`; one is added here because a running state is too brief to catch.
    const seconds = await page.evaluate(() => {
      const spinner = document.createElement('span');
      spinner.className = 'animate-spin';
      document.body.appendChild(spinner);
      const duration = getComputedStyle(spinner).animationDuration;
      spinner.remove();
      return Math.max(...duration.split(',').map((d) => (d.trim().endsWith('ms') ? parseFloat(d) / 1000 : parseFloat(d))));
    });
    expect(seconds).toBeLessThanOrEqual(0.01);
  });

  test('the title names the screen on the Apps, Features and step screens', async ({ page }) => {
    await page.goto('/apps');
    await expect(page).toHaveTitle('Apps, Local App Studio');
    await page.goto(path('review'));
    await expect(page).toHaveTitle('Prompt, Crew Roster, Local App Studio');
    await page.goto(path('design'));
    await expect(page).toHaveTitle('Design, Crew Roster, Local App Studio');
    await steps(page).getByRole('link', { name: /Data/ }).click();
    await expect(page).toHaveTitle('Data, Crew Roster, Local App Studio');
  });
});
