// Navigation helpers. Pages are opened by URL (the server serves the SPA for every route) and
// asserted by their h2 heading.
import { expect } from '../support/fixtures.js';

export function nav(page) {
  return {
    /** Opens `route.path` and waits for its heading. */
    async open(route) {
      await page.goto(route.path);
      await this.expectLoaded(route);
    },
    async expectLoaded(route) {
      await expect(page.getByRole('heading', { level: 2, name: route.heading, exact: true }).first()).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
    },
  };
}
