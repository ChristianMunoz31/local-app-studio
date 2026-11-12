// Visual baselines for Home, Features, Settings and Settings > AI, light and dark (the theme follows
// prefers-color-scheme). Seeded demo data at a fixed instant; the server clock is shifted by
// e2e/support/fixedClock.mjs and the browser clock by page.clock.install. Linux only: baselines come
// from the pinned Playwright image (`npm run test:visual:update`).
import { test, expect, useApp } from '../support/fixtures.js';
import { FIXED_NOW, settleAndShoot } from '../support/visual.js';

useApp({ seed: true, ollama: 'fake', fixedNow: FIXED_NOW });

const SCREENS = [
  { name: 'home', url: '/', heading: 'Overview' },
  { name: 'features', url: '/features', heading: 'Features' },
  { name: 'settings', url: '/settings', heading: 'Settings' },
  { name: 'settings-ai', url: '/settings#ai', heading: 'Settings', section: '#ai' },
];

for (const theme of ['light', 'dark']) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme });

    for (const screen of SCREENS) {
      test(`${screen.name}`, async ({ page }) => {
        await page.clock.install({ time: new Date(FIXED_NOW) });
        await page.goto(screen.url);
        await expect(page.getByRole('heading', { level: 2, name: screen.heading, exact: true }).first()).toBeVisible();
        if (screen.section) await expect(page.getByText('Ollama is running', { exact: true })).toBeVisible();
        await settleAndShoot(page, `${screen.name}-${theme}.png`, {
          target: screen.section ? page.locator(screen.section) : page,
        });
      });
    }
  });
}
