// Settings > Diagnostics: see the page, run the checks, toggle debug mode, save a report, copy the summary.
import { test, expect, useApp } from '../support/fixtures.js';
import { scan, describe as describeViolations } from '../support/axe.js';

useApp({ seed: true, ollama: 'dead' });

test('Diagnostics shows the checks, debug mode, a report and a summary', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/settings#diagnostics');
  const section = page.locator('#diagnostics');
  await expect(section).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  // The #diagnostics address opens the disclosure; a plain visit would need the click.
  await expect(section.getByRole('button', { name: 'Hide diagnostics' })).toHaveAttribute('aria-expanded', 'true');

  await expect(section.getByRole('heading', { name: 'This copy' })).toBeVisible();
  await expect(section.getByRole('table', { name: 'Checks' })).toBeVisible();
  await expect(section.getByText(/\d+ found, \d+ missing, \d+ problem\./)).toBeVisible();

  const blocking = await scan(page, testInfo, { name: 'diagnostics-open', theme: 'default', include: '#diagnostics' });
  expect(describeViolations(blocking), 'axe violations on the open Diagnostics section').toEqual([]);

  await section.getByRole('button', { name: 'Check again' }).click();
  await expect(section.getByRole('button', { name: 'Check again' })).toBeEnabled();
  await expect(section.getByText(/\d+ found, \d+ missing, \d+ problem\./)).toBeVisible();

  const debug = section.getByRole('switch', { name: 'Debug mode for this session' });
  await expect(debug).toHaveAttribute('aria-checked', 'false');
  await debug.click();
  await expect(debug).toHaveAttribute('aria-checked', 'true');

  await section.getByRole('button', { name: 'Refresh' }).click();
  await expect(section.getByRole('table', { name: 'Recent log' })).toBeVisible();
  await section.getByLabel('Show').selectOption('errors');

  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Save a report' }).click();
  expect((await download).suggestedFilename()).toMatch(/^local-app-studio-report-\d{8}-\d{4}\.zip$/);
  await expect(section.getByText('Report ready. Look for it in your downloads folder.')).toBeVisible();

  await section.getByRole('button', { name: 'Copy summary' }).click();
  await expect(section.getByText('Summary copied.')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Debug mode: on');
});
