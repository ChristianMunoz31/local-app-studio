// Parts placed freely on a grid (phase 21, ADR-012): switch an Auto grid to "Place parts freely", drop Text and Heading on cells, move one
// by dragging, resize one with the mouse and one with the keyboard, prove Alt+ArrowLeft never goes Back, take the Alt-free Place path, see the
// overlap refusal, check the Preview at md and below md, Export, and switch back to flow. No helper is needed, so it runs in both builds.
// Nothing leaves this computer.
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const GRID_ID = 'free_grid';
const APP_NAME = 'Grid Roster';
const notice = visibleNotice;

const gridSpec = () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));
  spec.app.name = APP_NAME;
  spec.app.slug = 'grid-roster';
  spec.app.identifier = 'com.example.gridroster';
  spec.pages[0].layout = {
    id: 'root',
    type: 'Page',
    props: {},
    children: [{ id: GRID_ID, type: 'Grid', props: { columns: 2, gap: 'md' }, children: [] }],
  };
  return spec;
};

async function gridApp(page) {
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  return (await (await page.request.get(`/api/studio/apps/${list.find((a) => a.name === APP_NAME).id}`)).json()).data;
}

/** The ids of the Text and Heading parts of the Grid, read from the saved spec. */
async function placedIds(page) {
  const grid = (await gridApp(page)).spec.pages[0].layout.children[0];
  const idOf = (type) => grid.children.find((c) => c.type === type).id;
  return { text: idOf('Text'), heading: idOf('Heading') };
}

async function openPreview(page) {
  await page.goto('/apps');
  await page.getByRole('link', { name: APP_NAME }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  return page.getByTestId('preview-theme-scope');
}

test('a Grid switched to free takes two dropped parts on their cells, and the overlap, move and resize ways all work', async ({ page }) => {
  const imported = await page.request.post('/api/studio/apps/import', { data: { spec: gridSpec() } });
  expect(imported.status()).toBe(201);

  const d = design(page);
  await d.open(APP_NAME);

  // 1. The switch.
  const settings = await d.openSettings('Auto grid');
  await settings.getByRole('switch', { name: 'Place parts freely' }).click();
  await expect(notice(page, 'Auto grid now places parts freely.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);

  // 2. Two drops on cells.
  await d.dragTileToCell('Text', GRID_ID, 1, 1);
  await expect(d.named('Text')).toBeVisible();
  await d.dragTileToCell('Heading', GRID_ID, 7, 1);
  await expect(d.named('Heading')).toBeVisible();
  const items = page.locator(`[data-grid-item]`);
  await expect(items).toHaveCount(2);
  const textItem = items.filter({ has: page.getByRole('group', { name: 'Text', exact: true }) });
  const headingItem = items.filter({ has: page.getByRole('group', { name: 'Heading', exact: true }) });
  await expect(textItem).toHaveAttribute('data-grid-place', '1:3:1:1');
  await expect(headingItem).toHaveAttribute('data-grid-place', '7:3:1:1');

  // 3. Move the Heading by dragging its block.
  await d.dragBlockToCell('Heading', GRID_ID, 4, 2);
  await expect(notice(page, 'Moved Heading to column 4, row 2.')).toBeVisible();
  await expect(headingItem).toHaveAttribute('data-grid-place', '4:3:2:1');

  // 4. Resize the Text with the mouse (width handle to column 6).
  await d.dragGridHandle('Text', 'width', GRID_ID, 6, 1);
  await expect(notice(page, 'Now 6 columns wide, columns 1 to 6.')).toBeVisible();
  await expect(textItem).toHaveAttribute('data-grid-place', '1:6:1:1');

  // 5. Resize the Heading with the keyboard, then prove Alt+ArrowLeft never goes Back.
  await d.named('Heading').focus();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(notice(page, 'Now 2 rows high, rows 2 to 3.')).toBeVisible();
  await expect(headingItem).toHaveAttribute('data-grid-place', '4:3:2:2');

  const url = page.url();
  const depth = await page.evaluate(() => history.length);
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Alt+ArrowLeft');
  await expect(notice(page, 'Moved to column 1, row 2.')).toBeVisible();
  await expect(headingItem).toHaveAttribute('data-grid-place', '1:3:2:2');
  await expect(d.named('Heading')).toBeFocused();
  await expect(d.named('Heading')).toHaveAccessibleDescription('column 1, row 2, 3 columns wide, 2 rows high');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(notice(page, 'Column 1 is the first column.')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Column 1 is the first column.' }).first()).toContainText('Column 1 is the first column.');
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.length)).toBe(depth);
  await expect(d.canvas).toBeVisible();

  // 5a. The Alt-free path: Move to... then Choose column and row..., the Place boxes.
  await d.named('Heading').focus();
  await page.getByRole('toolbar').getByRole('button', { name: 'Move to...' }).click();
  await page.getByRole('button', { name: 'Choose column and row...' }).click();
  const place = page.getByRole('dialog', { name: 'Settings for Heading' });
  await expect(place).toBeVisible();
  const column = place.getByLabel('Column', { exact: true });
  await expect(column).toBeFocused();
  await column.fill('2');
  await page.keyboard.press('Tab');
  await expect(notice(page, 'Moved to column 2, row 2.')).toBeVisible();
  await expect(headingItem).toHaveAttribute('data-grid-place', '2:3:2:2');
  await column.fill('11');
  await page.keyboard.press('Enter');
  await expect(place.getByRole('alert')).toHaveText('Column can be 1 to 10 while the width is 3 columns.');
  await expect(column).toHaveAttribute('aria-invalid', 'true');
  // A refused Enter keeps what was typed, and the blur right after it does not speak the same bad text again.
  await expect(column).toHaveValue('11');
  await page.keyboard.press('Tab');
  await expect(column).toHaveValue('11');
  // A different bad text that is refused on blur puts the stored value back, the problem line stays.
  await column.fill('12');
  await page.keyboard.press('Tab');
  await expect(column).toHaveValue('2');
  await expect(place.getByRole('alert')).toHaveText('Column can be 1 to 10 while the width is 3 columns.');
  await expect(headingItem).toHaveAttribute('data-grid-place', '2:3:2:2');
  await column.focus();
  await page.keyboard.press('ArrowDown');
  await expect(notice(page, 'Moved to column 1, row 2.')).toBeVisible();
  await expect(headingItem).toHaveAttribute('data-grid-place', '1:3:2:2');
  await page.keyboard.press('Escape');
  await expect(place).toHaveCount(0);

  // 6. The overlap refusal: the Heading is 3 x 2, so at column 2, row 1 it would cover the Text.
  await d.dragBlockToCell('Heading', GRID_ID, 2, 1, 'taken');
  await expect(notice(page, 'Two parts cannot share the same cells. Move or resize one of them to empty cells.')).toBeVisible();
  await expect(textItem).toHaveAttribute('data-grid-place', '1:6:1:1');
  await expect(headingItem).toHaveAttribute('data-grid-place', '1:3:2:2');
  await d.save();
});

test('the Preview shows the placement at md and the stack below md', async ({ page }) => {
  const ids = await placedIds(page);
  const scope = await openPreview(page);
  const text = scope.getByTestId(ids.text);
  const heading = scope.getByTestId(ids.heading);
  await expect(text).toBeVisible({ timeout: 30_000 });
  await expect(heading).toBeVisible();

  const a = await text.boundingBox();
  const b = await heading.boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(2);
  const ratio = a.width / b.width;
  expect(ratio).toBeGreaterThan(1.7);
  expect(ratio).toBeLessThan(2.3);

  await page.setViewportSize({ width: 600, height: 800 });
  // The page padding animates for a moment after the resize, so the whole stack is polled as one reading.
  await expect
    .poll(async () => {
      const [t, h] = [await text.boundingBox(), await heading.boundingBox()];
      const stacked = h.y >= t.y + t.height - 1;
      return stacked && Math.abs(t.width - h.width) <= 2 && Math.abs(t.x - h.x) <= 2;
    })
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
});

test('Export carries the free Grid and its blocks', async ({ page }) => {
  await page.goto('/apps');
  const card = page.getByRole('listitem').filter({ hasText: APP_NAME }).first();
  await card.getByRole('button', { name: `More actions for ${APP_NAME}` }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  const file = await download;
  const spec = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
  const grid = spec.pages[0].layout.children[0];
  expect(grid.type).toBe('Grid');
  expect(grid.props).toMatchObject({ placement: 'free', columns: 12, rows: 3 });
  const blockOf = (type) => grid.children.find((c) => c.type === type).grid;
  expect(blockOf('Text')).toEqual({ col: 1, span: 6, row: 1, rowSpan: 1 });
  expect(blockOf('Heading')).toEqual({ col: 1, span: 3, row: 2, rowSpan: 2 });
  expect(ctx.server.outbound()).toEqual([]);
});

test('switching back to flow asks first, keeps the parts and forgets their places', async ({ page }) => {
  const d = design(page);
  await d.open(APP_NAME);
  const settings = await d.openSettings('Auto grid');
  const free = settings.getByRole('switch', { name: 'Place parts freely' });
  await expect(free).toBeChecked();
  await free.click();

  const confirm = page.getByRole('alertdialog', { name: 'Stop placing parts freely?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Their places are forgotten.');
  await expect(confirm).toContainText('Ctrl+Z brings them back.');
  await expect(confirm.getByRole('button', { name: 'Keep places' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Stop placing freely' }).click();

  await expect(notice(page, 'Auto grid now puts parts one after the other.')).toBeVisible();
  await expect(free).toBeFocused();
  await expect(free).not.toBeChecked();
  await expect(page.locator('[data-grid-item]')).toHaveCount(0);
  await expect(d.named('Text')).toBeVisible();
  await expect(d.named('Heading')).toBeVisible();
});

// G-03 (phase 23): a part that spans rows 1 and 2 must not make the empty third row refuse a drop at column 1.
test('a tile dropped on the empty third row under a two row part lands there, with no refusal', async ({ page }) => {
  const spec = gridSpec();
  spec.app.name = 'Tall Part Grid';
  spec.app.slug = 'tall-part-grid';
  spec.app.identifier = 'com.example.tallpartgrid';
  expect((await page.request.post('/api/studio/apps/import', { data: { spec } })).status()).toBe(201);

  const d = design(page);
  await d.open('Tall Part Grid');
  const settings = await d.openSettings('Auto grid');
  await settings.getByRole('switch', { name: 'Place parts freely' }).click();
  await expect(notice(page, 'Auto grid now places parts freely.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);

  // A part on row 1 made two rows high (rows 1 and 2).
  await d.dragTileToCell('Heading', GRID_ID, 1, 1);
  const items = page.locator('[data-grid-item]');
  const headingItem = items.filter({ has: page.getByRole('group', { name: 'Heading', exact: true }) });
  await expect(headingItem).toHaveAttribute('data-grid-place', '1:3:1:1');
  await d.named('Heading').focus();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(notice(page, 'Now 2 rows high, rows 1 to 2.')).toBeVisible();
  await expect(headingItem).toHaveAttribute('data-grid-place', '1:3:1:2');

  // A tile onto the empty third row at column 1.
  await d.dragTileToCell('Text', GRID_ID, 1, 3);
  const textItem = items.filter({ has: page.getByRole('group', { name: 'Text', exact: true }) });
  await expect(textItem).toHaveAttribute('data-grid-place', '1:3:3:1');
  await expect(headingItem).toHaveAttribute('data-grid-place', '1:3:1:2');
  await expect(page.locator('[role="status"]:not(.sr-only)').filter({ hasText: /cannot share|Cells taken/i })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: /cannot share|Cells taken/i })).toHaveCount(0);
});
