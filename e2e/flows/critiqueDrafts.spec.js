// Phase 14 proof flows, unsaved work is never lost silently (DESIGN-phase14.md P-03, P-09). Breaker path B2d.
//   P-03: an unsaved Data change survives a reload and is offered back with Restore.
//   P-09: when the app was deleted in another window, the stuck dialog offers Export a copy and the download happens.
// Studio API calls (estimate): about 40, well under the 300 per 15 minutes. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { importCrewRoster } from '../support/critiqueApps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test('P-03: an unsaved Data change, reload: "You have unsaved changes on Data from ..." with Restore; Restore brings the table back', async ({ page }) => {
  const app = await importCrewRoster(page.request, 'Draft Roster');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(`/apps/${app.id}/data`);
  const tables = page.getByRole('navigation', { name: 'Tables' });
  await expect(tables).toBeVisible();
  const before = await tables.getByRole('button').count();

  await tables.getByRole('button', { name: /Add table/ }).click();
  await expect(tables.getByRole('button', { name: /^New table/ })).toHaveCount(1);
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes on Data');

  // The draft is written to browser storage a moment after the edit (400 ms); a person reloads after that.
  await expect
    .poll(() => page.evaluate((id) => window.localStorage.getItem(`app.studio.draft.${id}.data`) !== null, app.id))
    .toBe(true);

  await page.reload();
  await expect(tables).toBeVisible();
  const offer = visibleNotice(page, /^You have unsaved changes on Data from /);
  await expect(offer).toBeVisible();
  await expect(tables.getByRole('button', { name: /^New table/ })).toHaveCount(0);
  await expect(offer.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
  // Nothing was applied silently, and nothing was saved.
  expect((await (await page.request.get(`/api/studio/apps/${app.id}`)).json()).data.spec.tables.map((t) => t.id)).not.toContain('new_table');

  await offer.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(tables.getByRole('button', { name: /^New table/ })).toHaveCount(1);
  expect(await tables.getByRole('button').count()).toBe(before + 1);
  await expect(visibleNotice(page, 'Restored your unsaved changes.')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes on Data');
});

test('P-09 B2d: the app was deleted elsewhere while Design has an edit: Save, then leaving offers Export a copy and the copy downloads', async ({ page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '404' });
  const app = await importCrewRoster(page.request, 'Deleted Roster');
  const d = design(page);
  await d.open('Deleted Roster');
  const dialog = await d.openSettings('Heading');
  await dialog.getByLabel('Text', { exact: true }).fill('Work that must survive');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(d.canvas.getByRole('heading', { name: 'Work that must survive' })).toBeVisible();

  // Another window deletes the app (the request the Delete button sends).
  expect((await page.request.delete(`/api/studio/apps/${app.id}`)).status()).toBe(200);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That app does not exist. It may have been deleted.' }).first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Preview/ }).click();
  const stuck = page.getByRole('alertdialog', { name: 'Your changes on Design cannot be saved yet' });
  await expect(stuck).toBeVisible();
  await expect(stuck).toContainText('That app does not exist');
  await expect(stuck.getByRole('button', { name: 'Discard changes' })).toBeVisible();

  const download = page.waitForEvent('download');
  await stuck.getByRole('button', { name: 'Export a copy' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/ app\.json$/);
  const copy = JSON.parse(await (await import('node:fs')).promises.readFile(await file.path(), 'utf8'));
  expect(JSON.stringify(copy)).toContain('Work that must survive');
  // Exporting does not leave the dialog: Stay is still there.
  await expect(stuck).toBeVisible();
  await stuck.getByRole('button', { name: 'Stay' }).click();
  await expect(stuck).toHaveCount(0);
  expect(ctx.server.outbound()).toEqual([]);
});
