// Columns on the canvas and in the app: add Columns with Add here, put a button in the right column with the keyboard and a text in
// the left column with one real drag, add and remove a column with Undo, Save, and see the two sides next to each other in the
// Preview (and stacked on a narrow screen). Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

test('Add here puts Columns on the page and a button in the right column, with the keyboard', async ({ page }) => {
  const created = await (await page.request.post('/api/studio/apps', { data: { name: 'Crew Roster' } })).json();
  expect(created.data.name).toBe('Crew Roster');

  const d = design(page);
  await d.open();
  const first = (await d.order())[1];
  await d.block(first).focus();
  await d.addAt('Add here: Page, place 2', 'Columns');
  await expect(d.named('Column 1 of 2')).toBeVisible();
  await expect(d.named('Column 2 of 2')).toBeVisible();

  // The left column is on the left of the right one.
  const left = await d.named('Column 1 of 2').boundingBox();
  const right = await d.named('Column 2 of 2').boundingBox();
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);

  await d.addAt('Add here: Column 2 of 2, place 1', 'Button');
  await expect(d.named('Column 2 of 2').getByRole('group', { name: 'Button', exact: true })).toBeVisible();
  await d.save();
});

test('one drag puts a text into the left column, and Save keeps the layout', async ({ page }) => {
  const d = design(page);
  await d.open();
  const leftId = await d.named('Column 1 of 2').getAttribute('data-layer-id');
  const before = await d.named('Column 1 of 2').getByRole('group').count();
  await d.dragTile('Text', `${leftId}:0`);
  await expect(d.named('Column 1 of 2').getByRole('group')).toHaveCount(before + 1);
  await d.save();
});

test('Add a column, Remove this column and Undo', async ({ page }) => {
  const d = design(page);
  await d.open();
  const settings = await d.openSettings('Columns');
  await settings.getByRole('button', { name: 'Add a column' }).click();
  await expect(d.named('Column 3 of 3')).toBeVisible();

  const column = await d.openSettings('Column 3 of 3');
  await column.getByRole('button', { name: 'Remove this column' }).click();
  await expect(visibleNotice(page, 'Removed Column 3.')).toBeVisible();
  await expect(d.named('Column 3 of 3')).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(d.named('Column 3 of 3')).toBeVisible();
  // Never saved: the app keeps its two columns.
});

test('the Preview shows the two sides next to each other, and stacked on a narrow screen', async ({ page }) => {
  // A starter app (no tables, one page) shows "Write your prompt first" in Preview, so give it a second page.
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  const app = (await (await page.request.get(`/api/studio/apps/${list.find((a) => a.name === 'Crew Roster').id}`)).json()).data;
  const spec = app.spec;
  spec.pages.push({ id: 'about', title: 'About', route: '/about', sources: [], layout: { id: 'page_about', type: 'Page', props: {}, children: [] } });
  const put = await page.request.put(`/api/studio/apps/${app.id}`, { data: { spec, baseRevision: app.revision } });
  expect(put.status()).toBe(200);

  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });

  const scope = page.getByTestId('preview-theme-scope');
  const text = scope.getByText('Text', { exact: true }).first();
  const button = scope.getByRole('button', { name: 'Button', exact: true });
  await expect(text).toBeVisible();
  await expect(button).toBeVisible();
  const a = await text.boundingBox();
  const b = await button.boundingBox();
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
  expect(Math.abs(a.y - b.y)).toBeLessThan(60);

  await page.setViewportSize({ width: 600, height: 800 });
  await expect.poll(async () => (await button.boundingBox()).y).toBeGreaterThan(a.y + a.height - 1);
  expect(ctx.server.outbound()).toEqual([]);
});
