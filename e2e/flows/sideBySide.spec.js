// Parts side by side (phase 9): drop a Number tile beside the table with one real drag, check both take half the row, drag the
// handle two twelfths, Save, and see the widths in the Preview (stacked on a narrow screen). Then the keyboard way (Widen,
// Shrink, Undo from the status line) and rows of thirds, a quarter and three quarters in the Preview. Nothing leaves this computer.
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const crewRoster = () => JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));
const notice = visibleNotice;

async function openPreview(page) {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  return page.getByTestId('preview-theme-scope');
}

async function crewApp(page) {
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  return (await (await page.request.get(`/api/studio/apps/${list.find((a) => a.name === 'Crew Roster').id}`)).json()).data;
}

test('a Number tile dropped beside the table takes half the row, the handle makes it a third, and the Preview shows it', async ({ page }) => {
  const imported = await page.request.post('/api/studio/apps/import', { data: { spec: crewRoster() } });
  expect(imported.status()).toBe(201);

  const d = design(page);
  await d.open();
  await d.dragTile('StatCard', 'side:t1:right');
  // P17-14: the page lists a table and the app has others, so the dropped tile asks which table before it is placed.
  const tileSettings = page.getByRole('dialog', { name: 'Settings for Number tile' });
  await expect(tileSettings).toBeVisible();
  await tileSettings.getByLabel('Table', { exact: true }).selectOption({ index: 1 });
  await expect(notice(page, /^Connected to /)).toBeVisible();
  await expect(page.locator('[data-sizing-row]').filter({ has: page.getByRole('group', { name: 'Table of records', exact: true }) }).filter({ has: page.getByRole('group', { name: 'Number tile', exact: true }) })).toHaveCount(1);

  for (const name of ['Number tile', 'Table of records']) {
    const settings = await d.openSettings(name);
    await expect(settings.getByText('Takes half the row', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
  }
  const table = await d.named('Table of records').boundingBox();
  const tile = await d.named('Number tile').boundingBox();
  expect(table.x + table.width).toBeLessThanOrEqual(tile.x + 1);
  expect(Math.abs(table.y - tile.y)).toBeLessThan(60);

  // The canvas must still show sample rows: a running Preview would swap in the empty live data and move the handle.
  await expect(page.getByText('Showing sample rows.')).toBeVisible();
  await d.dragHandle('Table of records', 2);
  await expect(notice(page, 'Table of records now takes two thirds of the row and Number tile a third of the row.')).toBeVisible();
  await expect(d.handle('Table of records')).toHaveAttribute('aria-valuetext', 'Two thirds and a third');
  await d.save();

  const scope = await openPreview(page);
  const shownTable = scope.getByTestId('t1');
  const shownTile = scope.getByTestId('statcard_1');
  await expect(shownTable).toBeVisible();
  await expect(shownTile).toBeVisible();
  const a = await shownTable.boundingBox();
  const b = await shownTile.boundingBox();
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  expect(Math.abs(a.y - b.y)).toBeLessThan(60);
  const ratio = a.width / b.width;
  expect(ratio).toBeGreaterThan(1.7);
  expect(ratio).toBeLessThan(2.3);

  await page.setViewportSize({ width: 600, height: 800 });
  await expect.poll(async () => (await shownTile.boundingBox()).y).toBeGreaterThan(a.y + 1);
  const narrowTable = await shownTable.boundingBox();
  const narrowTile = await shownTile.boundingBox();
  expect(narrowTile.y).toBeGreaterThanOrEqual(narrowTable.y + narrowTable.height - 1);
});

test('Widen and Shrink from the block toolbar with the keyboard, and Undo from the status line', async ({ page }) => {
  const d = design(page);
  await d.open();
  await d.named('Number tile').focus();
  await page.keyboard.press('Tab');
  const toolbar = page.getByRole('toolbar', { name: 'Actions for Number tile' });
  await expect(toolbar).toBeVisible();

  await toolbar.getByRole('button', { name: 'Widen' }).focus();
  await page.keyboard.press('Enter');
  await expect(notice(page, 'Table of records now takes half the row and Number tile half the row.')).toBeVisible();

  await toolbar.getByRole('button', { name: 'Shrink' }).focus();
  await page.keyboard.press('Enter');
  await expect(notice(page, 'Table of records now takes two thirds of the row and Number tile a third of the row.')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(notice(page, 'Table of records now takes three quarters of the row and Number tile a quarter of the row.')).toBeVisible();

  await notice(page, 'three quarters').getByRole('button', { name: 'Undo' }).click();
  await expect(d.handle('Table of records')).toHaveAttribute('aria-valuetext', 'Two thirds and a third');

  // The handle steps with the arrow keys too.
  await d.handle('Table of records').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(notice(page, 'Table of records now takes half the row and Number tile half the row.')).toBeVisible();
});

test('the Preview puts three thirds on one line and a quarter with three quarters on the next', async ({ page }) => {
  const app = await crewApp(page);
  const spec = app.spec;
  const tile = (id, width) => ({ id, type: 'StatCard', sizing: { width, grow: false }, props: { source: 'open_crews', stat: 'count', label: `Tile ${id}` }, children: [] });
  spec.pages[0].layout = {
    id: 'root',
    type: 'Page',
    props: {},
    children: [
      tile('n1', 'third'),
      tile('n2', 'third'),
      tile('n3', 'third'),
      tile('q1', 'quarter'),
      { id: 't1', type: 'DataTable', sizing: { width: 'three-quarters', grow: false }, props: { source: 'open_crews', columns: ['name', 'size'] }, children: [] },
    ],
  };
  const put = await page.request.put(`/api/studio/apps/${app.id}`, { data: { spec, baseRevision: app.revision } });
  expect(put.status()).toBe(200);

  const scope = await openPreview(page);
  // The running preview from the first test picks up the new revision first.
  await expect(scope.getByTestId('n3')).toBeVisible({ timeout: 30_000 });
  const box = async (id) => scope.getByTestId(id).boundingBox();
  const [n1, n2, n3, q1, t1] = [await box('n1'), await box('n2'), await box('n3'), await box('q1'), await box('t1')];
  expect(Math.abs(n2.y - n1.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(n3.y - n1.y)).toBeLessThanOrEqual(2);
  expect(n1.x + n1.width).toBeLessThanOrEqual(n2.x + 1);
  expect(n2.x + n2.width).toBeLessThanOrEqual(n3.x + 1);
  expect(q1.y).toBeGreaterThan(n1.y + n1.height - 1);
  expect(Math.abs(t1.y - q1.y)).toBeLessThanOrEqual(2);
  expect(q1.x + q1.width).toBeLessThanOrEqual(t1.x + 1);
  expect(ctx.server.outbound()).toEqual([]);
});
