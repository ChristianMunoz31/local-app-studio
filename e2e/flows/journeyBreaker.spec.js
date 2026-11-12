// Proof journey "breaker" (DESIGN-phase14.md, CRITIQUE-phase14-breaker.md): the attacks that lost work or left no way out, each now
// answered in plain words. Back with an unsavable draft asks; removing a field a chart uses finishes with one press; deleting a page a
// button goes to is refused in words; the same app imported twice gets a free name; a damaged feature file gets the plain sentence;
// Design at 800 px shows the page near the top. Every test runs with the console-error guard on: only handled 4xx answers are allowed.
// Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { design } from '../pages/design.js';
import { NEVER_SHOWN } from '../pages/journey.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

/** A refused request logs "Failed to load resource ... status of 4xx" in the console; that is handled, anything else is not. */
const allowHandled4xx = () => test.info().annotations.push({ type: 'allow-console-errors', description: 'status of 4\\d\\d' });
const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
const crewRosterFile = new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const textField = { id: 'name', label: 'Name', type: 'text', required: true };
const CREWS = {
  id: 'crews',
  label: 'Crews',
  titleField: 'name',
  fields: [textField, { id: 'status', label: 'Status', type: 'select', options: ['open', 'closed'], default: 'open' }],
};
const heading = (id, text) => ({ id, type: 'Heading', props: { size: 'lg' }, children: text });
const pageOf = (id, route, title, children, sources = []) => ({ id, route, title, sources, layout: { id: `root_${id}`, type: 'Page', props: {}, children } });

/** A blank app made through the Studio API and changed by `mutate(spec)`. */
async function makeApp(page, name, mutate) {
  const created = await page.request.post('/api/studio/apps', { data: { name } });
  expect(created.status()).toBe(201);
  const record = (await created.json()).data;
  const spec = structuredClone(record.spec);
  mutate(spec);
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status(), await put.text()).toBe(200);
  return (await put.json()).data;
}
const getSpec = async (page, id) => (await (await page.request.get(`/api/studio/apps/${id}`)).json()).data.spec;

test('Back with a draft that cannot be saved asks first; Stay keeps the draft', async ({ page }) => {
  const app = await makeApp(page, 'Back Test', () => {});
  await page.goto('/apps');
  await page.getByRole('link', { name: 'Back Test' }).click();
  await steps(page).getByRole('link', { name: /Data/ }).click();
  await expect(page).toHaveURL(/\/data$/);

  // A table with no name cannot be saved.
  await page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: 'Add table' }).click();
  await page.getByLabel('Table name').fill('');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await page.goBack();
  const stuck = page.getByRole('alertdialog', { name: 'Your changes on Data cannot be saved yet' });
  await expect(stuck).toBeVisible();
  await expect(stuck.getByRole('button', { name: 'Discard changes' })).toBeVisible();
  await stuck.getByRole('button', { name: 'Stay' }).click();
  await expect(stuck).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/apps/${app.id}/data$`));
  await expect(page.getByLabel('Table name')).toBeVisible();
});

test('removing a field a chart uses ends with "Remove it from those parts too"', async ({ page }) => {
  const app = await makeApp(page, 'Crew Stats', (spec) => {
    spec.tables = [CREWS];
    spec.pages = [
      pageOf(
        'home',
        '/',
        'Home',
        [
          heading('h_home', 'Crew stats'),
          { id: 'chart_a', type: 'Chart', props: { source: 'all_crews', groupBy: 'status', measure: 'count', title: 'Crews by status' }, children: [] },
          { id: 'table_a', type: 'DataTable', props: { source: 'all_crews', columns: ['name', 'status'] }, children: [] },
        ],
        [{ id: 'all_crews', table: 'crews', mode: 'list' }],
      ),
    ];
    spec.nav = [{ pageId: 'home', label: 'Home', icon: 'home' }];
  });
  await page.goto(`/apps/${app.id}/data`);
  await page.getByRole('navigation', { name: 'Tables' }).getByRole('button', { name: /Crews/ }).click();
  await page.getByRole('button', { name: 'Delete field Status' }).click();
  await expect(page.getByText('Removed the field Status.')).toBeVisible();

  // The reason sits beside the greyed Save, in the app's words: the page title, not an id.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.getByText('Page Home still uses what you removed. Press Remove it from those parts too, or fix it in Design.')).toBeVisible();
  const text = await page.locator('main').innerText();
  expect(text, 'a code word on the Data step').not.toMatch(/Use one of|created_at|all_crews|"crews"|"status"/);
  expect(text.match(NEVER_SHOWN)).toBeNull();

  await page.getByRole('button', { name: 'Remove it from those parts too' }).click();
  await expect(page.getByText('Took it out of the parts that used it.')).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  // Taking out a field removes its preview data, so Save asks once (the existing "Save and remove data?" dialog).
  const confirm = page.getByRole('alertdialog', { name: 'Save and remove data?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Save and remove' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');

  // The saved app no longer names the field anywhere on its pages.
  const spec = await getSpec(page, app.id);
  expect(spec.tables[0].fields.map((f) => f.id)).toEqual(['name']);
  expect(JSON.stringify(spec.pages)).not.toContain('status');
});

test('deleting a page a button goes to is refused in plain words', async ({ page }) => {
  const app = await makeApp(page, 'Crew Pages', (spec) => {
    spec.pages = [
      pageOf('home', '/', 'Home', [heading('h_home', 'Home'), { id: 'go_archive', type: 'Button', props: { action: { action: 'navigate', pageId: 'archive' } }, children: 'Open the archive' }]),
      pageOf('archive', '/archive', 'Archive', [heading('h_archive', 'Archive')]),
    ];
    spec.nav = [{ pageId: 'home', label: 'Home', icon: 'home' }];
  });
  await page.goto(`/apps/${app.id}/design`);
  const d = design(page);
  await expect(d.canvas).toBeVisible();
  await d.page().selectOption({ label: 'Archive' });
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete this page' }).click();

  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Delete the page Archive?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('The Button on Home goes to this page.')).toBeVisible();
  await expect(dialog.getByText('Change where it goes first.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete page' })).toHaveCount(0);
  const words = await dialog.innerText();
  expect(words, 'ids and checker words in the refusal').not.toMatch(/archive_2|Use one of|there is no page/i);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toHaveCount(0);
  expect((await getSpec(page, app.id)).pages.map((p) => p.id)).toEqual(['home', 'archive']);
});

test('importing the same app twice names the second one "Crew Roster 2"', async ({ page }) => {
  await page.goto('/apps');
  const file = page.getByTestId('import-file');
  await file.setInputFiles(crewRosterFile.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  await expect(page.getByText('Imported "Crew Roster".')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Crew Roster/ })).toHaveCount(1);

  await file.setInputFiles(crewRosterFile.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  await expect(page.getByText('Imported "Crew Roster" as "Crew Roster 2".')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Crew Roster 2/ })).toHaveCount(1);
  // One message at a time: the first line is gone.
  await expect(page.getByText('Imported "Crew Roster".', { exact: true })).toHaveCount(0);
  const names = (await (await page.request.get('/api/studio/apps')).json()).data.map((a) => a.name);
  expect(names.filter((n) => n.startsWith('Crew Roster')).sort()).toEqual(['Crew Roster', 'Crew Roster 2']);
});

test('a damaged feature file gets the plain sentence, not the checker words', async ({ page }) => {
  allowHandled4xx();
  // A feature whose settings point at a part that is not in it (the checker words for this were the critic's C-breaker-14).
  const damaged = {
    format: 'local-app-studio-feature',
    formatVersion: 1,
    feature: {
      id: 'broken_header',
      label: 'Broken header',
      description: 'A header with a setting that points at a part that is not there.',
      params: [{ name: 'list', label: 'List', type: 'source' }],
      fragment: { id: 'head_1', type: 'Section', props: { title: 'Header' }, children: [{ id: 'text_1', type: 'Heading', props: { size: 'lg' }, children: 'Header' }] },
      bindings: [{ param: 'list', layer: 'chart_1', target: 'props.source' }],
    },
  };
  await page.goto('/features');
  await page.getByTestId('feature-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(damaged)) });
  const sentence = page.getByText('This feature file has problems, so nothing was imported. Ask the person who sent it for a new export.');
  await expect(sentence).toBeVisible();
  // The message is brought into view and takes the focus (the focus is on it or on the box that holds it).
  await expect(sentence).toBeInViewport();
  const focusHoldsMessage = await sentence.evaluate((el) => {
    const active = document.activeElement;
    return active !== null && active !== document.body && (active.contains(el) || el.contains(active));
  });
  expect(focusHoldsMessage, 'the refused import message has the focus').toBe(true);
  // The problem list is folded; opened, it is in plain words and shows each line once.
  const box = sentence.locator('xpath=ancestor::div[.//summary][1]');
  await box.getByText('Show what is wrong').click();
  const shown = await box.innerText();
  expect(shown, 'checker words in the feature problem list').not.toMatch(/fragment|binding|featureId|Parameter "|chart_1/);
  const lines = shown.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  expect(new Set(lines).size, `a line shown twice: ${JSON.stringify(lines)}`).toBe(lines.length);
  const list = (await (await page.request.get('/api/studio/features')).json()).data;
  expect(JSON.stringify(list)).not.toContain('broken_header');
});

test('Design at 800 px shows the page near the top: the shelf is capped', async ({ page }) => {
  const app = await makeApp(page, 'Narrow Check', (spec) => {
    spec.pages = [pageOf('home', '/', 'Home', [heading('h_home', 'Narrow check heading')])];
  });
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto(`/apps/${app.id}/design`);
  const d = design(page);
  await expect(d.canvas).toBeVisible();
  // The critic saw the canvas start 8036 px down under 34 stacked tiles. Now the shelf is a capped, scrolling box above the page.
  const shelf = page.locator('aside').filter({ has: page.getByRole('searchbox', { name: 'Search parts and features' }) });
  const shelfBox = await shelf.boundingBox();
  const overflowY = await shelf.evaluate((el) => getComputedStyle(el).overflowY);
  expect(shelfBox.height, `the shelf is ${Math.round(shelfBox.height)} px tall`).toBeLessThanOrEqual(400);
  expect(['auto', 'scroll']).toContain(overflowY);
  const box = await d.canvas.boundingBox();
  expect(box.y, `the page layout starts ${Math.round(box.y)} px down`).toBeLessThan(800);
  // No sideways scroll at this width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(ctx.server.outbound()).toEqual([]);
});

test('every step of an app loads without a console error', async ({ page }) => {
  test.setTimeout(120_000);
  // The guard in e2e/support/fixtures.js fails any test that logs a console error or a page error; this walk opens each screen.
  const apps = (await (await page.request.get('/api/studio/apps')).json()).data;
  const app = apps.find((a) => a.name === 'Crew Stats');
  await page.goto('/apps');
  await page.goto('/features');
  await expect(page.getByRole('heading', { name: 'Features' }).first()).toBeVisible();
  for (const step of ['prompt', 'design', 'data', 'preview', 'build']) {
    await page.goto(`/apps/${app.id}/${step}`);
    await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible();
    if (step === 'preview') await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
    const text = await page.locator('main').innerText();
    if (step !== 'preview') expect(text.match(NEVER_SHOWN), `a word that is never shown, on ${step}`).toBeNull();
  }
  expect(ctx.server.outbound()).toEqual([]);
});
