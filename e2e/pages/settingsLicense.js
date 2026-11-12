// Settings > License. The ONLY place that knows this screen's selectors: the store-licensing
// rework will change it, so specs tagged @license go through here and assert on visible words.
import { expect } from '../support/fixtures.js';

export function settingsLicense(page) {
  return {
    async open() {
      await page.goto('/settings#license');
      await expect(page.getByRole('heading', { name: 'License', exact: true }).first()).toBeVisible();
    },
    stateHeading: () => page.getByTestId('license-state'),
    // Header pill "Pro trial: N days left" (a link to this screen); only while a local trial runs.
    trialBadge: () => page.getByRole('link', { name: /pro trial: \d+ days? left/i }),
    // The one-time banner (role=status) shown after onboarding.
    trialNotice: () => page.getByTestId('trial-notice'),
    // Only rendered when config/store.json has a proPurchaseUrl (empty as shipped).
    buyButton: () => page.getByRole('link', { name: /buy .* pro/i }),
  };
}
