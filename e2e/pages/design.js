// The Design tab of an app (src/studio/design/): the canvas, its blocks and the shelf.
import { expect } from '../support/fixtures.js';

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The visible notice of the workspace with this text (the Design status line, "Added Button to the menu bar.").
 * The workspace also has one screen-reader announcer (role status, sr-only) that repeats such lines, so a plain
 * getByRole('status') can match twice; this excludes the announcer.
 */
export const visibleNotice = (page, text) => page.locator('[role="status"]:not(.sr-only)').filter({ hasText: text });
/** The drop place under the pointer has lit up (the "Drop here" pill or the "Drop beside" bar in the brand colour), so the drag library has read the last pointer move
 * before the mouse is released; without this wait a drop under load lands in the place of an earlier move. */
export const dropPlaceLit = (page) => expect(page.locator('span.bg-slate-brand', { hasText: /^Drop (here|beside)$/ })).toHaveCount(1);
/** The target of a grid drop or resize is drawn in this state ('free' or 'taken'); 'free' also lights the "Drop here" pill. */
export const gridPlaceLit = (page, state) => expect(page.locator(`[data-grid-target][data-state="${state}"]`)).toHaveCount(1);

export function design(page) {
  const canvas = page.getByRole('region', { name: 'Page layout' });
  const block = (id) => page.locator(`[data-canvas-block][data-layer-id="${id}"]`);
  /** The resize handle right of the block with this plain name ("Resize Table of records and Number tile"). */
  const handle = (name) => page.getByRole('separator', { name: new RegExp(`^Resize ${escapeRe(name)} and `) });
  return {
    handle,
    canvas,
    block,
    /** One side of the menu bar on the canvas, 'start' or 'end'. */
    menuSlot: (name) => page.locator(`[data-menu-slot="${name}"]`),
    /**
     * The connected pill inside a block, or inside the open settings dialog: `[data-connection-badge]` (the Change table button on the canvas, "Connected to Crews. Change table";
     * a plain pill in the dialog, "Connected to Crews"). Feature blocks carry it too. In the Feature builder it reads "Uses slot Crews". The pill of any state is `[data-indicator]`.
     */
    badge: (id) => block(id).locator('[data-connection-badge]'),
    /** The dashed box a data part shows while it needs a table or a field, pill first ("Needs a table", "Needs a yes or no field"), then Connect, New table or Add a field: `[data-not-connected]`. */
    notConnected: (id) => block(id).locator('[data-not-connected]'),
    /** The "Data connections" list above the canvas (empty page: count 0). Buttons: Connect, Change table, Open page, Keep it this way, Show again. */
    connections: () => page.getByRole('region', { name: 'Data connections' }),
    /** The Page select of the Design toolbar: `await d.page().selectOption({ label: 'Stats' })`. */
    page: () => page.getByLabel('Page', { exact: true }),
    /** In an open settings dialog, picks an option of a select by its label ("List" or "Table") and presses Apply. */
    async pickInSettings(dialog, label, option) {
      await dialog.getByLabel(label, { exact: true }).selectOption({ label: option });
      await dialog.getByRole('button', { name: 'Apply' }).click();
    },
    /** A block by its plain name, for example "Column 1 of 2". */
    named: (name) => canvas.getByRole('group', { name, exact: true }),
    /** The New table or Add a field dialog that is open. */
    tableDialog: () => page.getByRole('dialog', { name: /^(New table|Add a field) for / }),
    /** dnd-kit's screen reader region: what a screen reader hears while a part is dragged. */
    liveRegion: () => page.locator('[id^="DndLiveRegion"]'),
    /**
     * Presses New table on the block (its Needs a table box), fills the table name and the extra fields
     * ({ label, type, choices }: type is the Type option's text, for example "Choice"), and presses Make table.
     */
    async newTable(id, name, extra = []) {
      await block(id).getByRole('button', { name: /^Make a new table for / }).click();
      const dialog = page.getByRole('dialog', { name: /^New table for / });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Table name').fill(name);
      for (const field of extra) {
        await dialog.getByRole('button', { name: 'Add field', exact: true }).click();
        // The new row is the last one and is named "New field" until it is renamed, so the type and choices come first.
        const row = dialog.getByRole('group', { name: 'Field New field' });
        await expect(row).toHaveCount(1);
        if (field.type !== undefined) await row.getByLabel('Type', { exact: true }).selectOption({ label: field.type });
        if (field.choices !== undefined) await row.getByLabel('Choices (one per line)').fill(field.choices.join('\n'));
        await row.getByLabel('Field name').fill(field.label);
        await expect(dialog.getByRole('group', { name: `Field ${field.label}` })).toHaveCount(1);
      }
      await dialog.getByRole('button', { name: 'Make table', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    },
    /** Presses Add a field on the block (its Needs a field box), sets the table (when given) and the name, and presses Add field. */
    async addField(id, name, table) {
      await block(id).getByRole('button', { name: /^Add a field for / }).click();
      const dialog = page.getByRole('dialog', { name: /^Add a field for / });
      await expect(dialog).toBeVisible();
      if (table !== undefined) await dialog.getByLabel('Table', { exact: true }).selectOption({ label: table });
      await dialog.getByLabel('Field name').fill(name);
      await dialog.getByRole('button', { name: 'Add field', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    },
    /** Presses the connected pill (the Change table button) of a block and returns its settings dialog, open on the List or Table choice. */
    async changeTable(id, partName) {
      await block(id).locator('[data-connection-badge]').click();
      const dialog = page.getByRole('dialog', { name: `Settings for ${partName}` });
      await expect(dialog).toBeVisible();
      return dialog;
    },
    /**
     * The Undo button of the Design toolbar. The notice line may carry an Undo button of its own, so the toolbar one is the first.
     */
    undo: () => page.getByRole('button', { name: 'Undo', exact: true }).first(),
    redo: () => page.getByRole('region', { name: 'Page layout' }).getByRole('button', { name: 'Redo', exact: true }),
    /** The pill of any state inside a block: `[data-indicator="connected" | "needs_table" | "needs_field" | "slot"]`. A part that uses no data (Heading) has none. */
    indicator: (id) => block(id).locator('[data-indicator]'),
    /** The ids of every block on the canvas, in document order. */
    order: () => page.locator('[data-canvas-block]').evaluateAll((els) => els.map((el) => el.dataset.layerId)),
    async open(appName = 'Crew Roster') {
      // Straight to Design: clicking the app card lands on Preview for a designed app, whose auto-start later flips the
      // canvas from sample rows to the empty live database and moves the blocks mid-test.
      await page.goto('/apps');
      const href = await page.getByRole('link', { name: appName }).getAttribute('href');
      expect(href).toMatch(/^\/apps\/[^/]+$/);
      await page.goto(`${href}/design`);
      await expect(page).toHaveURL(/\/design$/);
      await expect(canvas).toBeVisible();
    },
    /** Presses "Add here" with the keyboard, then picks a tile of the shelf. */
    async addAt(zoneName, tileName) {
      await page.getByRole('button', { name: zoneName }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: `Add ${tileName}` }).click();
    },
    /** Selects a block by name and opens the Settings popover of it. */
    async openSettings(name) {
      await canvas.getByRole('group', { name, exact: true }).first().focus();
      await page.getByRole('toolbar').getByRole('button', { name: 'Settings' }).click();
      const dialog = page.getByRole('dialog', { name: `Settings for ${name}` });
      await expect(dialog).toBeVisible();
      return dialog;
    },
    async save() {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
    },
    /** One real pointer drag of a shelf tile onto a drop zone: down, two moves, up. */
    async dragTile(partType, zoneKey) {
      const tile = page.locator(`[data-entry-key="part:${partType}"]`);
      // hover() waits until the tile is stable and receives events, so the box read next is where it really is.
      await tile.hover();
      const from = await tile.boundingBox();
      await page.mouse.move(from.x + 20, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + 60, from.y, { steps: 5 }); // the activation move goes a little up and sideways, never down into dnd-kit's bottom auto-scroll band
      const zone = page.locator(`[data-zone="${zoneKey}"]`);
      await expect(zone).toBeVisible();
      const to = await zone.boundingBox();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
      await dropPlaceLit(page);
      await page.mouse.up();
    },
    /** The dotted cell of a free Grid that shows while a part is dragged over it (column and row, both from 1). */
    gridCell: (gridId, col, row) => page.locator(`[data-grid-cell="${gridId}:${col}:${row}"]`),
    /** The wrapper of a part placed on a free Grid; its `data-grid-place` reads "col:span:row:rowSpan". */
    gridItem: (id) => page.locator(`[data-grid-item="${id}"]`),
    /** One real pointer drag of a shelf tile onto a cell of a free Grid: down, a small move (the cells show), the cell's centre, "Drop here" lit, up. */
    async dragTileToCell(partType, gridId, col, row) {
      const tile = page.locator(`[data-entry-key="part:${partType}"]`);
      await tile.hover();
      const from = await tile.boundingBox();
      await page.mouse.move(from.x + 20, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + 60, from.y, { steps: 5 }); // the activation move goes a little up and sideways, never down into dnd-kit's bottom auto-scroll band
      const cell = page.locator(`[data-grid-cell="${gridId}:${col}:${row}"]`);
      await expect(cell).toBeVisible();
      const to = await cell.boundingBox();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
      await gridPlaceLit(page, 'free');
      await dropPlaceLit(page);
      await page.mouse.up();
    },
    /** One real pointer drag of a placed block (by its "Drag to move" handle) onto a cell. state 'taken' expects the red target and no "Drop here". */
    async dragBlockToCell(name, gridId, col, row, state = 'free') {
      await canvas.getByRole('group', { name, exact: true }).first().focus();
      const grip = page.getByRole('button', { name: `Drag to move ${name}`, exact: true });
      await grip.hover();
      const from = await grip.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 40, from.y + from.height / 2 + 40, { steps: 5 });
      const cell = page.locator(`[data-grid-cell="${gridId}:${col}:${row}"]`);
      await expect(cell).toBeVisible();
      const to = await cell.boundingBox();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
      await gridPlaceLit(page, state);
      if (state === 'free') await dropPlaceLit(page);
      else await expect(page.locator('[data-grid-taken]')).toHaveCount(1);
      await page.mouse.up();
    },
    /** One real pointer drag of the width or height handle of a placed block to the centre of a cell (the part ends in that column or row). */
    async dragGridHandle(name, axis, gridId, col, row) {
      await canvas.getByRole('group', { name, exact: true }).first().focus();
      const grip = page.getByRole('separator', { name: `Change the ${axis} of ${name}`, exact: true });
      await grip.hover();
      const from = await grip.boundingBox();
      const x = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await expect(grip).toBeFocused();
      const cell = page.locator(`[data-grid-cell="${gridId}:${col}:${row}"]`);
      await expect(cell).toBeVisible();
      const to = await cell.boundingBox();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
      await page.mouse.up();
    },
    /** One real pointer drag of the handle right of a block by some twelfths of its row (negative: to the left). */
    async dragHandle(name, twelfths) {
      const grip = handle(name);
      // The chrome layer repositions the handle after renders: hover() waits until it is stable and receives
      // events, then the box is read and the press is checked (ResizeHandle focuses the handle on pointer down).
      await grip.hover();
      const from = await grip.boundingBox();
      const row = await canvas
        .getByRole('group', { name, exact: true })
        .first()
        .evaluate((el) => el.closest('[data-sizing-row]').getBoundingClientRect().width);
      const x = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await expect(grip).toBeFocused();
      await page.mouse.move(x + (row * twelfths) / 12, y, { steps: 10 });
      await page.mouse.up();
    },
  };
}
