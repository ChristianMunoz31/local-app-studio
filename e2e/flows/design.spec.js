// Design on the canvas: add with Add here and Add, move and delete with the keyboard, Undo, settings in plain words, one
// drag, and Save. The keyboard path is the main one; a single drag test uses mouse.down, two moves and mouse.up.
// No layers panel, props panel or class field exists. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { dropPlaceLit, visibleNotice } from '../pages/design.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const canvas = (page) => page.getByRole('region', { name: 'Page layout' });
const block = (page, id) => page.locator(`[data-canvas-block][data-layer-id="${id}"]`);
const order = (page) => page.locator('[data-canvas-block]').evaluateAll((els) => els.map((el) => el.dataset.layerId));

async function openDesign(page) {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(canvas(page)).toBeVisible();
}

test('Design starts with the page on a canvas and none of the editor panels', async ({ page }) => {
  const created = await (await page.request.post('/api/studio/apps', { data: { name: 'Crew Roster' } })).json();
  const record = created.data;
  const spec = record.spec;
  spec.tables = [
    {
      id: 'crews',
      label: 'Crews',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', required: false, type: 'text' },
        { id: 'size', label: 'Size', required: false, type: 'integer' },
      ],
    },
  ];
  const root = spec.pages[0].layout;
  spec.pages[0].sources = [{ id: 'open_crews', table: 'crews', mode: 'list' }];
  spec.pages[0].layout = {
    ...root,
    children: [
      { id: 'heading_a', type: 'Heading', props: { size: 'lg' }, children: 'Crew Roster' },
      { id: 'text_a', type: 'Text', props: {}, children: 'Who is on which crew.' },
    ],
  };
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);

  await openDesign(page);
  await expect(canvas(page).getByRole('heading', { name: 'Crew Roster' })).toBeVisible();
  await expect(page.getByTestId('component-editor')).toHaveCount(0);
  await expect(page.getByText('className')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Advanced/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Features' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Look' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('Add here and Add put a part exactly where it was chosen, and Save keeps it', async ({ page }) => {
  await openDesign(page);
  await block(page, 'heading_a').focus();
  await page.getByRole('button', { name: 'Add here: Page, place 2' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Pick a part to add in Page. Press Escape to cancel.')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search parts and features' })).toBeFocused();
  await page.getByRole('button', { name: 'Add Divider line' }).click();
  expect(await order(page)).toEqual([expect.any(String), 'heading_a', 'divider_1', 'text_a']);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
});

test('keys move a block, Delete removes it and Undo brings it back', async ({ page }) => {
  await openDesign(page);
  await block(page, 'divider_1').click();
  await page.keyboard.press('Alt+ArrowDown');
  expect((await order(page)).slice(1)).toEqual(['heading_a', 'text_a', 'divider_1']);
  await expect(block(page, 'divider_1')).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  expect((await order(page)).slice(1)).toEqual(['heading_a', 'divider_1', 'text_a']);

  await page.keyboard.press('Delete');
  await expect(visibleNotice(page, 'Removed Divider line.')).toBeVisible();
  expect((await order(page)).slice(1)).toEqual(['heading_a', 'text_a']);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  expect((await order(page)).slice(1)).toEqual(['heading_a', 'divider_1', 'text_a']);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('the settings of a part use plain words and Apply changes the page', async ({ page }) => {
  await openDesign(page);
  await block(page, 'text_a').click();
  await page.getByRole('toolbar').getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings for Text' });
  await dialog.getByLabel('Text').fill('Crews and their leads.');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(canvas(page).getByText('Crews and their leads.')).toBeVisible();

  // A part that reads a list names the list by its table, never by an id.
  await page.getByRole('button', { name: 'Add Table of records' }).click();
  await page.getByRole('toolbar').getByRole('button', { name: 'Settings' }).click();
  const table = page.getByRole('dialog', { name: 'Settings for Table of records' });
  await expect(table.getByLabel('Table', { exact: true })).toContainText('Crews');
  await expect(table).not.toContainText('open_crews');
  await page.keyboard.press('Escape');
  await expect(table).toBeHidden();
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'Settings' })).toBeFocused();
});

test('a tile can be dragged onto a place of the page', async ({ page }) => {
  await openDesign(page);
  const before = await order(page);
  const tile = page.locator('[data-entry-key="part:Heading"]');
  await tile.hover();
  const from = await tile.boundingBox();
  await page.mouse.move(from.x + 20, from.y + 20);
  await page.mouse.down();
  // The activation move stays level: a move down would put the pointer in dnd-kit's bottom auto-scroll band and the page would
  // scroll while the zone's box is read, so the drop would land one place too low (the phase 22 debugger's trace).
  await page.mouse.move(from.x + 60, from.y, { steps: 5 });
  const zone = page.locator(`[data-zone="${before[0]}:1"]`);
  await expect(zone).toBeVisible();
  const to = await zone.boundingBox();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await dropPlaceLit(page);
  await page.mouse.up();
  await expect(page.locator('[data-canvas-block]')).toHaveCount(before.length + 1);
  expect((await order(page)).slice(0, 3)).toEqual([before[0], before[1], 'heading_1']);
});

test('the Look tab changes the canvas right away and Save keeps it', async ({ page }) => {
  await openDesign(page);
  await page.getByRole('tab', { name: 'Look' }).click();
  await page.getByText('Forest', { exact: true }).first().click();
  const brand = (selector) => page.locator(selector).evaluate((el) => getComputedStyle(el).getPropertyValue('--brand').trim());
  const themed = await brand('[data-testid="design-canvas"]');
  const chrome = await brand('body');
  expect(themed).not.toBe('');
  expect(themed).not.toBe(chrome);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
  expect(ctx.server.outbound()).toEqual([]);
});
