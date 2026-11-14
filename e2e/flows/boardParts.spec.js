// The three parts phase 31 added, run in Preview of a small synthetic app (e2e/support/boardApps.js), in both builds (no helper needed):
//   Kanban: move a card with the Move menu and with an Arrow key, see "Moved X to Y." and the status rule's words, and the saved value.
//   Global search: a 1 or 2 letter term shows "Type 3 or more letters to search."; 3 letters show results grouped by table; a click opens the record.
//   Inline editing in the Table part (edit: cells): edit a cell and see "Saved.", see "Name is required." for an emptied required field,
//   and see the rule's words after a status edit.
// Every wait is on a shown sentence or role (T3). Each test has its own app, so a failure in one does not skip the others.
// Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { crewsByName, openBoardPreview } from '../support/boardApps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test('Kanban: the Move menu and an Arrow key move cards, the status rule runs and the new value is saved', async ({ page }) => {
  const scope = await openBoardPreview(page, 'kanban');
  const column = (name) => scope.getByRole('region', { name, exact: true });

  await expect(scope.getByRole('heading', { level: 3 })).toHaveText(['todo', 'doing', 'done', 'No Status']);
  await expect(column('todo').getByRole('button', { name: 'Move Alpha' })).toBeVisible();
  await expect(column('todo').getByRole('button', { name: 'Move Alpine' })).toBeVisible();
  await expect(column('doing').getByRole('button', { name: 'Move Bravo' })).toBeVisible();

  // The Move menu lists the other columns; a choice moves the card.
  await scope.getByRole('button', { name: 'Move Alpha' }).click();
  const menu = scope.getByRole('menu', { name: 'Move Alpha to' });
  await expect(menu.getByRole('menuitem')).toHaveText(['doing', 'done', 'No Status']);
  await menu.getByRole('menuitem', { name: 'doing', exact: true }).click();
  await expect(scope.getByText('Moved Alpha to doing.', { exact: true })).toBeVisible();
  await expect(column('doing').getByRole('button', { name: 'Move Alpha' })).toBeVisible();
  await expect(column('todo').getByRole('button', { name: 'Move Alpha' })).toHaveCount(0);

  // An Arrow key on the Move button moves one column right; moving to done runs the rule and says so.
  await scope.getByRole('button', { name: 'Move Bravo' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(scope.getByText('Moved Bravo to done. Closed on was set to today.', { exact: true })).toBeVisible();
  await expect(column('done').getByRole('button', { name: 'Move Bravo' })).toBeVisible();
  await expect(column('doing').getByRole('button', { name: 'Move Bravo' })).toHaveCount(0);

  // What the cards say is what the data holds.
  const crews = await crewsByName(page.request);
  expect(crews.Alpha.status).toBe('doing');
  expect(crews.Bravo.status).toBe('done');
  expect(crews.Bravo.closed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(crews.Alpine.status).toBe('todo');
  expect(ctx.server.outbound()).toEqual([]);
});

test('Global search: a short term asks for more, a longer one lists hits grouped by table, and a click opens the record', async ({ page }) => {
  const scope = await openBoardPreview(page, 'search');
  const box = scope.getByRole('combobox', { name: 'Search the board' });
  await expect(box).toBeEnabled();

  // 1 and 2 characters: the plain "type more" state, and no popup.
  await box.fill('a');
  await expect(scope.getByText('Type 3 or more letters to search.', { exact: true })).toBeVisible();
  await box.fill('al');
  await expect(scope.getByText('Type 3 or more letters to search.', { exact: true })).toBeVisible();
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await expect(scope.getByRole('option')).toHaveCount(0);

  // 3 characters: results, grouped by table.
  await box.fill('alp');
  await expect(scope.getByText('3 results in 2 tables', { exact: true })).toBeVisible();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  const crews = scope.getByRole('group', { name: 'Crews', exact: true });
  const people = scope.getByRole('group', { name: 'People', exact: true });
  await expect(crews.getByRole('option')).toHaveCount(2);
  await expect(crews.getByRole('option', { name: 'Alpha', exact: true })).toBeVisible();
  await expect(crews.getByRole('option', { name: 'Alpine', exact: true })).toBeVisible();
  await expect(people.getByRole('option')).toHaveText(['Alpina Reed']);

  // A term nothing matches says so.
  await box.fill('zzz');
  // The sentence is on screen and in the live region; the live region is the one a screen reader hears.
  await expect(scope.getByRole('status')).toHaveText('No records match.');
  await expect(scope.getByRole('option')).toHaveCount(0);

  // Open a record: a click on a hit goes to the record page of the hit table.
  await box.fill('alp');
  await expect(scope.getByText('3 results in 2 tables', { exact: true })).toBeVisible();
  await people.getByRole('option', { name: 'Alpina Reed', exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/people\/[^/]+$/);
  await expect(scope.getByText('Alpina Reed').first()).toBeVisible();
  await expect(scope.getByRole('combobox')).toHaveCount(0);
  expect(ctx.server.outbound()).toEqual([]);
});

test('Inline editing: a cell edit shows Saved., an emptied required cell shows the form words, and a status edit shows the rule', async ({ page }) => {
  const scope = await openBoardPreview(page, 'table');

  // Edit a text cell: Enter saves, the row shows the new value and says so.
  await scope.getByRole('button', { name: 'Edit Name of Alpha' }).click();
  const name = scope.getByLabel('Name of Alpha', { exact: true });
  await expect(name).toBeFocused();
  await name.fill('Alfa');
  await name.press('Enter');
  await expect(scope.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(scope.getByRole('button', { name: 'Edit Name of Alfa' })).toBeVisible();
  await expect(scope.getByRole('button', { name: 'Edit Name of Alpha' })).toHaveCount(0);

  // Emptying a required field is refused in the form's words, next to the cell, and nothing is saved.
  await scope.getByRole('button', { name: 'Edit Name of Alfa' }).click();
  const again = scope.getByLabel('Name of Alfa', { exact: true });
  await again.fill('');
  await again.press('Enter');
  await expect(scope.getByRole('alert')).toHaveText('Name is required.');
  await expect(again).toHaveAttribute('aria-invalid', 'true');
  await again.press('Escape');
  await expect(scope.getByLabel('Name of Alfa', { exact: true })).toHaveCount(0);
  await expect(scope.getByRole('button', { name: 'Edit Name of Alfa' })).toBeVisible();

  // A status edit runs the rule: Saved., then the rule's words.
  await scope.getByRole('button', { name: 'Edit Status of Bravo' }).click();
  const status = scope.getByLabel('Status of Bravo', { exact: true });
  await status.selectOption('done');
  await status.press('Enter');
  await expect(scope.getByText('Saved. Closed on was set to today.', { exact: true })).toBeVisible();

  const crews = await crewsByName(page.request);
  expect(crews.Alfa.status).toBe('todo');
  expect(crews.Alpha).toBeUndefined();
  expect(crews.Bravo.status).toBe('done');
  expect(crews.Bravo.closed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(ctx.server.outbound()).toEqual([]);
});
