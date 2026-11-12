// Phase 16, Part C (DESIGN-phase16.md section 4, BRIEF-phase16.md "Proof for C"): the Feature builder from Features > New feature to a feature
// used in a blank app.
//   1. New feature: a Table of records with its table slot, a Quick add that joins it, a text the Quick add lets people change, sample rows
//      visible, switch the sample rows (and Undo the switch), rename the slot (and Undo), the Save refusals in plain words, Save with a name and
//      one line (no id shown, the address becomes /features/<id>/edit).
//   2. The tile is on the Features page; Use in app on a blank app: the shelf tile says "Needs a table", Add opens "New table for <Feature>",
//      Make table, the notice, Save, Preview shows the table and the Quick add adds a row.
//   3. Edit and Save a new version (h1 "Edit <Name>", the tile shows the new line).
//   4. Undo and Redo in the builder; Save with nothing in the feature is refused in plain words.
//   5. Save as feature from Design shows no ids; Open in the builder lands on /features/new with the parts.
//   6. A damaged import shows plain sentences, never a developer word.
// Every builder screen is scanned with NEVER_SHOWN_BUILDER (the list without "slot"); the Features page and Design keep NEVER_SHOWN.
// Nothing leaves this computer. Studio API calls (estimate): about 140 (page loads and their polls, two app creates, feature reads),
// under the 300 per 15 minutes the server allows for one spec file.
import { test, expect, useApp } from '../support/fixtures.js';
import { getApp, importCrewRoster, makeApp } from '../support/critiqueApps.js';
import { builder } from '../pages/builder.js';
import { design, visibleNotice } from '../pages/design.js';
import { features } from '../pages/features.js';
import { preview } from '../pages/preview.js';
import { NEVER_SHOWN, NEVER_SHOWN_BUILDER } from '../pages/journey.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const NAME = 'Crew sign up';
const LINE = 'Shows the crews and lets people add one.';
const NEW_LINE = 'Shows the crew groups and lets people add one.';
/** The id of the saved feature, read from the address after the first save (never shown on the screen). */
let featureId = '';

/** The words of the builder's main area (or a dialog) must not hold a developer word; "slot" is the builder's own word. */
async function expectPlainBuilder(locator, where) {
  const text = await locator.innerText();
  expect(text.match(NEVER_SHOWN_BUILDER), `a word that is never shown, on ${where}`).toBeNull();
  expect(text, `an id on ${where}`).not.toMatch(/\b(datatable_1|quickadd_1|feature_[a-z_]+|builder-new)\b/);
}

test('New feature: a Table of records with a table slot, a Quick add on the same slot, sample rows, switch and Undo, refusals, Save', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const f = features(page);
  const b = builder(page);
  const d = b.d;

  // Features > New feature.
  await f.open();
  await page.getByRole('button', { name: 'New feature', exact: true }).click();
  await expect(page).toHaveURL(/\/features\/new$/);
  await expect(b.heading('New feature')).toBeVisible();
  await expect(page).toHaveTitle('New feature, Local App Studio');
  await expect(page.getByText('Put parts together once and use them in any app. The rows you see are sample rows.')).toBeVisible();
  await expect(page.getByText('Your feature', { exact: true }).first()).toBeVisible();
  await expect(d.canvas).toBeVisible();

  // The empty builder: the slot panel says what to do.
  await expect(b.panel.getByRole('heading', { name: 'Slots', exact: true })).toBeVisible();
  await expect(b.panel).toContainText('What people fill in when they add this feature.');
  await expect(b.panel).toContainText('No slots yet. Drop a part that shows records, then press Add a table slot.');
  await expect(b.count()).toHaveText('People can change 0 of 6 things.');
  await expectPlainBuilder(page.getByRole('main'), 'the empty builder');

  // A Table of records needs a table slot: the box says so and Save feature waits.
  await b.addPart('Table of records');
  const box = d.notConnected('datatable_1');
  await expect(box).toBeVisible();
  await expect(box.locator('[data-indicator]')).toHaveText('Needs a table');
  await expect(box.getByRole('button', { name: 'Add a table slot for Table of records' })).toBeVisible();
  await expect(b.saveButton()).toBeDisabled();
  await expect(b.saveButton()).toHaveAttribute('aria-describedby', 'builder-save-hint');
  await expect(page.locator('#builder-save-hint')).toContainText('Some parts still need a table slot.');

  // Add a table slot: the dialog names the slot and the sample rows.
  await box.getByRole('button', { name: 'Add a table slot for Table of records' }).click();
  const slotDialog = page.getByRole('dialog', { name: 'Add a table slot' });
  await expect(slotDialog).toBeVisible();
  await expect(slotDialog).toContainText('The feature shows rows from this table. In an app, people pick their own table.');
  await expect(slotDialog.getByLabel('Shown as', { exact: true })).toHaveValue('Crews');
  await expect(slotDialog.getByLabel('Sample rows', { exact: true })).toHaveValue('crews');
  await expectPlainBuilder(slotDialog, 'the Add a table slot dialog');
  await slotDialog.getByRole('button', { name: 'Add slot', exact: true }).click();
  await expect(slotDialog).toHaveCount(0);

  // The pill, the panel row and the sample rows.
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Uses slot Crews. Change table');
  await expect(d.indicator('datatable_1')).toHaveAttribute('data-indicator', 'slot');
  await expect(d.notConnected('datatable_1')).toHaveCount(0);
  await expect(b.rows('table')).toHaveCount(1);
  await expect(b.shownAs()).toHaveValue('Crews');
  await expect(b.sampleSelect()).toHaveValue('crews');
  await expect(b.tableRow()).toContainText('Used by: Table of records');
  await expect(page.getByTestId('data-note')).toContainText('Showing sample rows.');
  await expect(d.block('datatable_1').getByRole('row').nth(1)).toBeVisible();
  await expect(b.saveButton()).toBeEnabled();

  // A Quick add beside the table joins the same slot.
  await d.block('datatable_1').focus();
  await b.addPart('Quick add');
  await expect(d.badge('quickadd_1')).toHaveAccessibleName('Uses slot Crews. Change table');
  await expect(b.rows('table')).toHaveCount(1);
  await expect(b.tableRow()).toContainText('Quick add');
  const before = await b.settings();
  expect(before).toBeGreaterThanOrEqual(2);
  expect(before).toBeLessThanOrEqual(6);

  // The Quick add's own words can be a setting people change: tick them.
  const text = b.rows('text').filter({ hasText: 'Quick add' }).first();
  await expect(text).toBeVisible();
  const tick = text.getByRole('checkbox', { name: 'Let people change these words' });
  await expect(tick).not.toBeChecked();
  await tick.check();
  await expect(tick).toBeChecked();
  expect(await b.settings()).toBeGreaterThan(before);

  // Switch the sample rows: the canvas shows other rows, Undo brings Crews back.
  const crewsLook = await d.block('datatable_1').innerText();
  await b.sampleSelect().selectOption({ label: 'Tasks' });
  await expect(b.sampleSelect()).toHaveValue('tasks');
  await expect.poll(() => d.block('datatable_1').innerText()).not.toBe(crewsLook);
  await d.undo().click();
  await expect(b.sampleSelect()).toHaveValue('crews');
  await expect.poll(() => d.block('datatable_1').innerText()).toBe(crewsLook);

  // Rename the slot: both pills follow; Undo puts the name back.
  await b.shownAs().fill('Groups');
  await b.shownAs().press('Enter');
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Uses slot Groups. Change table');
  await expect(d.badge('quickadd_1')).toHaveAccessibleName('Uses slot Groups. Change table');
  await d.undo().click();
  await expect(d.badge('datatable_1')).toHaveAccessibleName('Uses slot Crews. Change table');
  await expect(b.shownAs()).toHaveValue('Crews');
  await expectPlainBuilder(page.getByRole('main'), 'the builder with parts and slots');

  // Save: refusals in plain words, in role=alert, never an id or a path.
  const dialog = await b.openSave();
  await expect(dialog.getByRole('heading', { name: 'Save feature', exact: true })).toBeVisible();
  await expect(dialog).toContainText('The helper reads this line to know when to use it.');
  await expect(dialog).toContainText('0 of 160');
  await b.pressSave(dialog);
  await expect(dialog.getByRole('alert')).toContainText('Give the feature a name.');
  await b.fillSave(dialog, NAME);
  await b.pressSave(dialog);
  await expect(dialog.getByRole('alert')).toContainText('Say in one line what the feature is for.');
  await expect(dialog.getByRole('alert')).not.toContainText('Give the feature a name.');
  await expectPlainBuilder(dialog, 'the Save feature dialog with a refusal');
  await b.fillSave(dialog, undefined, LINE);
  await expect(dialog).toContainText(`${LINE.length} of 160`);
  await b.pressSave(dialog);
  await expect(dialog).toHaveCount(0);

  // Saved: the notice, the address becomes Edit, the id is not on the screen.
  await expect(visibleNotice(page, `Saved ${NAME}. It is in your features.`)).toBeVisible();
  await expect(page).toHaveURL(/\/features\/[^/]+\/edit$/);
  featureId = new URL(page.url()).pathname.split('/')[2];
  expect(featureId).not.toBe('');
  await expect(b.heading(`Edit ${NAME}`)).toBeVisible();
  await expect(page).toHaveTitle(`Edit ${NAME}, Local App Studio`);
  expect(await page.getByRole('main').innerText()).not.toContain(featureId);
  const record = (await (await page.request.get(`/api/studio/features/${featureId}`)).json()).data;
  expect(record).toMatchObject({ label: NAME, description: LINE, version: 1 });
  expect(record.params.length).toBeGreaterThanOrEqual(3);
  expect(ctx.server.outbound()).toEqual([]);
});

test('the tile is on the Features page; Use in app on a blank app: New table from Design, Save, and Preview shows the table and a row added with the Quick add', async ({ page }) => {
  test.setTimeout(180_000);
  const f = features(page);
  const d = design(page);
  const blank = await makeApp(page.request, 'Blank Builder', () => {});

  await f.open();
  await expect(f.card(NAME)).toBeVisible();
  await expect(f.card(NAME)).toContainText(LINE);
  await expect(f.card(NAME)).toContainText('Needs a table');
  expect((await page.locator('main').innerText()).match(NEVER_SHOWN), 'a word that is never shown, on Features').toBeNull();

  // Use in app: the blank app, Open Design with the feature on the shelf.
  await f.menu(NAME, 'Use in app');
  const choose = page.getByRole('dialog', { name: `Use "${NAME}" in an app` });
  await expect(choose).toBeVisible();
  await choose.getByLabel('App', { exact: true }).selectOption({ label: 'Blank Builder' });
  await choose.getByRole('button', { name: 'Open Design' }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(d.canvas).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search parts and features' })).toHaveValue(/crew sign up/i);
  await expect(page.locator(`[data-entry-key="feature:${featureId}"]`)).toContainText('Needs a table');

  // Add: the blank app has no table, so Design asks for a New table named for the feature, and the slot binds to it.
  await page.getByRole('button', { name: `Add ${NAME}`, exact: true }).click();
  const tableDialog = page.getByRole('dialog', { name: `New table for ${NAME}`, exact: true });
  await expect(tableDialog).toBeVisible();
  await tableDialog.getByLabel('Table name').fill('Crews');
  await tableDialog.getByRole('button', { name: 'Make table', exact: true }).click();
  await expect(tableDialog).toHaveCount(0);
  await expect(visibleNotice(page, `Made the table Crews and added ${NAME} to this page.`)).toBeVisible();
  // A feature that lets people change words may open its settings next: accept them as they are.
  const settings = page.getByRole('dialog', { name: `Settings for ${NAME}` });
  if (await settings.isVisible().catch(() => false)) await settings.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await d.save();

  const saved = (await getApp(page.request, blank.id)).spec;
  expect(saved.tables).toHaveLength(1);
  expect(saved.tables[0].label).toBe('Crews');
  expect(JSON.stringify(saved.pages[0].layout)).toContain('QuickAdd');

  // Preview: the running app shows the table, and the Quick add adds a row.
  const p = preview(page);
  const scope = await p.open('Blank Builder');
  await expect(scope.getByRole('table')).toBeVisible({ timeout: 60_000 });
  await scope.getByPlaceholder(/^Add to /).fill('Beta crew');
  await scope.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(scope.getByRole('table').getByRole('cell', { name: 'Beta crew' })).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});

test('Edit opens the builder over the saved feature; Save a new version stores version 2 and the tile shows the new line', async ({ page }) => {
  const f = features(page);
  const b = builder(page);
  await f.open();
  await f.menu(NAME, 'Edit');
  await expect(page).toHaveURL(new RegExp(`/features/${featureId}/edit$`));
  await expect(b.heading(`Edit ${NAME}`)).toBeVisible();
  await expect(page).toHaveTitle(`Edit ${NAME}, Local App Studio`);
  // The saved parts and slots are on the canvas and in the panel.
  await expect(page.locator('[data-indicator="slot"]')).toHaveCount(2);
  await expect(b.rows('table')).toHaveCount(1);
  await expectPlainBuilder(page.getByRole('main'), 'the builder over a saved feature');

  // Change a label (the table slot), then Save a new version.
  await b.shownAs().fill('Crew groups');
  await b.shownAs().press('Enter');
  await expect(page.locator('[data-indicator="slot"]').first()).toContainText('Uses slot Crew groups');
  const dialog = await b.openSave();
  await expect(dialog.getByRole('heading', { name: 'Save a new version', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(NAME);
  await expect(dialog.getByLabel('What it is for, in one line', { exact: true })).toHaveValue(LINE);
  await b.fillSave(dialog, undefined, NEW_LINE);
  await b.pressSave(dialog);
  await expect(dialog).toHaveCount(0);
  await expect(visibleNotice(page, `Saved ${NAME}. It is in your features.`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/features/${featureId}/edit$`));

  const record = (await (await page.request.get(`/api/studio/features/${featureId}`)).json()).data;
  expect(record).toMatchObject({ label: NAME, description: NEW_LINE, version: 2 });
  expect(JSON.stringify(record.params)).toContain('Crew groups');

  await f.open();
  await expect(f.card(NAME)).toContainText(NEW_LINE);
  expect(ctx.server.outbound()).toEqual([]);
});

test('Undo and Redo in the builder; Save with nothing in the feature is refused in plain words', async ({ page }) => {
  const b = builder(page);
  const d = b.d;
  await b.openNew();

  // Nothing on the canvas yet: the refusal comes after the name and the line.
  const empty = await b.openSave();
  await b.fillSave(empty, 'Nothing yet', 'A feature with no parts.');
  await b.pressSave(empty);
  await expect(empty.getByRole('alert')).toContainText('There is nothing in the feature yet.');
  await expectPlainBuilder(empty, 'the refusal for an empty feature');
  await empty.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(empty).toHaveCount(0);

  // Two parts, Undo removes the last, Redo puts it back.
  // The page canvas itself is a [data-canvas-block] (aria-label "Page canvas"): count the parts on it, not the canvas.
  const blocks = page.locator('[data-canvas-block]:not([aria-label="Page canvas"])');
  await b.addPart('Heading');
  await expect(blocks).toHaveCount(1);
  await b.addPart('Heading');
  await expect(blocks).toHaveCount(2);
  await d.undo().click();
  await expect(blocks).toHaveCount(1);
  await d.redo().click();
  await expect(blocks).toHaveCount(2);
  await d.undo().click();
  await d.undo().click();
  await expect(blocks).toHaveCount(0);
  await expect(b.panel).toContainText('No slots yet.');
  expect(ctx.server.outbound()).toEqual([]);
});

test('Save as feature from Design shows no ids, and Open in the builder lands on /features/new with the parts', async ({ page }) => {
  await importCrewRoster(page.request, 'Roster for builder');
  const d = design(page);
  const b = builder(page);
  await d.open('Roster for builder');
  await d.block('h1').click();
  await page.getByRole('button', { name: 'Save as feature' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as feature' });
  await expect(dialog).toBeVisible();
  const words = await dialog.innerText();
  expect(words).not.toMatch(/More options|Inside name|Name of this choice/);
  expect(words.match(NEVER_SHOWN), 'a word that is never shown, in Save as feature').toBeNull();
  await expect(dialog.getByRole('button', { name: 'Open in the builder', exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Open in the builder', exact: true }).click();
  await expect(page).toHaveURL(/\/features\/new$/);
  await expect(b.heading('New feature')).toBeVisible();
  await expect(d.canvas).toContainText('Open crews');
  await expect(page.locator('[data-canvas-block]:not([aria-label="Page canvas"])')).toHaveCount(1);
  await expect(b.panel).toBeVisible();
  await expectPlainBuilder(page.getByRole('main'), 'the builder started from Save as feature');
  expect(ctx.server.outbound()).toEqual([]);
});

test('a damaged import says what is wrong in plain sentences, never a developer word', async ({ page }, testInfo) => {
  // The refused import answers 400, which the browser logs; that one request is expected.
  testInfo.annotations.push({ type: 'allow-console-errors', description: '/api/studio/features/import' });
  const f = features(page);
  await f.open();
  const exported = await f.exportFile(NAME, testInfo.outputPath('crew_sign_up.feature.json'));
  const damaged = structuredClone(exported.json);
  // A new id: a file whose id and body are already in the library is taken as "already there" before its name is checked.
  damaged.feature.id = 'crew_sign_up_damaged';
  damaged.feature.label = '';
  await f.importJson(damaged, 'damaged.feature.json');

  const messages = page.getByRole('group', { name: 'Messages' });
  await expect(messages.getByRole('alert').first()).toContainText('This feature file has problems, so nothing was imported.');
  await messages.getByText('Show what is wrong', { exact: true }).click();
  const lines = await messages.getByRole('listitem').allInnerTexts();
  expect(lines.length).toBeGreaterThan(0);
  expect(lines).toContain('Give the feature a name.');
  for (const line of lines) {
    expect(line.match(NEVER_SHOWN_BUILDER), `a word that is never shown: ${line}`).toBeNull();
    expect(line).not.toMatch(/fragment|binding|\bid\b|\bpath\b|params|label/i);
  }
  expect((await messages.innerText()).match(NEVER_SHOWN_BUILDER), 'a word that is never shown, in the import refusal').toBeNull();
  await expect(f.card(NAME)).toHaveCount(1);
  expect(ctx.server.outbound()).toEqual([]);
});
