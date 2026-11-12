// @license Settings > License with the shipped config/store.json (no store set up): licensing is off, so
// every feature is available, no trial starts and there is no key form. The automatic 14-day trial itself is
// covered by the server and component tests (a configured store needs a config swap that a shipped build must not offer).
// Selectors live in pages/settingsLicense.js; assertions are on visible words.
import { test, expect, useApp } from '../support/fixtures.js';
import { settingsLicense } from '../pages/settingsLicense.js';

useApp({ seed: true, ollama: 'dead' });

test('@license with no store set up, licensing is off: no trial, no key form', async ({ page }) => {
  const license = settingsLicense(page);
  await license.open();
  await expect(license.stateHeading()).toContainText('Licensing is off');
  await expect(page.getByText('Every feature is available in this copy.')).toBeVisible();
  await expect(license.trialBadge()).toHaveCount(0);
  await expect(license.trialNotice()).toHaveCount(0);
  await expect(license.buyButton()).toHaveCount(0);
  await expect(page.getByLabel('License key')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /activate/i })).toHaveCount(0);
});

test('@license with licensing off, the trial route is gone and the license state says so', async ({ page }) => {
  await page.goto('/');
  const trial = await page.request.post('/api/license/trial');
  expect(trial.status()).toBe(410);
  expect((await trial.json()).code).toBe('trial_route_removed');
  const license = await (await page.request.get('/api/license')).json();
  expect(license).toMatchObject({ state: 'licensing_off', purchaseUrl: null });
  expect(license.trial.notice).toBeNull();
});
