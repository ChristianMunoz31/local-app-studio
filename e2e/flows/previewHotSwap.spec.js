// The Preview hot swap (ADR-019): a save that changes only the look or the layout keeps the running preview child (the status
// revision moves, its start time does not), and a data change (a new field) restarts it with the rows kept. The child is seen
// through the status route only (`GET /api/studio/preview/status`: revision, startedAt, data); no timing waits. Nothing leaves
// this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design } from '../pages/design.js';
import { preview } from '../pages/preview.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const APP = 'Swap Board';
const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
const status = async (page) => (await (await page.request.get('/api/studio/preview/status')).json()).data;
const rows = async (page) => (await (await page.request.get('/api/preview/data/tasks')).json()).data.rows.map((r) => r.title);

/** The status of the first start; each later test compares with the one before it. */
let last = null;

/** From Design, back to Preview by the step rail, and the app shows for the saved design. */
async function backToPreview(page) {
  await steps(page).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('preview-theme-scope')).toBeVisible();
}

test('the preview of an app with one task is running', async ({ page }) => {
  const created = await page.request.post('/api/studio/apps', { data: { name: APP } });
  expect(created.status()).toBe(201);
  const record = (await created.json()).data;
  const spec = record.spec;
  spec.tables = [{ id: 'tasks', label: 'Tasks', titleField: 'title', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] }];
  spec.pages[0].sources = [{ id: 'all_tasks', table: 'tasks', mode: 'list' }];
  spec.pages[0].layout = { ...spec.pages[0].layout, children: [{ id: 'heading_a', type: 'Heading', props: { size: 'lg' }, children: 'Swap Board' }] };
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);

  await preview(page).open(APP);
  const made = await page.request.post('/api/preview/data/tasks', { data: { title: 'Write report' } });
  expect(made.ok()).toBe(true);
  last = await status(page);
  expect(last).toMatchObject({ state: 'running', appId: record.id });
  expect(typeof last.startedAt).toBe('string');
});

test('a new look saved in Design keeps the running child', async ({ page }) => {
  const d = design(page);
  await d.open(APP);
  await page.getByRole('tab', { name: 'Look' }).click();
  await page.getByTestId('theme-picker').getByText('Forest', { exact: true }).first().click();
  await d.save();

  await backToPreview(page);
  const now = await status(page);
  expect(now.state).toBe('running');
  expect(now.revision).toBeGreaterThan(last.revision);
  expect(now.startedAt).toBe(last.startedAt);
  expect(await rows(page)).toEqual(['Write report']);
  last = now;
});

test('a part added to the layout keeps the running child', async ({ page }) => {
  const d = design(page);
  await d.open(APP);
  await d.addAt('Add here: Page, place 2', 'Divider line');
  await d.save();

  await backToPreview(page);
  await expect(preview(page).scope.locator('hr')).toHaveCount(1);
  const now = await status(page);
  expect(now.state).toBe('running');
  expect(now.revision).toBeGreaterThan(last.revision);
  expect(now.startedAt).toBe(last.startedAt);
  last = now;
});

test('a new field restarts the child, and the task is still there', async ({ page }) => {
  const d = design(page);
  await d.open(APP);
  await d.addAt('Add here: Page, place 2', 'Checklist');
  // One table, so the dialog has no Table choice.
  await d.addField('checklist_1', 'Done');
  await d.save();

  await backToPreview(page);
  await expect(preview(page).scope.getByRole('checkbox', { name: 'Write report' })).toBeVisible();
  const now = await status(page);
  expect(now.state).toBe('running');
  expect(now.revision).toBeGreaterThan(last.revision);
  expect(now.startedAt).not.toBe(last.startedAt);
  expect(now.data).toMatchObject({ kept: true, reason: 'tables_updated' });
  expect(await rows(page)).toEqual(['Write report']);
  expect(ctx.server.outbound()).toEqual([]);
});
