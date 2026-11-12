// Enhancement proofs on the Data step (DESIGN-phase14.md): P-17 (Add table and Add field focus the new name box with its text selected,
// Enter adds the next field, the inside name follows the label) and the Data half of P-23 (Undo says what it undid, with Redo).
// Typing goes through the keyboard with no select-all on purpose: that is the proof. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { visibleNotice } from '../pages/design.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

let dataUrl = '';

test('setup: a blank app opened on Data', async ({ page }) => {
  const made = await page.request.post('/api/studio/apps', { data: { name: 'Shop Loans' } });
  expect(made.status()).toBe(201);
  const id = (await made.json()).data.id;
  dataUrl = `/apps/${id}/data`;
  await page.goto(dataUrl);
  await expect(page.getByText('No tables yet. Add one to keep information in your app.')).toBeVisible();
});

test('P-17: Add table then typing replaces "New table"; Add field focus; Enter adds the next field; More options shows the inside name following the label', async ({ page }) => {
  await page.goto(dataUrl);
  await page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: 'Add table' }).click();

  // Add table: the name box has the focus with "New table" selected, so typing replaces it (no select-all).
  const tableName = page.getByLabel('Table name');
  await expect(tableName).toBeFocused();
  await expect(tableName).toHaveValue('New table');
  await page.keyboard.type('Tools');
  await expect(tableName).toHaveValue('Tools');

  // Add field: the new field's name box has the focus with "New field" selected.
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  const fresh = page.getByRole('group', { name: 'Field New field' });
  await expect(fresh).toHaveCount(1);
  await expect(fresh.getByLabel('Field name')).toBeFocused();
  await page.keyboard.type('Serial number');
  await expect(page.getByRole('group', { name: 'Field Serial number' }).getByLabel('Field name')).toHaveValue('Serial number');

  // Enter in a field name adds the next field and moves the focus to it.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Field New field' }).getByLabel('Field name')).toBeFocused();
  await page.keyboard.type('Condition');
  await expect(page.getByRole('group', { name: /^Field / })).toHaveCount(3);
  await expect(page.getByRole('group', { name: 'Field Condition' })).toHaveCount(1);
  await expect(page.getByText('New field')).toHaveCount(0);

  // More options: the inside names follow the labels, not "new_table" and "new_field" ("items" itself is a reserved table name, so the table is Tools).
  await page.locator('summary', { hasText: 'More options' }).click();
  await expect(page.getByLabel('Inside name', { exact: true })).toHaveValue('tools');
  await expect(page.getByLabel('Inside name of Serial number')).toHaveValue('serial_number');
  await expect(page.getByLabel('Inside name of Condition')).toHaveValue('condition');

  // Save, then a saved table keeps its inside name when it is renamed.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  await tableName.fill('Equipment');
  await expect(page.getByLabel('Inside name', { exact: true })).toHaveValue('tools');
  expect(ctx.server.outbound()).toEqual([]);
});

test('P-23 (Data): Undo says "Undid: ..." with Redo, Redo says "Redid: ..." with Undo', async ({ page }) => {
  await page.goto(dataUrl);
  await page.getByRole('button', { name: /Equipment|Tools/ }).first().click();
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  const added = visibleNotice(page, 'Added the field');
  await expect(added).toBeVisible();

  await added.getByRole('button', { name: 'Undo', exact: true }).click();
  const undid = visibleNotice(page, /^Undid: added the field /);
  await expect(undid).toBeVisible();
  await expect(undid.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();

  await undid.getByRole('button', { name: 'Redo', exact: true }).click();
  const redid = visibleNotice(page, /^Redid: /);
  await expect(redid).toBeVisible();
  await expect(redid.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
});
