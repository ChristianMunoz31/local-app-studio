// Proof flow J2 (DESIGN-phase12.md 2.9, WP-5): change an existing app (heading words, a Number tile beside the table, a button on the
// menu bar, the Forest look), save and see it run, counted. The whole edit is asserted at 14 actions or fewer (13 before the table choice of P17-14) from Apps; a second test
// asserts the keyboard path into the page (1 Tab and Enter). Nothing leaves this computer.
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { journey } from '../pages/journey.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const crewRoster = () => JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));
const stepHeading = (page, name) => page.getByRole('heading', { level: 3, name, exact: true });
const notice = visibleNotice;
let appId = '';

test('J2: heading, a tile beside the table, a menu button, Forest, Save and Preview take 14 actions or fewer (13 before the table choice of P17-14)', async ({ page }) => {
  const imported = await page.request.post('/api/studio/apps/import', { data: { spec: crewRoster() } });
  expect(imported.status()).toBe(201);
  appId = (await imported.json()).data.id;

  const j = journey(page);
  const d = design(page);
  await page.goto('/apps');

  // Open the app at its pages: one click, and a designed app lands on Design.
  await j.click(page.getByRole('link', { name: 'Crew Roster' }));
  await expect(page).toHaveURL(/\/design$/);
  await expect(d.canvas).toBeVisible();
  const afterOpen = j.counts().actions;

  // Change a heading's words: double click, type, Apply (3).
  await j.dblclick(d.block('h1'));
  const dialog = page.getByRole('dialog', { name: 'Settings for Heading' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Text', { exact: true })).toBeFocused();
  await j.fill(dialog.getByLabel('Text', { exact: true }), 'Our crews');
  await j.click(dialog.getByRole('button', { name: 'Apply' }));
  await expect(d.canvas.getByRole('heading', { name: 'Our crews' })).toBeVisible();
  const afterHeading = j.counts().actions;

  // A Number tile beside the table: select the table, Beside, Add (3).
  await j.click(d.named('Table of records'));
  await j.click(page.getByRole('toolbar', { name: 'Actions for Table of records' }).getByRole('button', { name: /^Put a part beside Table of records$/ }));
  await j.click(page.getByRole('button', { name: 'Add Number tile' }));
  // P17-14: the page lists a table and the app has others, so the new tile asks which table; the page's own list comes first.
  const tileSettings = page.getByRole('dialog', { name: 'Settings for Number tile' });
  await expect(tileSettings).toBeVisible();
  await j.select(tileSettings.getByLabel('Table', { exact: true }), { index: 1 });
  // The answer replaces the placement line: it says what the tile connected to, with Undo; the row below proves it sits beside the table.
  await expect(notice(page, /^Connected to /).getByRole('button', { name: 'Undo' })).toBeVisible();
  const group = (name) => page.getByRole('group', { name, exact: true });
  await expect(page.locator('[data-sizing-row]').filter({ has: group('Table of records') }).filter({ has: group('Number tile') })).toHaveCount(1);
  const afterBeside = j.counts().actions;

  // A button on the menu bar: Look, Across the top, Add a button to the menu bar (3).
  await j.click(page.getByRole('tab', { name: 'Look' }));
  await j.click(page.getByRole('group', { name: 'Menu bar' }).getByText('Across the top', { exact: true }));
  await j.click(page.getByRole('button', { name: 'Add a button to the menu bar' }));
  await expect(d.menuSlot('end').getByText('Add to Crews')).toBeVisible();
  const afterButton = j.counts().actions;

  // The look (1), Save (1) and the rail's Preview (1).
  await j.click(page.getByTestId('theme-picker').getByText('Forest', { exact: true }).first());
  await j.click(page.getByRole('button', { name: 'Save', exact: true }));
  await expect(page.getByTestId('save-status')).toHaveText(/^All changes saved$/);
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Preview/ }));
  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('preview-theme-scope').getByRole('button', { name: 'Add to Crews' })).toBeVisible();
  await expect(page.getByTestId('preview-theme-scope').getByRole('heading', { name: 'Our crews' })).toBeVisible();

  const total = j.counts().actions;
  const note = `J2 actions: open ${afterOpen} (target 1), heading ${afterHeading - afterOpen} (3), tile beside ${afterBeside - afterHeading} (4: the table choice of P17-14 is one more), menu button ${afterButton - afterBeside} (3), whole edit ${total} (14 or fewer)`;
  test.info().annotations.push({ type: 'measured', description: note });
  expect(afterOpen, note).toBe(1);
  expect(afterHeading - afterOpen, note).toBeLessThanOrEqual(3);
  expect(afterBeside - afterHeading, note).toBeLessThanOrEqual(4);
  expect(afterButton - afterBeside, note).toBeLessThanOrEqual(3);
  expect(total, `${note}\n${j.trail()}`).toBeLessThanOrEqual(14);

  const stored = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.spec;
  expect(stored.theme.id).toBe('forest');
  expect(stored.menu.position).toBe('top');
  expect(JSON.stringify(stored.pages[0].layout)).toContain('Our crews');
});

test('J2K: from arriving on Design, 1 Tab reaches "Go to the page" and Enter puts the focus on the first part (2 keys)', async ({ page }) => {
  const j = journey(page);
  const d = design(page);
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(d.canvas).toBeVisible();
  // Opening an app from its card is not a step change: the focus is not moved to the step heading. Recorded, not asserted (see the report).
  const afterCard = await page.evaluate(() => document.activeElement?.tagName ?? 'none');
  test.info().annotations.push({ type: 'measured', description: `focus after opening an app from its card: ${afterCard}` });

  // Arriving on Design from another step (the rail) moves the focus to the step heading.
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Data/ }).click();
  await expect(stepHeading(page, 'Data')).toBeFocused();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Design/ }).click();
  await expect(d.canvas).toBeVisible();
  await expect(stepHeading(page, 'Design')).toBeFocused();

  await j.press('Tab');
  const skip = page.getByRole('link', { name: 'Go to the page' });
  await expect(skip).toBeFocused();
  await j.press('Enter');
  const first = page.locator('[data-canvas-block][tabindex="0"]').first();
  await expect(first).toBeFocused();
  expect(j.counts().keys, j.trail()).toBeLessThanOrEqual(2);
  test.info().annotations.push({ type: 'measured', description: `J2K keys from arriving on Design to the first part: ${j.counts().keys} (target 2)` });
  expect(ctx.server.outbound()).toEqual([]);
});
