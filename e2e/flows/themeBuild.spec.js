// Theme, add and preview in one flow: pick Forest on the Look tab (the canvas shows it, Studio keeps the kit look), add a
// part with Add here and Add, Save, and see both the part and the Forest accent in the Preview. Studio Settings stays on the
// kit theme. The keyboard path is the main one (design risk R3). Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
const canvas = (page) => page.getByRole('region', { name: 'Page layout' });
const brandOf = (locator) => locator.evaluate((el) => getComputedStyle(el).getPropertyValue('--brand').trim());
const studioBrand = (page) => brandOf(page.locator('header').first());

let kitBrand = '';
let forestBrand = '';
let appId = '';

async function openDesign(page) {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await steps(page).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(canvas(page)).toBeVisible();
}

test('Crew Roster starts on the kit look in Studio and on the canvas', async ({ page }) => {
  const created = await (await page.request.post('/api/studio/apps', { data: { name: 'Crew Roster' } })).json();
  const record = created.data;
  appId = record.id;
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
  spec.pages[0].sources = [{ id: 'open_crews', table: 'crews', mode: 'list' }];
  spec.pages[0].layout = {
    ...spec.pages[0].layout,
    children: [
      { id: 'heading_a', type: 'Heading', props: { size: 'lg' }, children: 'Crew Roster' },
      { id: 'text_a', type: 'Text', props: {}, children: 'Who is on which crew.' },
    ],
  };
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);

  await openDesign(page);
  kitBrand = await studioBrand(page);
  expect(kitBrand).not.toBe('');
  // No theme id yet: the canvas wrapper shows the Studio value.
  expect(await brandOf(page.getByTestId('design-canvas'))).toBe(kitBrand);
});

test('picking Forest on the Look tab themes the canvas and leaves the Studio top bar on the kit theme', async ({ page }) => {
  await openDesign(page);
  await page.getByRole('tab', { name: 'Look' }).click();
  await expect(page.getByTestId('theme-picker')).toBeVisible();
  await page.getByTestId('theme-picker').getByText('Forest', { exact: true }).first().click();

  const themed = page.getByTestId('design-canvas');
  await expect.poll(() => brandOf(themed)).not.toBe(kitBrand);
  forestBrand = await brandOf(themed);
  expect(forestBrand).not.toBe('');
  expect(await studioBrand(page)).toBe(kitBrand);
  // The variables live on the wrapper only, never on the document root.
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--brand'))).toBe('');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  // Nothing is kept until Save: leaving without saving drops the pick, so the next test picks again.
});

test('Look, Add here, Add and Save keep both the theme and the new part', async ({ page }) => {
  await openDesign(page);
  await page.getByRole('tab', { name: 'Look' }).click();
  await page.getByTestId('theme-picker').getByText('Forest', { exact: true }).first().click();
  await expect.poll(() => brandOf(page.getByTestId('design-canvas'))).toBe(forestBrand);

  await page.getByRole('tab', { name: 'Features' }).click();
  await page.locator('[data-canvas-block][data-layer-id="heading_a"]').focus();
  await page.getByRole('button', { name: 'Add here: Page, place 2' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Pick a part to add in Page. Press Escape to cancel.')).toBeVisible();
  await page.getByRole('button', { name: 'Add Divider line' }).click();
  await expect(page.locator('[data-canvas-block]')).toHaveCount(4);
  // The themed canvas is still themed after the shelf work.
  expect(await brandOf(page.getByTestId('design-canvas'))).toBe(forestBrand);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);

  // The save went through the normal route: the stored spec holds the theme id and the new part.
  const stored = await (await page.request.get(`/api/studio/apps/${appId}`)).json();
  const spec = (stored.data ?? stored).spec;
  expect(spec.theme.id).toBe('forest');
  expect(JSON.stringify(spec.pages[0].layout)).toContain('Divider');
});

test('the Preview shows the added part in the Forest accent while Studio keeps the kit look', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await steps(page).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });

  const scope = page.getByTestId('preview-theme-scope');
  await expect(scope).toBeVisible();
  await expect(scope.getByRole('heading', { name: 'Crew Roster' })).toBeVisible();
  await expect(scope.locator('hr')).toHaveCount(1);
  expect(await brandOf(scope)).toBe(forestBrand);
  expect(await studioBrand(page)).toBe(kitBrand);
  expect(ctx.server.outbound()).toEqual([]);
});

test('Studio Settings looks the same as before', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true }).first()).toBeVisible();
  expect(await studioBrand(page)).toBe(kitBrand);
  expect(await brandOf(page.locator('body'))).toBe(kitBrand);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--brand'))).toBe('');
  expect(ctx.server.outbound()).toEqual([]);
});
