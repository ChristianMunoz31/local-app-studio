// The Preview step of an app (src/studio/pages/PreviewTab.tsx): the running app, its data banner and the start, stop and reset controls.
import { expect, test } from '../support/fixtures.js';
import { PREVIEW_START, PREVIEW_START_TIMEOUT } from '../support/previewStartReporter.js';

/** Waits for the running app and records the seconds since `since` as the test's preview-start annotation (printed once per run by previewStartReporter.js). */
async function waitRunning(page, since) {
  try {
    await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  } catch (e) {
    // A start that hit the wait is counted by the reporter (timeouts=N), then the test still fails as before.
    test.info().annotations.push({ type: PREVIEW_START_TIMEOUT, description: '30' });
    throw e;
  }
  test.info().annotations.push({ type: PREVIEW_START, description: ((Date.now() - since) / 1000).toFixed(2) });
}

export function preview(page) {
  /** The running app inside the Preview card. */
  const scope = page.getByTestId('preview-theme-scope');
  return {
    scope,
    /** The data banner (`preview-data-banner`) and the one line it may show about the last start (`preview-data-note`). */
    banner: () => page.getByTestId('preview-data-banner'),
    note: () => page.getByTestId('preview-data-note'),
    /** Opens the Preview step of an app from the app list and waits for the running app. */
    async open(appName) {
      await page.goto('/apps');
      await page.getByRole('link', { name: appName }).click();
      const since = Date.now();
      await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: 'Preview' }).click();
      await waitRunning(page, since);
      await expect(scope).toBeVisible();
      return scope;
    },
    async stop() {
      await page.getByText('Preview options', { exact: true }).click();
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(page.getByText('The preview is stopped.')).toBeVisible({ timeout: 30_000 });
    },
    async start() {
      const since = Date.now();
      await page.getByRole('button', { name: 'Start preview', exact: true }).click();
      await waitRunning(page, since);
    },
    /** Reset preview data: the banner button, then the confirm dialog's button. */
    async reset() {
      await page.getByRole('button', { name: 'Reset preview data', exact: true }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Reset preview data?' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Reset preview data', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    },
  };
}
