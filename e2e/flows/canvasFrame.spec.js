// The canvas frame (phase 19): on Preview the running app sits in a frame whose toolbar holds the app's name, Show as and Enlarge. Enlarge fills
// the window in a dialog without restarting the app (the typed value and the open page stay), the rest of Studio is out of reach, a form the app
// opens stays on top and works, and Escape shrinks it. On Design the toolbar holds Show as and there is no Enlarge. Nothing leaves this computer.
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { design } from '../pages/design.js';
import { preview } from '../pages/preview.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const crewRoster = () => JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));

/** The Crew Roster fixture with a second page that has a form, a menu bar across the top and a menu button that opens a form for Crews. */
function framedSpec() {
  const spec = crewRoster();
  spec.pages.push({
    id: 'about',
    title: 'About',
    route: '/about',
    sources: [],
    layout: {
      id: 'page_about',
      type: 'Page',
      props: {},
      children: [
        { id: 'heading_about', type: 'Heading', props: { size: 'lg' }, children: 'About the roster' },
        { id: 'form_about', type: 'RecordForm', props: { table: 'crews', fields: ['name'], submitLabel: 'Add crew' }, children: [] },
      ],
    },
  });
  spec.nav = [
    { pageId: 'home', label: 'Home', icon: 'home' },
    { pageId: 'about', label: 'About', icon: 'file' },
  ];
  spec.menu = {
    position: 'top',
    end: [{ id: 'menu_add', type: 'Button', props: { action: { action: 'open-form', table: 'crews', mode: 'create' } }, children: 'Add to Crews' }],
  };
  return spec;
}

test('Preview: Enlarge keeps the running app, covers Studio, keeps a form the app opens usable, and Escape shrinks it', async ({ page }) => {
  const imported = await page.request.post('/api/studio/apps/import', { data: { spec: framedSpec() } });
  expect(imported.status()).toBe(201);

  const scope = await preview(page).open('Crew Roster');
  await scope.getByRole('navigation', { name: 'App menu' }).getByRole('link', { name: 'About' }).click();
  await expect(scope.getByRole('heading', { name: 'About the roster' })).toBeVisible();
  const field = scope.getByLabel('Name');
  await field.fill('Kept crew');

  // The toolbar is part of the frame, with the app's name and Show as.
  const enlarge = page.getByRole('button', { name: 'Enlarge' });
  await expect(enlarge).toBeVisible();
  await expect(page.getByRole('group', { name: 'Show as' })).toHaveCount(1);

  await enlarge.click();
  const layer = page.getByRole('dialog', { name: 'Crew Roster, enlarged' });
  await expect(layer).toBeVisible();
  await expect(layer.getByRole('button', { name: 'Shrink' })).toBeFocused();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(layer.getByTestId('preview-theme-scope')).toBeVisible();

  // The layer covers the top bar: the element at the top bar's centre is inside the dialog.
  const bar = await page.locator('#root header').first().boundingBox();
  expect(bar).not.toBeNull();
  const covered = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? null, {
    x: (bar?.x ?? 0) + (bar?.width ?? 0) / 2,
    y: (bar?.y ?? 0) + (bar?.height ?? 0) / 2,
  });
  expect(covered).toBe('Crew Roster, enlarged');

  // Ten Tabs never reach Studio behind the layer.
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('#root') !== null)).toBe(false);
  }

  // The app was moved, not restarted: the open page and the typed value are still there.
  await expect(layer.getByRole('heading', { name: 'About the roster' })).toBeVisible();
  await expect(layer.getByLabel('Name')).toHaveValue('Kept crew');

  // A form the app opens sits above the layer and takes a real click.
  await layer.locator('[data-menu-slot="end"]').getByRole('button', { name: 'Add to Crews' }).click();
  const form = page.getByRole('dialog', { name: 'Add to Crews' });
  await expect(form).toBeVisible();
  await form.getByLabel('Name').fill('Enlarged crew');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(layer).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(layer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enlarge' })).toBeFocused();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', /.*/);
  await expect(scope.getByLabel('Name')).toHaveValue('Kept crew');
  await expect(scope.getByRole('heading', { name: 'About the roster' })).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});

test('Design: Show as is in the canvas toolbar and switches the canvas, and there is no Enlarge', async ({ page }) => {
  const d = design(page);
  await d.open();
  const group = d.canvas.getByRole('group', { name: 'Show as' });
  await expect(group).toBeVisible();
  await expect(page.getByRole('group', { name: 'Show as' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Enlarge' })).toHaveCount(0);
  await group.getByText('Dark', { exact: true }).click();
  await expect(page.getByTestId('design-canvas')).toHaveAttribute('data-theme-mode', 'dark');
  await group.getByText('Light', { exact: true }).click();
  await expect(page.getByTestId('design-canvas')).toHaveAttribute('data-theme-mode', 'light');
  expect(ctx.server.outbound()).toEqual([]);
});
