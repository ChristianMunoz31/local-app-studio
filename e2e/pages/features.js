// The Features page (src/studio/pages/FeaturesPage.tsx).
import fs from 'node:fs';
import { expect } from '../support/fixtures.js';

export function features(page) {
  return {
    async open() {
      await page.goto('/features');
      await expect(page.getByRole('heading', { level: 3, name: 'Features', exact: true })).toBeVisible();
    },
    /** A tile (built-in or your own) by its name. */
    card(name) {
      return page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Show details for ${name}`, exact: true }) });
    },
    /** Opens the details drawer of a tile and returns it. Usage (version, "Not used yet", "Used by N apps") shows here. */
    async openDetails(name) {
      await page.getByRole('button', { name: `Show details for ${name}`, exact: true }).click();
      const drawer = page.getByRole('dialog', { name, exact: true });
      await expect(drawer).toBeVisible();
      return drawer;
    },
    async closeDetails() {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
    /** Your own features only: the tiles under the Your features heading. */
    customCards() {
      return page.getByRole('region', { name: 'Your features', exact: true }).getByRole('listitem');
    },
    /** Picks a category in the filter row (the radio input is visually hidden, so click its label text). */
    async showCategory(label) {
      // The chips carry a count ("Input (4)").
      await page.getByRole('group', { name: 'Show', exact: true }).getByText(new RegExp(String.raw`^${label}( \(\d+\))?$`)).click();
    },
    async search(text) {
      await page.getByLabel('Search parts and features').fill(text);
    },
    async menu(name, item) {
      await page.getByRole('button', { name: `More actions for ${name}` }).click();
      await page.getByRole('menuitem', { name: item }).click();
    },
    /** Exports a feature, saves the download to `outPath` and returns its file name and parsed content. */
    async exportFile(name, outPath) {
      const download = page.waitForEvent('download');
      await this.menu(name, 'Export');
      const file = await download;
      await file.saveAs(outPath);
      return { suggested: file.suggestedFilename(), json: JSON.parse(fs.readFileSync(outPath, 'utf8')) };
    },
    async importJson(json, filename = 'feature.feature.json') {
      await page.getByTestId('feature-file').setInputFiles({ name: filename, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    },
  };
}
