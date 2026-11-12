// Shared helpers for the visual project. Baselines are Linux only and come from the pinned
// Playwright image (see scripts/visualUpdate.js).
import { expect } from './fixtures.js';

// The demo data and both clocks (server preload and browser) agree on this instant.
export const FIXED_NOW = '2026-06-15T12:00:00Z';

const FREEZE_CSS = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
    caret-color: transparent !important;
  }
`;

/** Text that changes with every build and must never be part of a baseline. */
export const maskedText = (page) => [
  page.getByText(/\b\d+\.\d+\.\d+(?:[-+][\w.]+)?\b/),
  page.getByText(/released|build date|built on/i),
];

/**
 * Takes the baseline screenshot `name` of `target` (a page or a locator) once the page is settled.
 * @param {import('@playwright/test').Page} page
 * @param {string} name file name, for example `home-light.png`
 * @param {{ target?: import('@playwright/test').Page | import('@playwright/test').Locator }} [opts]
 */
export async function settleAndShoot(page, name, { target = page } = {}) {
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await expect(target).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.002,
    mask: maskedText(page),
  });
}
