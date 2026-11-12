// Proof journey "newcomer" (DESIGN-phase14.md, CRITIQUE-phase14-newcomer.md): a shop owner whose helper cannot answer makes an equipment
// loans app by hand (Items, People, Loans), gives it a Form and a Table of records, picks a look, adds a record in Preview and reaches Build.
// The critic needed 92 clicks and lost her words and two tables on the way; this journey is counted with journey() and has a budget.
// Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { journey, NEVER_SHOWN } from '../pages/journey.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { openStartBox } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: () => 'Sorry, I can only answer in plain sentences.' });

const WORDS =
  'An app to track equipment loans for my tool rental shop. I have items (name, serial number, condition), people (name, phone), and loans: which person borrowed which item, the date out, and the due date. I want to see which loans are overdue.';
const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
/** No glossary "never shown" word in the Studio text of the screen (the running app is the person's own content). */
const plain = async (page, where) => {
  const text = await page.locator('main').innerText();
  expect(text.match(NEVER_SHOWN), `a word that is never shown, on ${where}`).toBeNull();
};
/** The toolbar's Save (a Form drawn on the Design canvas has Save buttons of its own, of type submit). */
const saveButton = (page) => page.getByRole('button', { name: 'Save', exact: true }).and(page.locator('button[type="button"]'));
const saved = (page) => expect(page.getByTestId('save-status')).toHaveText('All changes saved');

/** The click budget: 36 actions measured when this file was written (see the `measured` annotation), set a little above it. The critic needed 92. */
const BUDGET = 40;

test('a failing helper, tables by hand, a Form and a Table of records, a look, a record in Preview, and the Build screen', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper and the installer are not in a public build');
  test.setTimeout(150_000);
  const j = journey(page);

  await test.step('the helper fails in plain words that do not blame the person', async () => {
    await page.goto('/apps');
    await plain(page, 'Apps');
    await openStartBox(page, (l) => j.click(l));
    await j.fill(page.getByLabel('Your prompt'), WORDS);
    await j.click(page.getByRole('button', { name: 'Make my app' }));
    // The screen reader announcement repeats the title and the sentence in a hidden live region; the person's copy is the one checked.
    const shown = (text) => page.getByText(text).and(page.locator(':not([aria-live], [aria-live] *)'));
    await expect(shown('The helper could not make a design')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Your text is kept.')).toBeVisible();
    await expect(shown('The helper on this computer did not give a usable answer. Try again, or build it yourself.')).toBeVisible();
    const main = await page.locator('main').innerText();
    expect(main, 'the error must not tell the person to shorten or reword').not.toMatch(/shorter|reword|too long|more specific|your fault/i);
    await plain(page, 'Prompt after a failure');
  });

  await test.step('Build it yourself lands on Data', async () => {
    await j.click(page.getByRole('button', { name: 'No helper? Build it yourself, starting with tables on Data' }));
    await expect(page).toHaveURL(/\/apps\/[^/]+\/data$/);
    await expect(page.getByText('No tables yet. Add one to keep information in your app.')).toBeVisible();
    await plain(page, 'Data');
  });

  await test.step('Items, People and Loans, typing with no select-all', async () => {
    const addTable = page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: 'Add table' });
    const addField = page.getByRole('button', { name: 'Add field', exact: true });
    const fresh = page.getByRole('group', { name: 'Field New field' });

    // Items: a name, a serial number and a condition (Enter adds the next field).
    await j.click(addTable);
    await expect(page.getByLabel('Table name')).toBeFocused();
    await j.typeText('Items');
    await j.click(addField);
    await expect(fresh.getByLabel('Field name')).toBeFocused();
    await j.typeText('Serial number');
    await j.press('Enter');
    await expect(fresh.getByLabel('Field name')).toBeFocused();
    await j.typeText('Condition');
    await expect(page.getByRole('group', { name: 'Field Condition' })).toHaveCount(1);
    await expect(page.getByText('New field')).toHaveCount(0);

    // People: a name and a phone.
    await j.click(addTable);
    await expect(page.getByLabel('Table name')).toBeFocused();
    await j.typeText('People');
    await j.click(addField);
    await j.typeText('Phone');

    // Loans: linked to Items and People, with a due date.
    await j.click(addTable);
    await j.typeText('Loans');
    await j.click(addField);
    await j.typeText('Item');
    await j.select(page.getByRole('group', { name: 'Field Item' }).getByLabel('Type', { exact: true }), { label: 'Link to another table' });
    await j.select(page.getByRole('group', { name: 'Field Item' }).getByLabel('Links to'), { label: 'Items' });
    await j.press('Enter');
    await j.typeText('Person');
    await j.select(page.getByRole('group', { name: 'Field Person' }).getByLabel('Type', { exact: true }), { label: 'Link to another table' });
    await j.select(page.getByRole('group', { name: 'Field Person' }).getByLabel('Links to'), { label: 'People' });
    await j.press('Enter');
    await j.typeText('Due date');
    await j.select(page.getByRole('group', { name: 'Field Due date' }).getByLabel('Type', { exact: true }), { label: 'Date' });

    await j.click(saveButton(page));
    await saved(page);
    await plain(page, 'Data with tables');
  });

  await test.step('Design: a Form for Loans and a Table of records; a kept advisory does not block Next', async () => {
    await j.click(steps(page).getByRole('link', { name: /Design/ }));
    await expect(page).toHaveURL(/\/design$/);
    await expect(design(page).canvas).toBeVisible();
    await expect(page.getByText('Start with your tables on Data.')).toHaveCount(0);

    await j.click(page.getByRole('button', { name: 'Add Form' }));
    const formSettings = page.getByRole('dialog', { name: 'Settings for Form' });
    await j.select(formSettings.getByLabel('Table', { exact: true }), { label: 'Loans' });
    await expect(page.locator('[data-connection-badge]').first()).toContainText('Connected to Loans');

    await j.click(page.getByRole('button', { name: 'Add Table of records' }));
    const tableSettings = page.getByRole('dialog', { name: 'Settings for Table of records' });
    await j.select(tableSettings.getByLabel('Table', { exact: true }), { label: 'Loans' });
    await expect(visibleNotice(page, 'Connected to Loans.')).toBeVisible();

    // A third Form: Studio connects it to Loans by itself and says so. Then it is pointed at People, which nothing on the page shows:
    // Data connections lists it, and Next is not held, kept or not.
    // P17-14: Loans is listed on the page and the app has other tables, so the third Form asks which table instead of joining silently.
    await j.click(page.getByRole('button', { name: 'Add Form' }));
    await j.select(page.getByRole('dialog', { name: 'Settings for Form' }).getByLabel('Table', { exact: true }), { label: 'Loans' });
    await expect(visibleNotice(page, 'Connected to Loans.')).toBeVisible();
    await expect(design(page).connections()).toHaveCount(0);
    await j.click(page.locator('[data-connection-badge]').last());
    const third = page.getByRole('dialog', { name: 'Settings for Form' });
    await j.select(third.getByLabel('Table', { exact: true }), { label: 'People' });
    await j.click(third.getByRole('button', { name: 'Apply' }));
    await expect(design(page).connections()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Next: / })).toBeEnabled();
    await expect(page.getByText(/to go on/)).toHaveCount(0);
    await j.click(design(page).connections().getByRole('button', { name: 'Keep it this way' }).first());
    await expect(page.getByRole('button', { name: /^Next: / })).toBeEnabled();
    await plain(page, 'Design');
  });

  await test.step('Look picks a theme, Save keeps it', async () => {
    await j.click(page.getByRole('tab', { name: 'Look' }));
    await j.click(page.getByTestId('theme-picker').getByText('Sand', { exact: true }).first());
    await j.click(saveButton(page));
    await saved(page);
    await plain(page, 'Design, Look');
  });

  await test.step('Preview adds a record', async () => {
    await j.click(steps(page).getByRole('link', { name: /Preview/ }));
    await expect(page).toHaveURL(/\/preview$/);
    await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
    const app = page.getByTestId('preview-theme-scope');
    await expect(app).toBeVisible();
    // The Form for Loans needs linked records first, so the record is a person, through the Form that adds to People.
    const peopleForm = app.locator('form').filter({ has: page.getByLabel('Phone') });
    await j.fill(peopleForm.getByLabel('Name'), 'Maria Lopez');
    await j.fill(peopleForm.getByLabel('Phone'), '555-0101');
    await j.click(peopleForm.getByRole('button', { name: 'Save' }));
    await expect(peopleForm.getByText('Saved.')).toBeVisible();
  });

  await test.step('Build shows the switch by its name', async () => {
    await j.click(page.getByRole('button', { name: 'Next: Build' }));
    await expect(page).toHaveURL(/\/build$/);
    await expect(page.getByRole('switch', { name: 'Allow downloads for builds' })).toBeVisible();
    await plain(page, 'Build');
  });

  const total = j.counts().actions;
  const note = `newcomer journey: ${total} actions from Apps to Build (the critic needed 92 clicks); budget ${BUDGET}`;
  test.info().annotations.push({ type: 'measured', description: note });
  console.log(note);
  expect(total, `${note}\n${j.trail()}`).toBeLessThanOrEqual(BUDGET);
  expect(ctx.server.outbound()).toEqual([]);
});
