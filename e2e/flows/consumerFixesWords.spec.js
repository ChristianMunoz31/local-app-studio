// Phase 17 proof, the words follow the table and a new data part asks which table (DESIGN-phase17.md P17-13, P17-14). An app with two tables
// (Crews, Jobs) and a Home page that lists Crews has a Quick add the Studio worded ("Add to Crews") and one the person worded ("Type a crew").
// Changing the table of each rewrites the first and keeps the second; a Form dropped on the page asks which table. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

const text = { id: 'name', label: 'Name', type: 'text', required: true };
const TABLES = [
  { id: 'crews', label: 'Crews', titleField: 'name', fields: [text] },
  { id: 'jobs', label: 'Jobs', titleField: 'name', fields: [text] },
];
const APP = 'Words Follow';
let appId = '';

test('setup: two tables and a Home page that lists Crews with two Quick adds', async ({ page }) => {
  const created = await page.request.post('/api/studio/apps', { data: { name: APP } });
  const record = (await created.json()).data;
  appId = record.id;
  const spec = record.spec;
  spec.tables = TABLES;
  spec.pages = [
    {
      id: 'home',
      route: '/',
      title: 'Home',
      sources: [{ id: 'all_crews', table: 'crews', mode: 'list' }],
      layout: {
        id: 'root',
        type: 'Page',
        props: {},
        children: [
          { id: 'h1', type: 'Heading', props: { size: 'lg' }, children: 'Home' },
          { id: 'qa1', type: 'QuickAdd', props: { table: 'crews', field: 'name', placeholder: 'Add to Crews' }, children: [] },
          { id: 'qa2', type: 'QuickAdd', props: { table: 'crews', field: 'name', placeholder: 'Type a crew' }, children: [] },
        ],
      },
    },
  ];
  spec.nav = [{ pageId: 'home', label: 'Home', icon: 'home' }];
  const put = await page.request.put(`/api/studio/apps/${appId}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);
});

test('P17-13: changing a Quick add to another table rewrites the words the Studio wrote and keeps the words the person typed', async ({ page }) => {
  await page.goto(`/apps/${appId}/design`);
  const d = design(page);
  await expect(d.canvas).toBeVisible();

  for (const id of ['qa1', 'qa2']) {
    const dialog = await d.changeTable(id, 'Quick add');
    await d.pickInSettings(dialog, 'Table', 'Jobs');
    await expect(dialog).toHaveCount(0);
  }
  await d.save();
  const home = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.spec.pages[0];
  const byId = Object.fromEntries(home.layout.children.map((c) => [c.id, c]));
  expect(byId.qa1.props).toMatchObject({ table: 'jobs', placeholder: 'Add to Jobs' });
  expect(byId.qa2.props).toMatchObject({ table: 'jobs', placeholder: 'Type a crew' });
  expect(ctx.server.outbound()).toEqual([]);
});

test('P17-14: a new Form on a page that lists a table asks which table, with the page table first, and says what it connected to', async ({ page }) => {
  await page.goto(`/apps/${appId}/design`);
  const d = design(page);
  await expect(d.canvas).toBeVisible();
  await page.getByRole('button', { name: 'Add Form' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings for Form' });
  const chooser = dialog.getByLabel('Table', { exact: true });
  await expect(chooser).toBeVisible();
  const options = await chooser.locator('option').allInnerTexts();
  expect(options.some((o) => o.trim() === 'Crews')).toBe(true);
  expect(options.some((o) => o.trim() === 'Jobs')).toBe(true);
  // Nothing was connected silently.
  await expect(visibleNotice(page, /^Connected the Form to /)).toHaveCount(0);
  await chooser.selectOption({ label: 'Jobs' });
  await expect(visibleNotice(page, 'Connected to Jobs.')).toBeVisible();
  await expect(page.locator('[data-connection-badge]').filter({ hasText: 'Connected to Jobs' }).last()).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});
