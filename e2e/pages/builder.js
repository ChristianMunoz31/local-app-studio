// The Feature builder (src/studio/pages/FeatureBuilderPage.tsx, src/studio/builder/): /features/new and /features/:id/edit.
// Shelf buttons, the canvas, Undo and Redo are the Design ones (pages/design.js); this adds the slot panel, the dialogs and the set-up
// the specs share (an empty builder, a Table of records with a table slot, a Quick add beside it).
import { expect } from '../support/fixtures.js';
import { design } from './design.js';

export function builder(page) {
  const d = design(page);
  const panel = page.getByTestId('slot-panel');
  const api = {
    d,
    panel,
    /** The rows of the slot panel; `kind` is table, field, page or text (all rows when absent). */
    rows: (kind) => page.locator(`[data-testid="slot-row"]${kind === undefined ? '' : `[data-slot-kind="${kind}"]`}`),
    /** "People can change 3 of 6 things." */
    count: () => page.getByTestId('slot-count'),
    /** The number in the count line. */
    async settings() {
      const text = await api.count().innerText();
      const m = /People can change (\d+) of 6 things\./.exec(text);
      expect(m, `the count line: ${text}`).not.toBeNull();
      return Number(m[1]);
    },
    heading: (name) => page.getByRole('heading', { level: 1, name, exact: true }),
    /** The toolbar Save feature button (use only while no dialog is open). */
    saveButton: () => page.getByRole('button', { name: 'Save feature', exact: true }),
    /** The Save feature or Save a new version dialog. */
    saveDialog: () => page.getByRole('dialog', { name: /^(Save feature|Save a new version)$/ }),
    async openNew() {
      await page.goto('/features/new');
      await expect(api.heading('New feature')).toBeVisible();
      await expect(d.canvas).toBeVisible();
    },
    /** A shelf button: "Add Table of records". The part goes on the canvas page (after the selected part when one is selected). */
    async addPart(name) {
      await page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
    },
    /** On a part that shows records and has no slot yet: Add a table slot, keep the suggested name and sample rows (or set them), Add slot. */
    async addTableSlot(layerId, partName, { label, sample } = {}) {
      await d.block(layerId).getByRole('button', { name: `Add a table slot for ${partName}` }).click();
      const dialog = page.getByRole('dialog', { name: 'Add a table slot' });
      await expect(dialog).toBeVisible();
      if (sample !== undefined) await dialog.getByLabel('Sample rows', { exact: true }).selectOption({ label: sample });
      if (label !== undefined) await dialog.getByLabel('Shown as', { exact: true }).fill(label);
      await dialog.getByRole('button', { name: 'Add slot', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    },
    /** An empty builder, a Table of records with its table slot (Crews), and a Quick add that connects to the same slot. */
    async withParts() {
      await api.openNew();
      await api.addPart('Table of records');
      await api.addTableSlot('datatable_1', 'Table of records');
      await expect(d.badge('datatable_1')).toHaveAccessibleName('Uses slot Crews. Change table');
      await d.block('datatable_1').focus();
      await api.addPart('Quick add');
      await expect(d.badge('quickadd_1')).toHaveAccessibleName('Uses slot Crews. Change table');
    },
    /** The slot row of a table, and its Sample rows select and Shown as box. */
    tableRow: () => api.rows('table').first(),
    sampleSelect: () => api.tableRow().getByLabel('Sample rows', { exact: true }),
    shownAs: () => api.tableRow().getByLabel('Shown as', { exact: true }),
    /** Opens the Save dialog with the toolbar button and returns it. */
    async openSave() {
      await api.saveButton().click();
      const dialog = api.saveDialog();
      await expect(dialog).toBeVisible();
      return dialog;
    },
    /** Fills the Save dialog and presses Save feature (the dialog's own button, so a second one behind it never matches). */
    async fillSave(dialog, name, line) {
      if (name !== undefined) await dialog.getByLabel('Name', { exact: true }).fill(name);
      if (line !== undefined) await dialog.getByLabel('What it is for, in one line', { exact: true }).fill(line);
    },
    async pressSave(dialog) {
      await dialog.getByRole('button', { name: /^Save (feature|a new version)$/ }).click();
    },
  };
  return api;
}
