// Phase 22 proof: the helper places parts on a free grid, an ask keeps the placement and the review describes place changes
// (DESIGN-phase22.md Part 0 and Part 2 section 5), on the honest fake helper (cannedDescribeChat, scenario 'dashboard').
//   1. A dashboard prompt gives a free grid: five parts on it, the Places list, the saved Grid placement 'free' and rows 4.
//   2. "Add a tile." puts the new tile on the next free cell and moves nothing else.
//   3. "Move the chart to the bottom." moves only the Chart.
//   4. "Stack these instead." turns the grid back to flow.
//   5. An ask with no place words keeps the grid.
// Nothing leaves this computer. Studio API calls (estimate): about 150, well under the 300 per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { design } from '../pages/design.js';
import { ask, makeWithHelper, reviewPane, savedApp, useThis } from '../support/helperApps.js';
import { skipWithoutPro } from '../support/proBuild.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });

test.describe.configure({ mode: 'serial' });

const PROMPT = 'A sales dashboard: tiles for orders and revenue, a chart of orders by status and the list of orders.';
const lineOf = (review, text) => review.getByRole('list', { name: 'Your ask' }).getByRole('listitem').filter({ hasText: text });
const places = (review) => review.getByRole('list', { name: 'Places' }).getByRole('listitem');

let appId = '';

/** The home page's Grid and its children of the saved app. */
async function homeGrid(page) {
  const spec = (await savedApp(page, appId)).spec;
  const grid = spec.pages[0].layout.children.find((c) => c.type === 'Grid');
  return { spec, grid, kids: grid.children };
}
const cellOf = (kid) => kid.grid;
const labelOf = (kid) => kid.props.label ?? kid.props.title ?? kid.type;

/** Opens the saved app's Prompt step and asks, then waits for the judged review. */
async function askSaved(page, words) {
  await page.goto(`/apps/${appId}/prompt`);
  await expect(reviewPane(page, 'Your app')).toBeVisible({ timeout: 30_000 });
  await ask(page, words);
  const review = reviewPane(page, 'Your changes');
  await expect(review).toBeVisible({ timeout: 30_000 });
  return review;
}

test('a dashboard prompt gets a free grid: five placed parts and rows 4', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  appId = await makeWithHelper(page, PROMPT);
  await useThis(page);

  const { grid, kids } = await homeGrid(page);
  expect(grid.props.placement).toBe('free');
  expect(grid.props.rows).toBe(4);
  expect(kids.map((k) => k.type)).toEqual(['StatCard', 'StatCard', 'StatCard', 'Chart', 'RecordList']);
  expect(kids.map(cellOf)).toEqual([
    { col: 1, span: 4, row: 1, rowSpan: 1 },
    { col: 5, span: 4, row: 1, rowSpan: 1 },
    { col: 9, span: 4, row: 1, rowSpan: 1 },
    { col: 1, span: 8, row: 2, rowSpan: 3 },
    { col: 9, span: 4, row: 2, rowSpan: 3 },
  ]);
  await expect(design(page).block(grid.id)).toBeVisible({ timeout: 30_000 });
  expect(ctx.server.outbound()).toEqual([]);
});

test('"Add a tile." puts the new tile on the next free cell and moves nothing else', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  const before = await homeGrid(page);
  const review = await askSaved(page, 'Add a tile.');
  await expect(lineOf(review, 'Done: Add a tile')).toHaveCount(1);
  await expect(places(review).filter({ hasText: /^Placed Number tile at column 1, row 5, 3 columns wide$/ })).toHaveCount(1);
  await expect(places(review).filter({ hasText: /^Nothing moved on the grid$/ })).toHaveCount(1);
  await useThis(page);

  const { grid, kids } = await homeGrid(page);
  expect(grid.id).toBe(before.grid.id);
  expect(grid.props.placement).toBe('free');
  expect(kids).toHaveLength(6);
  const added = kids.find((k) => k.props.label === 'New tile');
  expect(added.type).toBe('StatCard');
  expect(added.grid).toEqual({ col: 1, span: 3, row: 5, rowSpan: 1 });
  expect(kids.filter((k) => k !== added)).toEqual(before.kids);
  await expect(design(page).block(added.id)).toBeVisible({ timeout: 30_000 });
  expect(ctx.server.outbound()).toEqual([]);
});

test('"Move the chart to the bottom." moves only the Chart', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  const before = await homeGrid(page);
  const review = await askSaved(page, 'Move the chart to the bottom.');
  await expect(lineOf(review, 'Done: Move the chart to the bottom')).toHaveCount(1);
  await expect(places(review).filter({ hasText: /^Moved Chart to / })).toHaveCount(1);
  await useThis(page);

  const { kids } = await homeGrid(page);
  const chartBefore = before.kids.find((k) => k.type === 'Chart');
  const chart = kids.find((k) => k.type === 'Chart');
  expect(chart.id).toBe(chartBefore.id);
  expect(chart.grid.row).toBeGreaterThan(chartBefore.grid.row);
  expect(chart.grid.col).toBe(chartBefore.grid.col);
  expect(kids.filter((k) => k.type !== 'Chart')).toEqual(before.kids.filter((k) => k.type !== 'Chart'));
  expect(ctx.server.outbound()).toEqual([]);
});

test('"Stack these instead." turns the grid back to flow and drops every placed cell', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  const before = await homeGrid(page);
  const review = await askSaved(page, 'Stack these instead.');
  await expect(lineOf(review, 'Done: Stack these instead')).toHaveCount(1);
  await expect(places(review).filter({ hasText: /^Turned off Place parts freely for Auto grid on Dashboard$/ })).toHaveCount(1);
  await useThis(page);

  const { grid, kids } = await homeGrid(page);
  expect(grid.id).toBe(before.grid.id);
  expect(grid.props.placement).toBeUndefined();
  expect(grid.props.rows).toBeUndefined();
  expect(grid.props.columns).toBe(1);
  expect(kids).toHaveLength(before.kids.length);
  expect(kids.every((k) => k.grid === undefined)).toBe(true);
  expect(ctx.server.outbound()).toEqual([]);
});

test('an ask with no place words keeps the grid free with the same parts in the same cells', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(120_000);
  appId = await makeWithHelper(page, PROMPT);
  await useThis(page);
  const before = await homeGrid(page);
  expect(before.grid.props.placement).toBe('free');

  const review = await askSaved(page, 'Add a notes field to Orders.');
  await expect(lineOf(review, 'Done: Add a notes field to Orders')).toHaveCount(1);
  await useThis(page);

  const after = await homeGrid(page);
  expect(after.grid.props.placement).toBe('free');
  expect(after.grid.props.rows).toBe(before.grid.props.rows);
  expect(after.kids.map((k) => [labelOf(k), cellOf(k)])).toEqual(before.kids.map((k) => [labelOf(k), cellOf(k)]));
  expect(ctx.server.outbound()).toEqual([]);
});

test('the review of a first dashboard design lists the placing in the Places list', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  await makeWithHelper(page, PROMPT);
  const review = reviewPane(page, 'What the helper made');
  await expect(places(review).filter({ hasText: /^Placed 5 parts in a grid on Dashboard$/ })).toHaveCount(1);
  await expect(review.getByText('Not made: Tiles')).toHaveCount(0);
});
