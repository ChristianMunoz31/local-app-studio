// Phase 16, Part B (DESIGN-phase16.md 2.3, 3 and 5.1): the one indicator on the Design canvas and the page strip above it.
//   - the three states in exact words ("Connected to Crews", "Needs a table", "Needs a yes or no field") with their one-click offers,
//     nothing on a part that uses no data, the popover pill and its mode line, the screen reader names;
//   - the pill never covers anything: its box does not intersect the selected part's toolbar, an "Add here" pill or a neighbour's pill,
//     at 1280 and at 1024;
//   - the Data connections list says the same words, and the shelf tile and the Features page tile say "Needs a table" for data parts
//     and data features when there is no table to connect them to;
//   - the page strip: the page in one line, Ask lands on Prompt with the edit launch ("On the page Home: ...") and a design to look at,
//     and Design then says the helper's design is waiting on Prompt, with Open Prompt.
// Nothing leaves this computer. Studio API calls (estimate): about 110 (page loads and their polls, three app creates, one design run,
// the spec reads), well under the 300 per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { describeFakeChat } from '../support/describeFake.js';
import { importCrewRoster, makeApp } from '../support/critiqueApps.js';
import { design, visibleNotice } from '../pages/design.js';
import { features } from '../pages/features.js';
import { skipWithoutPro } from '../support/proBuild.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: describeFakeChat });

test.describe.configure({ mode: 'serial' });

const steps = (page) => page.getByRole('navigation', { name: 'Steps' });

/** The Table choice of an open settings dialog, set to a table; then the dialog is closed (it may already have closed itself). */
async function chooseTable(page, partName, table) {
  const dialog = page.getByRole('dialog', { name: `Settings for ${partName}` });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Table', { exact: true }).selectOption({ label: table });
  await closeDialogs(page);
}

async function closeDialogs(page) {
  const dialog = page.getByRole('dialog');
  if ((await dialog.count()) > 0) {
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
}

/**
 * Page actions > Add a page "Archive", then its first part focused so the zone "Add here: Page, place 2" exists. Home already lists
 * Crews (open_crews), so a Table of records dropped there connects by itself; a new page has no list, so with two tables that fit
 * the part is not connected and says Needs a table.
 */
async function openArchive(page, app) {
  const d = design(page);
  await d.open(app);
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Add a page' }).click();
  await page.getByLabel('Page title').fill('Archive');
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(d.page()).toHaveValue(/archive/);
  const first = (await d.order())[0];
  await d.block(first).focus();
  return d;
}

/** The blocks of Home focused first: the zone "Add here: Page, place 2" then exists. Returns the design helper. */
async function openHome(page, app) {
  const d = design(page);
  await d.open(app);
  const first = (await d.order())[0];
  await d.block(first).focus();
  return d;
}

const overlap = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** Every box (visible, laid out) of a locator, with a label. */
async function boxes(locator, label) {
  const out = [];
  const all = await locator.all();
  for (let i = 0; i < all.length; i += 1) {
    const box = await all[i].boundingBox();
    if (box !== null && box.width > 0 && box.height > 0) out.push({ label: `${label} ${i + 1}`, box });
  }
  return out;
}

test('Crew Roster: Connected to Crews, Needs a table with Connect, Needs a yes or no field with Add a field, and nothing on a Heading', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const made = await importCrewRoster(page.request, 'Crew Roster');
  expect(made.id).not.toBe('');
  const d = await openHome(page, 'Crew Roster');

  // A part that uses no data has no pill at all.
  await expect(d.block('h1')).toBeVisible();
  await expect(d.indicator('h1')).toHaveCount(0);
  await expect(d.badge('h1')).toHaveCount(0);

  // On a page with no list, two tables fit a Table of records, so it is not connected by itself: the dashed box starts with the pill, then Connect.
  // (On Home a Table of records joins the Crews list that is already there and says Connected at once.)
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Add a page' }).click();
  await page.getByLabel('Page title').fill('Archive');
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(d.page()).toHaveValue(/archive/);
  await d.block((await d.order())[0]).focus();
  await d.addAt('Add here: Page, place 2', 'Table of records');
  const box = d.notConnected('datatable_1');
  await expect(box).toBeVisible();
  await expect(box.locator('[data-indicator]')).toHaveText('Needs a table');
  await expect(box.locator('[data-indicator]')).toHaveAttribute('data-indicator', 'needs_table');
  await expect(box.getByRole('button', { name: 'Connect Table of records to a table' })).toBeVisible();
  // The old words are gone.
  await expect(page.getByText('Not connected to a table')).toHaveCount(0);
  await expect(page.getByText(/^Table: /)).toHaveCount(0);
  // The box says "Needs a table" in the pill and not a second time in a sentence (a table fits, so there is no hint).
  await expect(box.getByText('This app has no table yet.')).toHaveCount(0);

  await box.getByRole('button', { name: 'Connect Table of records to a table' }).click();
  await chooseTable(page, 'Table of records', 'Crews');
  await expect(d.notConnected('datatable_1')).toHaveCount(0);

  // Connected: the pill is the Change table button, in the table's words, green.
  const pill = d.badge('datatable_1');
  await expect(pill).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(pill).toHaveAttribute('data-indicator', 'connected');
  await expect(pill).toHaveAttribute('data-connection-badge', 'crews');
  await expect(pill).not.toHaveAttribute('title', /./);
  // Screen reader name: the visible words first, then what pressing it does.
  await expect(d.block('datatable_1').getByRole('button', { name: 'Connected to Crews. Change table', exact: true })).toHaveCount(1);
  await expect(d.indicator('datatable_1')).toHaveCount(1);

  // One click on the pill opens the settings on the table choice; its own pill is plain (no button) and a line says what the part does.
  const dialog = await d.changeTable('datatable_1', 'Table of records');
  await expect(dialog.locator('[data-connection-badge]')).toHaveText('Connected to Crews');
  await expect(dialog.getByRole('button', { name: /Change table/ })).toHaveCount(0);
  await expect(dialog).toContainText('It shows records.');
  await expect(dialog.getByLabel('Table', { exact: true })).toBeVisible();
  await closeDialogs(page);

  // No table has a yes or no field: the Checklist says what it needs, and offers Add a field and New table in one click each.
  await d.block('datatable_1').focus();
  await d.addAt('Add here: Page, place 3', 'Checklist');
  const need = d.notConnected('checklist_1');
  await expect(need.locator('[data-indicator]')).toHaveText('Needs a yes or no field');
  await expect(need.locator('[data-indicator]')).toHaveAttribute('data-indicator', 'needs_field');
  await expect(need.getByRole('button', { name: 'Add a field for Checklist' })).toHaveText('Add a field');
  await expect(need.getByRole('button', { name: 'Make a new table for Checklist' })).toHaveText('New table');
  await expect(need.getByRole('button', { name: 'Connect Checklist to a table' })).toHaveCount(0);
  // A plain pill is text, not a button: the words are what a screen reader reads, then the labelled buttons.
  await expect(need.locator('[data-indicator]')).toHaveJSProperty('tagName', 'SPAN');
  // Its settings carry no mode line for a part with no table, and say what to do.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  // Add a field makes it connect: the pill turns to the table's words.
  await d.addField('checklist_1', 'Done', 'Crews');
  await expect(visibleNotice(page, 'Added the field Done to Crews.')).toBeVisible();
  await expect(d.badge('checklist_1')).toHaveAccessibleName('Connected to Crews. Change table');
  expect(ctx.server.outbound()).toEqual([]);
});

test('the pill never covers the selected part toolbar, an Add here pill or a neighbour pill, at 1280 and at 1024', async ({ page }) => {
  const made = await importCrewRoster(page.request, 'Pill Boxes');
  expect(made.id).not.toBe('');
  await page.setViewportSize({ width: 1280, height: 900 });
  const d = await openArchive(page, 'Pill Boxes');

  // A Table of records, a Checklist that needs a field, and a Quick add beside the table (a narrow neighbour that needs a table).
  // All three are added unconnected first: once the table is connected, the page has a Crews list and the Quick add would join it.
  await d.addAt('Add here: Page, place 2', 'Table of records');
  await expect(d.notConnected('datatable_1')).toBeVisible();
  await d.block('datatable_1').focus();
  await d.addAt('Add here: Page, place 3', 'Checklist');
  await expect(d.notConnected('checklist_1')).toBeVisible();
  await d.named('Table of records').focus();
  await page.getByRole('button', { name: 'Put a part beside Table of records' }).click();
  await page.getByRole('button', { name: 'Add Quick add' }).click();
  await expect(d.notConnected('quickadd_1')).toBeVisible();
  // Now the table is connected (a green pill); the other two keep their amber ones.
  await d.block('datatable_1').getByRole('button', { name: 'Connect Table of records to a table' }).click();
  await chooseTable(page, 'Table of records', 'Crews');
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(d.notConnected('quickadd_1')).toBeVisible();
  await closeDialogs(page);

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    for (const id of ['datatable_1', 'checklist_1', 'quickadd_1']) {
      await d.block(id).focus();
      const toolbar = page.getByRole('toolbar').filter({ has: page.getByRole('button', { name: 'Settings' }) });
      await expect(toolbar).toBeVisible();
      const pills = await boxes(page.locator('[data-canvas-block] [data-indicator]'), 'pill');
      expect(pills.length, 'the three parts each carry a pill').toBe(3);
      const bars = await boxes(toolbar, 'toolbar');
      const zones = await boxes(page.getByRole('button', { name: /^Add here: / }), 'Add here');
      const where = `${viewport.width}px, ${id} selected`;
      for (const pill of pills) {
        for (const other of [...bars, ...zones]) {
          expect(overlap(pill.box, other.box), `${pill.label} and ${other.label} at ${where}: ${JSON.stringify(pill.box)} vs ${JSON.stringify(other.box)}`).toBe(false);
        }
      }
      for (let i = 0; i < pills.length; i += 1) {
        for (let k = i + 1; k < pills.length; k += 1) {
          expect(overlap(pills[i].box, pills[k].box), `${pills[i].label} and ${pills[k].label} at ${where}`).toBe(false);
        }
      }
    }
  }
});

test('at 400 px the toolbar below the first part and below the top menu bar does not cover the next part pill', async ({ page }) => {
  const made = await importCrewRoster(page.request, 'Narrow Pills');
  expect(made.id).not.toBe('');
  await page.setViewportSize({ width: 1280, height: 900 });
  const d = await openArchive(page, 'Narrow Pills');
  const first = (await d.order())[0];
  // The first part of the page, then two parts that need something: their pills sit at the top of the blocks below it.
  await d.addAt('Add here: Page, place 2', 'Table of records');
  await expect(d.notConnected('datatable_1')).toBeVisible();
  await d.block('datatable_1').focus();
  await d.addAt('Add here: Page, place 3', 'Checklist');
  await expect(d.notConnected('checklist_1')).toBeVisible();
  // The menu bar across the top, with a Button on it (its toolbar opens below the bar, over the top of the page).
  await page.getByRole('tab', { name: 'Look' }).click();
  await page.getByRole('group', { name: 'Menu bar' }).getByText('Across the top', { exact: true }).click();
  await page.getByRole('tab', { name: 'Features' }).click();
  await expect(d.menuSlot('end')).toBeVisible();
  await d.dragTile('Button', '@menu-end:0');
  await expect(visibleNotice(page, 'Added Button to the menu bar.')).toBeVisible();
  await closeDialogs(page);

  await page.setViewportSize({ width: 400, height: 900 });
  const toolbar = page.getByRole('toolbar').filter({ has: page.getByRole('button', { name: 'Settings' }) });
  const targets = [
    { label: 'the first part of the page', focus: () => d.block(first).focus() },
    { label: 'the Button on the top menu bar', focus: () => d.named('Button').first().focus() },
  ];
  for (const target of targets) {
    await target.focus();
    await expect(toolbar, `${target.label} shows its toolbar`).toBeVisible();
    const bar = (await boxes(toolbar, 'toolbar'))[0];
    const pills = await boxes(page.locator('[data-canvas-block] [data-indicator]'), 'pill');
    expect(pills.length, 'the two parts each carry a pill').toBeGreaterThanOrEqual(2);
    for (const pill of pills) {
      expect(overlap(pill.box, bar.box), `${pill.label} is covered by the toolbar of ${target.label} at 400px: ${JSON.stringify(pill.box)} vs ${JSON.stringify(bar.box)}`).toBe(false);
    }
  }
});

test('Data connections lists a part of another page and Open page goes there; a page with a part that needs a table cannot be left unsaved', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // Why this does not list "needs a table" for the other page: a part that needs a table never reaches a saved page. Save is off for it,
  // leaving the page asks first (below), and the server refuses such a spec (a stored one even stops the app from opening). So the
  // other-page sentences that can be seen are the ones about a saved write part; the "needs a table" words are proved by unit tests.
  const made = await importCrewRoster(page.request, 'Other Page');
  expect(made.id).not.toBe('');
  const spec = structuredClone(made.spec);
  spec.pages.push({
    id: 'archive',
    title: 'Archive',
    route: '/archive',
    sources: [{ id: 'archive_people', table: 'people', limit: 50 }],
    layout: {
      id: 'root',
      type: 'Page',
      props: {},
      children: [
        { id: 'people_list', type: 'DataTable', props: { source: 'archive_people', columns: ['name'] }, children: [] },
        { id: 'crew_form', type: 'RecordForm', props: { table: 'crews' }, children: [] },
      ],
    },
  });
  spec.nav.push({ pageId: 'archive', label: 'Archive' });
  const put = await page.request.put(`/api/studio/apps/${made.id}`, { data: { spec, baseRevision: made.revision } });
  expect(put.status()).toBe(200);

  const d = design(page);
  await d.open('Other Page');
  await expect(d.page()).toHaveValue('home');
  const list = d.connections();
  await expect(list).toBeVisible();
  const row = list.getByRole('listitem').filter({ hasText: 'on Archive' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('adds to Crews, but nothing on this page shows Crews.');
  await expect(list).not.toContainText('not connected');
  await expect(row.getByRole('button', { name: 'Open page' })).toBeEnabled();

  await row.getByRole('button', { name: 'Open page' }).click();
  await expect(d.page()).toHaveValue(/archive/);

  // On Archive, a part that needs a table is not saved, and the page does not change until the person decides.
  const first = (await d.order())[0];
  await d.block(first).focus();
  await d.addAt('Add here: Page, place 2', 'Checklist');
  await expect(d.notConnected('checklist_1').locator('[data-indicator]')).toHaveText('Needs a yes or no field');
  await closeDialogs(page);
  await d.page().selectOption({ label: 'Home' });
  const stuck = page.getByRole('alertdialog', { name: 'Your changes on Archive cannot be saved yet' });
  await expect(stuck).toBeVisible();
  await stuck.getByRole('button', { name: 'Stay' }).click();
  await expect(d.page()).toHaveValue(/archive/);
  await expect(d.notConnected('checklist_1')).toBeVisible();
  await d.page().selectOption({ label: 'Home' });
  await stuck.getByRole('button', { name: 'Discard changes' }).click();
  await expect(d.page()).toHaveValue('home');
  expect(ctx.server.outbound()).toEqual([]);
});

test('a blank app: Needs a table with New table, the shelf tiles say Needs a table until a table exists, then the pill is Connected', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await makeApp(page.request, 'Blank Indicator', () => {});
  const d = design(page);
  await d.open('Blank Indicator');

  // The shelf (the Design shelf of an app with no table): data parts and data features say it, other parts say nothing.
  const tile = (key) => page.locator(`[data-entry-key="${key}"]`);
  await expect(tile('part:DataTable')).toContainText('Needs a table');
  await expect(tile('part:Heading')).not.toContainText('Needs a table');
  const numberRow = page.getByTestId('feature-tile').filter({ hasText: 'Number row' });
  await expect(numberRow).toContainText('Needs a table');
  await expect(page.getByRole('button', { name: 'Select Table of records', exact: true })).toHaveAccessibleDescription(/Needs a table/);

  await d.addAt('Add here: Page, place 1', 'Table of records');
  const box = d.notConnected('datatable_1');
  await expect(box.locator('[data-indicator]')).toHaveText('Needs a table');
  await expect(box.getByText('This app has no table yet.')).toBeVisible();
  await expect(box.getByRole('button', { name: 'Make a new table for Table of records' })).toHaveText('New table');
  await expect(box.getByRole('button', { name: /^Connect / })).toHaveCount(0);
  // No field to add to: with no table the part needs a table, not a field.
  await expect(box.getByRole('button', { name: /^Add a field for / })).toHaveCount(0);

  await d.newTable('datatable_1', 'Crews');
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(d.notConnected('datatable_1')).toHaveCount(0);
  // Now a table exists: the shelf tile of a data part has no pill any more.
  await expect(tile('part:DataTable')).not.toContainText('Needs a table');
  expect(ctx.server.outbound()).toEqual([]);
});

test('the Features page: data parts and data features say Needs a table, other parts say nothing', async ({ page }) => {
  const f = features(page);
  await f.open();
  await expect(page.locator('[data-entry-key="part:DataTable"]')).toContainText('Needs a table');
  await expect(page.getByRole('button', { name: 'Show details for Table of records', exact: true })).toHaveAccessibleDescription(/Needs a table/);
  await expect(f.card('Number row')).toContainText('Needs a table');
  await expect(page.getByRole('button', { name: 'Show details for Number row', exact: true })).toHaveAccessibleDescription(/Needs a table/);
  await expect(page.locator('[data-entry-key="part:Heading"]')).toBeVisible();
  await expect(page.locator('[data-entry-key="part:Heading"]')).not.toContainText('Needs a table');
  expect(ctx.server.outbound()).toEqual([]);
});

test('the page strip: the page in one line, Ask lands on Prompt with the page named, and Design then says the design waits on Prompt', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.setViewportSize({ width: 1280, height: 900 });
  const made = await importCrewRoster(page.request, 'Strip Roster');
  const d = design(page);
  await d.open('Strip Roster');

  const strip = page.getByRole('region', { name: 'This page' });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('This page');
  await expect(strip).toContainText(/Home (shows .+|has words only)\./);
  const ask = strip.getByLabel('Ask the helper to change this page');
  const send = strip.getByRole('button', { name: 'Ask', exact: true });
  await expect(ask).toBeVisible();
  // The box is capped so that the page's name and the words fit in the helper's limit together.
  await expect(ask).toHaveAttribute('maxlength', String(2000 - 'On the page Home: '.length));
  await expect(send).toBeDisabled();

  const words = 'Add a phone number to each crew.';
  await ask.fill(words);
  await expect(send).toBeEnabled();
  await send.click();

  // Prompt, with the edit launch: the page is named first in the box, and the helper's answer waits beside it.
  await expect(page).toHaveURL(new RegExp(`/apps/${made.id}/prompt$`));
  // The words are an ask on the saved app: the right pane quotes them, and the left pane is no second box (it shows the first prompt).
  await expect(page.getByLabel('What should change?')).toHaveCount(0);
  await expect(page.getByText('Your first prompt', { exact: true })).toBeVisible();
  await expect(page.locator('q', { hasText: `On the page Home: ${words}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 3, name: /^(What the helper made|Your changes)$/ })).toBeVisible({ timeout: 30_000 });

  // Back on Design the strip does not offer a second Ask (it would throw the waiting design away).
  await steps(page).getByRole('link', { name: /Design/ }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(d.canvas).toBeVisible();
  const waiting = page.getByRole('region', { name: 'This page' });
  await expect(waiting.getByText("The helper's design is waiting on Prompt.")).toBeVisible();
  await expect(waiting.getByLabel('Ask the helper to change this page')).toHaveCount(0);
  await waiting.getByRole('button', { name: 'Open Prompt' }).click();
  await expect(page).toHaveURL(/\/prompt$/);
  expect(ctx.server.outbound()).toEqual([]);
});
