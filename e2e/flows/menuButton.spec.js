// A button on the menu bar (phase 10): turn the menu bar on in Look, drop a Button on the end of the bar with one real drag, Save, and
// see in Preview that it sits in the bar and opens a form to add a record, whose row shows in the table of the page. Then the keyboard
// way (Add here on a slot, Add on the shelf tile) with a search box that filters that table, and the bar stacking on a narrow screen.
// Nothing leaves this computer.
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

/** Presses the menu button of the Preview, fills the form that opens with a crew name and saves it. */
async function addCrew(page, scope, name) {
  await scope.locator('[data-menu-slot="end"]').getByRole('button', { name: 'Add to Crews' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Add to Crews')).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(scope.getByTestId('t1').getByText(name)).toBeVisible();
}

test('a Button dropped on the end of the menu bar is saved, shows in Preview and opens a form that adds a crew', async ({ page }) => {
  const imported = await page.request.post('/api/studio/apps/import', { data: { spec: crewRoster() } });
  expect(imported.status()).toBe(201);

  const d = design(page);
  await d.open();
  await expect(d.menuSlot('end')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Look' }).click();
  await page.getByRole('group', { name: 'Menu bar' }).getByText('Across the top', { exact: true }).click();
  await expect(page.getByText('Other parts go on the menu bar from Features: press Add here on the bar.')).toBeVisible();
  await page.getByRole('tab', { name: 'Features' }).click();
  await expect(d.menuSlot('start')).toBeVisible();
  await expect(d.menuSlot('end')).toBeVisible();
  await expect(page.locator('[data-entry-key="part:Button"]').getByText('Fits the menu')).toBeVisible();
  await expect(page.locator('[data-entry-key="part:DataTable"]').getByText('Fits the menu')).toHaveCount(0);

  await d.dragTile('Button', '@menu-end:0');
  await expect(notice(page, 'Added Button to the menu bar.')).toBeVisible();
  await expect(d.menuSlot('end').getByText('Add to Crews')).toBeVisible();

  // A new menu button opens a form for the table the open page shows (Crews, not the app's first table, People): nothing to switch.
  const settings = await d.openSettings('Button');
  await expect(settings.getByLabel('What it does')).toHaveValue('open-form');
  await expect(settings.getByLabel('Table', { exact: true })).toHaveValue('crews');
  await settings.getByRole('button', { name: 'Cancel' }).click();
  await expect(settings).toHaveCount(0);
  await d.save();

  const spec = (await crewApp(page)).spec;
  expect(spec.menu.position).toBe('top');
  expect(spec.menu.end).toHaveLength(1);
  expect(spec.menu.end[0]).toMatchObject({ type: 'Button', props: { action: { action: 'open-form', table: 'crews', mode: 'create' } }, children: 'Add to Crews' });

  const scope = await openPreview(page);
  await expect(scope.locator('[data-menu-slot="end"]').getByRole('button', { name: 'Add to Crews' })).toBeVisible();
  await addCrew(page, scope, 'Zeta crew');
  expect(ctx.server.outbound()).toEqual([]);
});

test('a search box added with the keyboard sits in the start of the bar and filters the table; the bar stacks on a narrow screen', async ({ page }) => {
  const d = design(page);
  await d.open();
  await page.getByRole('button', { name: 'Add here: Menu bar, left, place 1' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add Search box' }).click();
  await expect(d.menuSlot('start').getByRole('group', { name: 'Search box' })).toBeVisible();
  await d.save();
  expect((await crewApp(page)).spec.menu.start[0]).toMatchObject({ type: 'SearchBox', props: {} });

  const scope = await openPreview(page);
  await addCrew(page, scope, 'Searchable crew');
  const search = scope.locator('[data-menu-slot="start"]').getByRole('searchbox');
  await expect(search).toBeVisible();
  await search.fill('Searchable');
  await expect(scope.getByTestId('t1').getByText('Searchable crew')).toBeVisible();
  await expect(scope.getByTestId('t1').getByText('Zeta crew')).toHaveCount(0);
  await search.fill('qqqq');
  await expect(scope.getByTestId('t1').getByText('Searchable crew')).toHaveCount(0);

  const start = await scope.locator('[data-menu-slot="start"]').boundingBox();
  const end = await scope.locator('[data-menu-slot="end"]').boundingBox();
  expect(end.x).toBeGreaterThan(start.x + start.width - 1);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect.poll(async () => (await scope.locator('[data-menu-slot="end"]').boundingBox()).y).toBeGreaterThan(start.y + start.height - 1);
  expect(ctx.server.outbound()).toEqual([]);
});

test('the bar can go back to none, and the parts go with it', async ({ page }) => {
  const d = design(page);
  await d.open();
  await page.getByRole('tab', { name: 'Look' }).click();
  await page.getByRole('group', { name: 'Menu bar' }).getByText('No menu bar', { exact: true }).click();
  await expect(page.getByText('Saving with no menu bar removes the 2 parts on it.')).toBeVisible();
  await d.save();
  expect('menu' in (await crewApp(page)).spec).toBe(false);
});
