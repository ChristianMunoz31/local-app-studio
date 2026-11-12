// Phase 28: Export with records. With Preview running, the app card's menu downloads "<name> app.zip": the design, a manifest and one JSON and
// CSV file per table, with the Preview's invoices in json/invoices.json under their numbers. The re-import half is a backend test.
import fs from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { test, expect, useApp } from '../support/fixtures.js';
import { visibleNotice } from '../pages/design.js';
import { appsRegion, useExample } from '../pages/apps.js';
import { parseExportZip } from '../../server/import/importExport.js';

useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const NAME = 'Invoices and Clients';
const FILE = `${NAME} app.zip`;

test('Export with records downloads the ZIP with the design, manifest and the Preview invoices under their numbers', async ({ page }) => {
  await page.goto('/apps');
  await useExample(page, NAME);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const kept = (await (await page.request.get('/api/preview/data/invoices?limit=200')).json()).data;
  expect(kept.total).toBeGreaterThan(0);

  await page.goto('/apps');
  const card = appsRegion(page).getByRole('listitem').filter({ hasText: NAME });
  await card.getByRole('button', { name: `More actions for ${NAME}` }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export with records', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(FILE);
  await expect(visibleNotice(page, `Exported "${NAME}" as ${FILE}.`)).toBeVisible({ timeout: 10_000 });

  const bytes = new Uint8Array(fs.readFileSync(await file.path()));
  const names = Object.keys(unzipSync(bytes));
  for (const entry of ['app.json', 'manifest.json', 'json/invoices.json', 'csv/invoices.csv']) expect(names, `entries: ${names.join(', ')}`).toContain(entry);

  // The kit importer lists the tables of the manifest; the Studio server has no invoices table of its own, so it names them as ignored
  // (an unknown table) and a built app reads them. The invoices are read from json/invoices.json, the entry the built app imports.
  const parsed = parseExportZip(bytes);
  expect(parsed.manifest.tables.map((t) => t.id)).toContain('invoices');
  const rows = JSON.parse(strFromU8(unzipSync(bytes)['json/invoices.json']));
  expect(rows).toHaveLength(kept.total);
  expect(rows.map((r) => r.number).sort()).toEqual(kept.rows.map((r) => r.number).sort());
});
