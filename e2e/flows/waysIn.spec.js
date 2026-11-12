// A way to add records (phase 25): the Preview offer (menu on: menu buttons, one save, Undo), the Design line (menu off: a Form,
// one Undo step, Redo, Save), and the Data offer after a save that adds a table. Nothing leaves this computer. Studio API calls
// (estimate): about 120 (page loads and their status polls, two creates, a handful of saves and their reads), well under the 300
// per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { preview } from '../pages/preview.js';
import { crewRosterSpec, getApp, makeApp } from '../support/critiqueApps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const MENU_APP = 'Ways Menu';
const PLAIN_APP = 'Ways Plain';
const OFFER = 'Add a way to add records';

/** Crew Roster (People and Crews, a list of Crews, no Form, no Button) with or without the menu bar. */
const ids = {};

async function seed(request, name, withMenu) {
  const crew = crewRosterSpec();
  return makeApp(request, name, (spec) => {
    spec.tables = crew.tables;
    spec.pages = crew.pages.map((p) => ({ ...p, sources: p.sources.map((s) => ({ ...s, mode: 'list' })) }));
    spec.nav = crew.nav;
    if (withMenu) spec.menu = { position: 'top', style: 'icons-and-labels' };
  });
}

const actions = (spec, slot) => (spec.menu?.[slot] ?? []).map((l) => l.props.action);

test('setup: two apps with no way to add records, one with the menu bar and one without', async ({ page }) => {
  ids.menu = (await seed(page.request, MENU_APP, true)).id;
  ids.plain = (await seed(page.request, PLAIN_APP, false)).id;
});

test('Preview with the menu bar on: one press adds a menu button for each table, Undo takes them away', async ({ page }) => {
  const scope = await preview(page).open(MENU_APP);
  const offer = page.getByRole('button', { name: OFFER });
  await expect(page.getByText('People and Crews have no way to add records yet.')).toBeVisible();

  await offer.click();
  await expect(visibleNotice(page, /Added a menu button for People and a menu button for Crews/)).toBeVisible();
  const saved = await getApp(page.request, ids.menu);
  expect(actions(saved.spec, 'end')).toEqual([
    { action: 'open-form', table: 'people', mode: 'create' },
    { action: 'open-form', table: 'crews', mode: 'create' },
  ]);
  await expect(scope.getByText('Add to Crews').first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Undone.')).toBeVisible();
  await expect(page.getByText('People and Crews have no way to add records yet.')).toBeVisible();
  expect(actions((await getApp(page.request, ids.menu)).spec, 'end')).toEqual([]);
  expect(ctx.server.outbound()).toEqual([]);
});

test('Design with no menu bar: the line adds a Form after the list, one Undo takes it away, Redo and Save keep it', async ({ page }) => {
  const d = design(page);
  await d.open(PLAIN_APP);
  await expect(page.getByText('People and Crews have no way to add records yet.')).toBeVisible();

  await page.getByRole('button', { name: OFFER }).click();
  await expect(visibleNotice(page, 'Added a Form for')).toBeVisible();
  const forms = page.locator('[data-canvas-block][data-layer-id^="recordform"]');
  await expect(forms).toHaveCount(1);

  await d.undo().click();
  await expect(forms).toHaveCount(0);
  await expect(page.getByRole('button', { name: OFFER })).toBeVisible();

  await d.redo().click();
  await expect(forms).toHaveCount(1);
  await d.save();

  const saved = (await getApp(page.request, ids.plain)).spec;
  const kids = saved.pages[0].layout.children;
  expect(kids.filter((c) => c.type === 'RecordForm').map((c) => c.props)).toEqual([{ table: 'crews', mode: 'create' }]);
  await expect(page.getByRole('region', { name: 'This page' })).toContainText(/form/i);
  expect(ctx.server.outbound()).toEqual([]);
});

async function addVendors(page, id) {
  await page.goto(`/apps/${id}/data`);
  await page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: 'Add table' }).click();
  await page.getByLabel('Table name').fill('Vendors');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

test('Data: a new table is offered a way in; with the menu bar it is one press, without it the sentence says where to start', async ({ page }) => {
  await addVendors(page, ids.menu);
  await expect(page.getByText('Vendors has no way to add records yet.')).toBeVisible();
  await page.getByRole('button', { name: OFFER }).click();
  await expect(visibleNotice(page, 'Added a menu button for Vendors')).toBeVisible();
  const withMenu = (await getApp(page.request, ids.menu)).spec;
  expect(actions(withMenu, 'end')).toEqual([{ action: 'open-form', table: 'vendors', mode: 'create' }]);
  expect(withMenu.menu.end[0].children).toBe('Add to Vendors');

  await addVendors(page, ids.plain);
  await expect(page.getByText('Vendors has no way to add records yet. Show it on a page in Design first.')).toBeVisible();
  await expect(page.getByRole('button', { name: OFFER })).toHaveCount(0);
  expect(ctx.server.outbound()).toEqual([]);
});
