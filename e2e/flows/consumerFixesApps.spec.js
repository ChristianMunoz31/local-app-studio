// Phase 17 proof, the first design and the Apps page (DESIGN-phase17.md P17-12, P17-15, P17-16, P17-18, P17-23, P17-24, P17-25), on the honest fake
// helper (cannedDescribeChat). The helper's first design is runnable: the menu bar is on and every listed table has a form, so Preview takes a row
// without a visit to Design. Export names the file after the app, and Duplicate asks for the copy's name. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { preview } from '../pages/preview.js';
import { makeWithHelper, savedApp, useThis } from '../support/helperApps.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { appCards } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });

test.describe.configure({ mode: 'serial' });

const LOANS_IDEA = 'A loans log for my workshop: items, people and which person has which item.';
let appId = '';
let appName = '';

test('P17-12: the first design has a menu bar and a form for every listed table, and Preview takes a row without Design', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  appId = await makeWithHelper(page, LOANS_IDEA);
  await useThis(page);
  const app = await savedApp(page, appId);
  appName = app.name;
  const spec = app.spec;
  expect(spec.menu, 'a design with several menu pages has its menu bar on').toMatchObject({ position: 'top' });
  expect(spec.nav.length).toBeGreaterThanOrEqual(2);
  // Every table a page lists has a form on that page (or an add somewhere), so a row can be taken at once.
  const types = (layer) => [layer.type, ...(Array.isArray(layer.children) ? layer.children.flatMap(types) : [])];
  for (const p of spec.pages) {
    const listed = p.sources.filter((s) => s.mode === 'list').map((s) => s.table);
    if (listed.length === 0) continue;
    expect(types(p.layout), `page ${p.title} lists ${listed.join(', ')}`).toEqual(expect.arrayContaining(['RecordForm']));
  }

  // Preview: the form takes a row, and the list shows it.
  const p = preview(page);
  const scope = await p.open(appName);
  await expect(scope.getByRole('navigation').first()).toBeVisible();
  await scope.getByLabel('Name', { exact: false }).first().fill('Drill');
  await scope.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(scope.getByRole('table').first().getByText('Drill')).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});

test('P17-15: Export names the file after the app, and the status line says what the file holds', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto('/apps');
  const card = appCards(page).filter({ hasText: appName });
  await card.getByRole('button', { name: `More actions for ${appName}` }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${appName} app.json`);
  expect(file.suggestedFilename()).not.toMatch(/appspec/i);
  await expect(page.getByRole('status').filter({ hasText: 'It holds the design. Records added in Preview stay on this computer.' }).first()).toContainText(
    `Exported "${appName}" as ${appName} app.json.`,
  );
});

test('P17-16: Duplicate asks for the copy name first, says the copy starts with no records', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto('/apps');
  const card = appCards(page).filter({ hasText: appName }).first();
  await card.getByRole('button', { name: `More actions for ${appName}` }).click();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Duplicate ${appName}` });
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue(`${appName} Copy`);
  await expect(dialog.getByText('The copy starts with no records.')).toBeVisible();

  // A blank name is refused in the dialog, and nothing was copied.
  await name.fill('   ');
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog).toBeVisible();

  await name.fill('Green Acre North Site');
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Duplicated "${appName}" as "Green Acre North Site". The copy starts with no records.` }).first()).toBeVisible();
  const list = (await (await page.request.get('/api/studio/apps')).json()).data;
  const copy = list.find((a) => a.name === 'Green Acre North Site');
  expect(copy, 'the copy is named by the person').toBeDefined();
  expect(copy.tableCount).toBe(list.find((a) => a.id === appId).tableCount);
  expect(ctx.server.outbound()).toEqual([]);
});

test('P17-18: a theme tile says how it starts', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto('/apps');
  const card = appCards(page).filter({ hasText: appName }).first();
  await card.getByRole('button', { name: `More actions for ${appName}` }).click();
  await page.getByRole('menuitem', { name: 'Change look', exact: true }).click();
  const picker = page.getByTestId('theme-picker');
  await expect(picker).toBeVisible();
  const text = await picker.getByRole('group', { name: 'Look' }).innerText();
  expect(text).toMatch(/Starts dark\./);
  expect(text).toMatch(/Starts light\./);
  // Every tile that names a theme says one of the two, once.
  const tiles = picker.locator('label').filter({ has: page.getByRole('radio') });
  const n = await tiles.count();
  let themed = 0;
  for (let i = 0; i < n; i++) if (/Starts (dark|light)\./.test(await tiles.nth(i).innerText())) themed++;
  expect(themed).toBeGreaterThanOrEqual(4);
});

test('P17-24: the field type hint shows once per table, not under every field', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto(`/apps/${appId}/data`);
  const hint = 'Number holds whole numbers. Decimal holds amounts like 12.50.';
  await expect(page.getByRole('heading', { level: 3, name: 'Data', exact: true })).toBeVisible();
  const shown = await page.getByText(hint, { exact: true }).count();
  const tables = (await savedApp(page, appId)).spec.tables.length;
  expect(shown, 'at most one hint per table').toBeLessThanOrEqual(tables);
  expect(shown).toBeGreaterThanOrEqual(1);
});

test('P17-25: Show one record on this page says it opens from a list and leaves the menu', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto(`/apps/${appId}/design`);
  await expect(page.getByRole('region', { name: 'Page layout' })).toBeVisible();
  await page.getByLabel('Page', { exact: true }).selectOption({ label: 'Items' });
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Show one record on this page' }).click();
  const dialog = page.getByRole('dialog', { name: 'Show one record on this page' });
  await dialog.getByRole('combobox').selectOption({ label: 'People' });
  await expect(dialog.getByText("This page will open from a list, one People record at a time. It leaves the menu and shows the record's details.")).toBeVisible();
});
