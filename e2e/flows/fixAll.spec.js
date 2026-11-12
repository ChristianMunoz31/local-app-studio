// Phase 25 proof flow: Fix all in Design (DESIGN-phase25.md section 7). A Crew Roster whose home page lists Crews and holds a create Form for
// People (a write to a table the page does not show), with the same kind of Form on a second page. Fix all repoints the Form of the open page
// to Crews in one step, leaves a Table of records that asks which table, and counts the Form of the other page. One Undo takes it back, Redo
// does it again, and Save keeps the repointed Form. Nothing leaves this computer.
// Studio API calls (estimate): about 50, well under the 300 per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { design, visibleNotice } from '../pages/design.js';
import { crewRosterSpec, getApp, makeApp } from '../support/critiqueApps.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

const APP = 'Fix All Roster';

test('Fix all repoints the Form of the open page in one step, counts the other page, and Undo and Redo move it as one', async ({ page }) => {
  const base = crewRosterSpec();
  const app = await makeApp(page.request, APP, (spec) => {
    spec.tables = structuredClone(base.tables);
    const home = structuredClone(base.pages[0]);
    spec.pages[0].sources = home.sources;
    spec.pages[0].layout = home.layout;
    spec.pages[0].layout.children.push({ id: 'form_home', type: 'RecordForm', props: { table: 'people', mode: 'create' }, children: [] });
    spec.pages.push({
      id: 'extra',
      title: 'Extra',
      route: '/extra',
      sources: [{ id: 'extra_crews', table: 'crews', limit: 50 }],
      // It shows Crews (a page that shows nothing is not warned about), so its People Form is the one the count mentions.
      layout: {
        id: 'root_extra',
        type: 'Page',
        props: {},
        children: [
          { id: 'list_extra', type: 'DataTable', props: { source: 'extra_crews', columns: ['name'] }, children: [] },
          { id: 'form_extra', type: 'RecordForm', props: { table: 'people', mode: 'create' }, children: [] },
        ],
      },
    });
    spec.nav = [
      { pageId: spec.pages[0].id, label: 'Home' },
      { pageId: 'extra', label: 'Extra' },
    ];
  });

  const d = design(page);
  await d.open(APP);
  await expect(d.badge('form_home')).toHaveAccessibleName('Connected to People. Change table');
  await expect(d.connections().getByRole('listitem')).toHaveCount(2);
  await expect(d.connections().getByRole('button', { name: 'Fix all' })).toBeVisible();

  // A Table of records dropped where Crews and People both fit stays not connected (it asks).
  const rootId = base.pages[0].layout.id;
  await d.dragTile('DataTable', `${rootId}:1`);
  await expect(page.locator('[data-not-connected]')).toHaveCount(1);

  await d.connections().getByRole('button', { name: 'Fix all' }).click();
  await expect(visibleNotice(page, 'Connected 1 part. 1 still needs a table. 1 more is on another page.')).toBeVisible();
  await expect(d.badge('form_home')).toHaveAccessibleName('Connected to Crews. Change table');
  await expect(page.locator('[data-not-connected]')).toHaveCount(1);

  // One Undo: the Form names People again, the dropped Table of records is still on the page (it was its own step).
  await d.undo().click();
  await expect(d.badge('form_home')).toHaveAccessibleName('Connected to People. Change table');
  await expect(page.locator('[data-not-connected]')).toHaveCount(1);
  await d.redo().click();
  await expect(d.badge('form_home')).toHaveAccessibleName('Connected to Crews. Change table');

  // The Table of records cannot be saved without a table: choose Crews for it, then Save keeps the repointed Form.
  await d.notConnected('datatable_1').getByRole('button', { name: 'Connect Table of records to a table' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings for Table of records' });
  await dialog.getByLabel('Table', { exact: true }).selectOption({ label: 'Crews (Status is active)' });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-not-connected]')).toHaveCount(0);
  await d.save();
  const saved = (await getApp(page.request, app.id)).spec;
  expect(saved.pages[0].layout.children.find((c) => c.id === 'form_home').props.table).toBe('crews');
  expect(saved.pages[1].layout.children[1].props.table).toBe('people');
  expect(ctx.server.outbound()).toEqual([]);
});
