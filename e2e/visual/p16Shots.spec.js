// Phase 16 screenshots (DESIGN-phase16.md 5.1). Not part of the normal run: skipped unless P16_SHOTS_DIR names a folder, and then it only
// writes PNG files there (no assertion on pixels). The orchestrator runs it twice against a sandbox: at the base commit with a before
// folder and at the head with an after folder. A screen that does not exist at the base (the page strip, the builder) is skipped there.
//   $env:P16_SHOTS_DIR = '<folder>'; npx playwright test e2e/visual/p16Shots.spec.js
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { builder } from '../pages/builder.js';
import { importCrewRoster } from '../support/critiqueApps.js';
import { skipWithoutPro } from '../support/proBuild.js';

const DIR = process.env.P16_SHOTS_DIR ?? '';
test.skip(DIR === '', 'Set P16_SHOTS_DIR to take the phase 16 screenshots.');

useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });
test.describe.configure({ mode: 'serial' });

let appId = '';

async function shoot(page, name) {
  fs.mkdirSync(DIR, { recursive: true });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR, `${name}.png`) });
}

const canvas = (page) => page.getByRole('region', { name: 'Page layout' });

async function openDesign(page) {
  await page.goto(`/apps/${appId}/design`);
  await expect(canvas(page)).toBeVisible();
}

/** The helper's answer waits beside the box (the canned loans design). Skips the test when this build has no such screen. */
async function waitingDesign(page) {
  await page.goto(`/apps/${appId}/prompt`);
  try {
    await page.getByRole('button', { name: 'Start over with a new prompt' }).click({ timeout: 10_000 });
    await page.getByLabel('Your prompt').fill('An app to track equipment loans for my rental shop.');
    await page.getByRole('button', { name: 'Make my app' }).click();
    await expect(page.getByRole('heading', { name: 'What the helper made' })).toBeVisible({ timeout: 30_000 });
  } catch {
    test.skip(true, 'this build has no merged Prompt step');
  }
}

async function addIndicators(page) {
  await openDesign(page);
  await page.locator('[data-canvas-block]').first().focus();
  await page.getByRole('button', { name: 'Add here: Page, place 2' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add Table of records' }).click();
  await page.getByRole('button', { name: 'Add here: Page, place 3' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add Checklist' }).click();
}

async function openBuilderOrSkip(page, withParts) {
  const b = builder(page);
  try {
    if (withParts) await b.withParts();
    else await b.openNew();
  } catch {
    test.skip(true, 'this build has no Feature builder');
  }
  return b;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (appId === '') appId = (await importCrewRoster(page.request, 'Crew Roster')).id;
});

for (const mode of ['light', 'dark']) {
  test.describe(mode, () => {
    test.use({ colorScheme: mode, reducedMotion: 'reduce' });
    const suffix = mode === 'dark' ? '-dark' : '';

    test(`prompt-review-proposal${suffix}`, { tag: '@pro' }, async ({ page }) => {
      skipWithoutPro(test, 'the helper is not in a public build');
      await waitingDesign(page);
      await shoot(page, `prompt-review-proposal${suffix}`);
    });

    test(`builder-slots${suffix}`, async ({ page }) => {
      await openBuilderOrSkip(page, true);
      await shoot(page, `builder-slots${suffix}`);
    });

    if (mode === 'light') {
      test('prompt-idle', { tag: '@pro' }, async ({ page }) => {
        skipWithoutPro(test, 'the helper is not in a public build');
        await page.goto(`/apps/${appId}/prompt`);
        await expect(page.getByText('Your first prompt', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Ask for a change')).toBeVisible();
        await expect(page.getByLabel('What should change?')).toHaveCount(0);
        await shoot(page, 'prompt-idle');
      });

      test('prompt-review-stacked', { tag: '@pro' }, async ({ page }) => {
        skipWithoutPro(test, 'the helper is not in a public build');
        await page.setViewportSize({ width: 900, height: 900 });
        await waitingDesign(page);
        await shoot(page, 'prompt-review-stacked');
      });

      test('design-indicators', async ({ page }) => {
        await addIndicators(page);
        await shoot(page, 'design-indicators');
      });

      test('design-page-strip', { tag: '@pro' }, async ({ page }) => {
        skipWithoutPro(test, 'the helper is not in a public build');
        await openDesign(page);
        const strip = page.getByRole('region', { name: 'This page' });
        if ((await strip.count()) === 0) test.skip(true, 'this build has no page strip');
        await strip.scrollIntoViewIfNeeded();
        await shoot(page, 'design-page-strip');
      });

      test('features-tiles', async ({ page }) => {
        await page.goto('/features');
        await expect(page.getByTestId('feature-tile').first()).toBeVisible();
        await shoot(page, 'features-tiles');
      });

      test('save-as-feature-dialog', async ({ page }) => {
        await openDesign(page);
        await page.locator('[data-canvas-block][data-layer-id="h1"]').click();
        await page.getByRole('button', { name: 'Save as feature' }).click();
        await expect(page.getByRole('dialog', { name: 'Save as feature' })).toBeVisible();
        await shoot(page, 'save-as-feature-dialog');
      });

      test('builder-empty', async ({ page }) => {
        await openBuilderOrSkip(page, false);
        await shoot(page, 'builder-empty');
      });

      test('builder-save-dialog', async ({ page }) => {
        const b = await openBuilderOrSkip(page, true);
        await b.openSave();
        await shoot(page, 'builder-save-dialog');
      });
    }
  });
}
