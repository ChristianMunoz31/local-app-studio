// Navigation parts and the app menu bar: add Page links with Add here and Add, pick "Across the top" on the Look tab, Save,
// and see the menu bar and the links in Preview; clicking one changes the page. Keyboard path first. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
const canvas = (page) => page.getByRole('region', { name: 'Page layout' });
let appId = '';

async function openDesign(page) {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await steps(page).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(canvas(page)).toBeVisible();
}

test('Crew Roster starts with two pages in its menu and no menu bar', async ({ page }) => {
  const created = await (await page.request.post('/api/studio/apps', { data: { name: 'Crew Roster' } })).json();
  const record = created.data;
  appId = record.id;
  const spec = record.spec;
  const home = spec.pages[0];
  home.layout = {
    ...home.layout,
    children: [
      { id: 'heading_a', type: 'Heading', props: { size: 'lg' }, children: 'Crew Roster home' },
      { id: 'text_a', type: 'Text', props: {}, children: 'Welcome.' },
    ],
  };
  spec.pages.push({
    id: 'about',
    title: 'About',
    route: '/about',
    sources: [],
    layout: { id: 'page_about', type: 'Page', props: {}, children: [{ id: 'heading_b', type: 'Heading', props: { size: 'lg' }, children: 'About the roster' }] },
  });
  spec.nav = [
    { pageId: home.id, label: 'Home', icon: 'home' },
    { pageId: 'about', label: 'About', icon: 'file' },
  ];
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);
  expect('menu' in (await (await page.request.get(`/api/studio/apps/${record.id}`)).json()).data.spec).toBe(false);
});

test('Page links are added with Add here and Add, the menu bar is picked on the Look tab, and Save keeps both', async ({ page }) => {
  await openDesign(page);
  await page.locator('[data-canvas-block][data-layer-id="heading_a"]').focus();
  await page.getByRole('button', { name: 'Add here: Page, place 2' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add Page links' }).click();
  await expect(page.locator('[data-canvas-block]')).toHaveCount(4);

  await page.getByRole('tab', { name: 'Look' }).click();
  const bar = page.getByRole('group', { name: 'Menu bar' });
  await expect(bar).toBeVisible();
  await expect(page.getByText('Shows on every page of the app. Save to keep it.')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Words only' })).toBeDisabled();
  await bar.getByText('Across the top', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Words only' })).toBeEnabled();
  await page.getByText('Words only', { exact: true }).click();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
  const stored = await (await page.request.get(`/api/studio/apps/${appId}`)).json();
  const spec = (stored.data ?? stored).spec;
  expect(spec.menu).toEqual({ position: 'top', style: 'labels' });
  expect(JSON.stringify(spec.pages[0].layout)).toContain('NavLinks');
});

test('Preview shows the menu bar and the links, and clicking one changes the page', async ({ page }) => {
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await steps(page).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });

  const scope = page.getByTestId('preview-theme-scope');
  const menu = scope.getByRole('navigation', { name: 'App menu' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(scope.getByRole('navigation', { name: 'Page links' })).toBeVisible();
  await expect(scope.getByRole('heading', { name: 'Crew Roster home' })).toBeVisible();

  await scope.getByRole('navigation', { name: 'Page links' }).getByRole('button', { name: 'About' }).click();
  await expect(scope.getByRole('heading', { name: 'About the roster' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('link', { name: 'Home' }).click();
  await expect(scope.getByRole('heading', { name: 'Crew Roster home' })).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});

test('Preview: a side menu collapses to icons and the choice survives a reload', async ({ page }) => {
  const record = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data;
  const spec = { ...record.spec, menu: { position: 'side' } };
  expect((await page.request.put(`/api/studio/apps/${appId}`, { data: { spec, baseRevision: record.revision } })).status()).toBe(200);
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await steps(page).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });

  const scope = page.getByTestId('preview-theme-scope');
  const menu = scope.getByRole('navigation', { name: 'App menu' });
  await scope.getByRole('button', { name: 'Side menu' }).click();
  const expand = scope.getByRole('button', { name: 'Side menu' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(menu.getByRole('link', { name: 'About' })).toHaveAttribute('title', 'About');
  await expect(menu.getByText('About', { exact: true })).toBeHidden();
  await page.reload();
  await expect(scope.getByRole('button', { name: 'Side menu' })).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
  await scope.getByRole('button', { name: 'Side menu' }).click();
  await expect(menu.getByText('About', { exact: true })).toBeVisible();
  expect(await (await page.request.get(`/api/studio/apps/${appId}`)).json()).not.toHaveProperty('data.spec.menu.collapsed');
});

test('"No menu bar" removes the key again', async ({ page }) => {
  await openDesign(page);
  await page.getByRole('tab', { name: 'Look' }).click();
  await page.getByRole('group', { name: 'Menu bar' }).getByText('No menu bar', { exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
  const stored = await (await page.request.get(`/api/studio/apps/${appId}`)).json();
  expect('menu' in (stored.data ?? stored).spec).toBe(false);
});
