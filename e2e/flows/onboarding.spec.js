// A brand-new data dir: the welcome flow needs nothing but a display name.
import { test, expect, useApp } from '../support/fixtures.js';
import { onboarding } from '../pages/onboarding.js';

useApp({ ollama: 'fake' });

test('onboarding completes with only a display name and Home greets the person', async ({ page }) => {
  await page.goto('/');
  await onboarding(page).complete('Riley');

  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
  // The top bar greets by name.
  await expect(page.getByText(/^(Up late|Good (morning|afternoon|evening|night)), Riley$/)).toBeVisible();

  // The name is saved: Settings shows it in the display name field.
  await page.goto('/settings#general');
  await expect(page.getByLabel('Display name')).toHaveValue('Riley');

  // Reloading does not bring the welcome flow back.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Welcome to Local App Studio' })).toHaveCount(0);
});
