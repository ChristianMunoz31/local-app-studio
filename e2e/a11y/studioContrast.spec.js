// Studio accessibility, part 2 (DESIGN-phase12.md WP-5, section 1.5): the text contrast the axe "color-contrast" rule cannot
// judge on the gradient background, measured with support/contrast.js in the light and dark themes. Axe is
// the studioAxe*.spec.js shards, keyboard, motion and titles studioKeyboard.spec.js (separate files, see studioShared.js).
import { test, expect } from '../support/fixtures.js';
import { measureContrast } from '../support/contrast.js';
import { builder } from '../pages/builder.js';
import { addArchivePage, setupStudio, steps, theme, AA, BASE } from './studioShared.js';
import { skipWithoutPro } from '../support/proBuild.js';

const { apps, path, openDesign } = setupStudio();

for (const mode of ['light', 'dark']) {
  test.describe(`studio contrast ${mode}`, () => {
    /** Measures each [label, locator] and reports every miss at once, so one run shows all of them. */
    async function expectContrast(testInfo, pairs) {
      const misses = [];
      const measured = [];
      for (const [label, locator] of pairs) {
        await expect(locator.first(), `${label} is on the screen`).toBeVisible();
        const { ratio, fg, bg, fontSize } = await measureContrast(locator.first(), { base: BASE[mode] });
        measured.push(`${label}: ${ratio.toFixed(2)}`);
        if (!(ratio >= AA)) misses.push(`${label}: ${ratio.toFixed(2)}:1 (${fg} on ${bg}, ${fontSize})`);
      }
      testInfo.annotations.push({ type: 'contrast', description: `${mode} | ${measured.join('; ')}` });
      expect(misses, `text under ${AA}:1 in the ${mode} theme`).toEqual([]);
    }

    test('the header, the rail, the intro, Back and Next, the step line and the Design notes', async ({ page }, testInfo) => {
      await theme(page, mode);
      await openDesign(page);
      // An unconnected part adds the save reason; a todo step, a done step and the current step are all on the rail.
      await addArchivePage(page);
      const first = await page.locator('[data-canvas-block]').first().getAttribute('data-layer-id');
      await page.locator(`[data-canvas-block][data-layer-id="${first}"]`).focus();
      await page.getByRole('button', { name: 'Add here: Page, place 2' }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Add Table of records' }).click();
      const rail = steps(page).getByRole('link');
      await expectContrast(testInfo, [
        ['header save status', page.getByTestId('save-status')],
        ['rail step current (Design)', rail.filter({ hasText: 'Design' })],
        ['rail step done (Prompt)', rail.filter({ hasText: 'Prompt' })],
        ['rail step todo (Build)', rail.filter({ hasText: 'Build' })],
        ['step intro', page.getByText('Put parts on your pages and pick the look.')],
        ['Back label', page.getByRole('button', { name: /^Back: / })],
        ['Next label', page.getByRole('button', { name: /^Next: / })],
        ['Step n of 5 line', page.getByText(/^Step 2 of 5$/)],
        ['Design save reason', page.getByText('Connect the parts that need a table, or delete them, to save.').first()],
        ['Design data note', page.getByTestId('data-note')],
        ['shelf tile name', page.locator('[data-entry-key="part:DataTable"] span.font-semibold')],
        ['shelf Sample data pill', page.locator('[data-entry-key="part:DataTable"]').getByText('Sample data')],
      ]);
    });

    test('the indicator pills: Connected (green), Needs a table and Needs a field (amber), and the page strip', { tag: '@pro' }, async ({ page }, testInfo) => {
      skipWithoutPro(test, 'the helper and the installer are not in a public build');
      await theme(page, mode);
      await openDesign(page);
      // A new page has no list: with two tables that fit, a Table of records is not connected by itself (on Home it would join the Crews list).
      await addArchivePage(page);
      const first = await page.locator('[data-canvas-block]').first().getAttribute('data-layer-id');
      await page.locator(`[data-canvas-block][data-layer-id="${first}"]`).focus();
      await page.getByRole('button', { name: 'Add here: Page, place 2' }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Add Table of records' }).click();
      await page.locator('[data-canvas-block][data-layer-id="datatable_1"]').focus();
      await page.getByRole('button', { name: 'Add here: Page, place 3' }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Add Checklist' }).click(); // no yes or no field anywhere: amber Needs a field
      await page.locator('[data-canvas-block][data-layer-id="datatable_1"]').focus();
      await page.getByRole('button', { name: 'Add here: Page, place 4' }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Add Table of records' }).click(); // the second one is not connected: amber Needs a table
      // Two tables fit, so Connect opens the settings; choosing Crews connects the first (green pill). Done last: once the page lists
      // Crews, the second Table of records would join that list instead of waiting.
      await page.locator('[data-canvas-block][data-layer-id="datatable_1"]').getByRole('button', { name: 'Connect Table of records to a table' }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings for Table of records' });
      await dialog.getByLabel('Table', { exact: true }).selectOption({ label: 'Crews' });
      if ((await page.getByRole('dialog').count()) > 0) await page.keyboard.press('Escape');
      const strip = page.getByRole('region', { name: 'This page' });
      // The Slot pill (neutral, Uses slot) is only in the Feature builder: its contrast is measured in the builder test below.
      await expectContrast(testInfo, [
        ['Connected pill (green)', page.locator('[data-indicator="connected"]')],
        ['Needs a table pill (amber)', page.locator('[data-indicator="needs_table"]')],
        ['Needs a field pill (amber)', page.locator('[data-indicator="needs_field"]')],
        ['page strip words', strip.getByText('This page', { exact: true })],
        ['page strip label', strip.getByText('Ask the helper to change this page')],
      ]);
    });

    test('the builder: the Uses slot pill (neutral), the slot panel words and the save reason', async ({ page }, testInfo) => {
      await theme(page, mode);
      const b = builder(page);
      await b.openNew();
      await b.addPart('Table of records');
      await expectContrast(testInfo, [['builder save reason', page.locator('#builder-save-hint')]]);
      await b.addTableSlot('datatable_1', 'Table of records');
      await expectContrast(testInfo, [
        ['Uses slot pill (neutral)', page.locator('[data-indicator="slot"]')],
        ['slot panel subtitle', page.getByText('What people fill in when they add this feature.')],
        ['slot count line', page.getByTestId('slot-count')],
        ['slot used by line', page.getByText('Used by: Table of records')],
        ['builder subtitle', page.getByText('Put parts together once and use them in any app. The rows you see are sample rows.')],
      ]);
    });

    test('the Data pill, the Preview line, the Build line, the Help rows and the confirm message', { tag: '@pro' }, async ({ page }, testInfo) => {
      skipWithoutPro(test, 'the helper and the installer are not in a public build');
      await theme(page, mode);
      await page.goto(path('data'));
      const tableName = page.getByLabel('Table name');
      await expect(tableName).toBeVisible();
      await tableName.fill('');
      await expectContrast(testInfo, [['Data Needs a fix pill', page.getByText('Needs a fix')]]);
      // The empty name is a draft that cannot be saved: leave it behind with a reload.
      await page.goto(path('preview'));
      await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
      await expectContrast(testInfo, [['Preview status line', page.getByText('Your app is running.')]]);

      await page.goto(path('build'));
      await expect(page.getByRole('switch', { name: 'Allow downloads for builds' })).toBeVisible();
      await expectContrast(testInfo, [['Build blocked line', page.locator('main p[role="status"]')]]);

      await page.getByRole('button', { name: 'Help' }).first().click();
      const help = page.getByRole('dialog', { name: 'Help and keyboard shortcuts' });
      await expect(help).toBeVisible();
      await expectContrast(testInfo, [['Help sheet row', help.getByRole('row').first()]]);
      await page.keyboard.press('Escape');

      await page.goto('/apps');
      await page.getByRole('button', { name: 'More actions for Midnight Roster' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm).toBeVisible();
      await expectContrast(testInfo, [['StudioConfirm message', confirm.locator('p').first()]]);
      await confirm.getByRole('button', { name: 'Keep app' }).click().catch(async () => page.keyboard.press('Escape'));
    });

    test('the Prompt step: the review pane heading, the bullets, the Show everything fold and the Ask label', { tag: '@pro' }, async ({ page }, testInfo) => {
      skipWithoutPro(test, 'the helper and the installer are not in a public build');
      await theme(page, mode);
      await page.goto(path('prompt'));
      await expect(page.getByRole('heading', { name: 'Your app', exact: true })).toBeVisible();
      await expectContrast(testInfo, [
        ['review pane heading', page.getByRole('heading', { name: 'Your app', exact: true })],
        ['review bullet', page.getByRole('list', { name: 'Pages' }).getByRole('listitem')],
        ['Show everything fold', page.getByText('Show everything', { exact: true })],
        ['Ask for a change label', page.getByText('Ask for a change', { exact: true })],
        ['first prompt label', page.getByText('Your first prompt', { exact: true })],
      ]);
    });

    test('the app heading inside the Preview scope: Classic in light, Midnight in dark', async ({ page }, testInfo) => {
      await theme(page, mode);
      const [id, label, base] = mode === 'light' ? [apps.crew, 'Classic light', BASE.light] : [apps.midnight, 'Midnight dark', BASE.dark];
      await page.goto(path('preview', id));
      await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
      const scope = page.getByTestId('preview-theme-scope');
      await expect(scope).toHaveAttribute('data-theme-mode', mode);
      const heading = scope.getByRole('heading', { name: 'Open crews' });
      await expect(heading).toBeVisible();
      const { ratio, fg, bg } = await measureContrast(heading, { base });
      testInfo.annotations.push({ type: 'contrast', description: `${mode} | app heading ${label}: ${ratio.toFixed(2)}` });
      expect(ratio, `${label} heading: ${fg} on ${bg}`).toBeGreaterThanOrEqual(AA);
    });
  });
}
