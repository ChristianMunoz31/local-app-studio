// Phase 17 journey, the freelancer (CRITIQUE-phase17-freelancer.md): Green Acre Landscaping wants a job tracker. The consumer's goal in short form on
// the honest fake helper (cannedDescribeChat): say it once, see what the helper left out ("Not made:"), add the tables by asking, use the design,
// take a row in Preview without a visit to Design, export the app by its name and duplicate it for the second site.
// Actions are counted per stage with stageCounter.js and printed. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { NEVER_SHOWN } from '../pages/journey.js';
import { preview } from '../pages/preview.js';
import { paneHeading, reviewPane } from '../support/helperApps.js';
import { stagedJourney } from '../support/stageCounter.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { appCards, openStartBox } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });

const PROMPT =
  'A job tracking app for Green Acre Landscaping. Clients (name, phone, address). Jobs with a date, a status (Scheduled, In progress, Done) and the crew assigned. ' +
  'A chart of jobs by status on the home page and a menu button to add a job.';
const ASKS = ['Add a Clients table (name, phone, address).', 'Add a Jobs table (name, date, status).'];
const BUDGET = 24;

test('Green Acre Landscaping: prompt, asks judged Done, Use this, a row in Preview, export by name, duplicate for the second site', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(150_000);
  const j = stagedJourney(page);

  // Prompt
  j.stage('Prompt');
  await page.goto('/apps');
  await openStartBox(page, (l) => j.click(l));
  await j.fill(page.getByLabel('Your prompt'), PROMPT);
  await j.click(page.getByRole('button', { name: 'Make my app', exact: true }));
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });
  const appId = /\/apps\/([^/]+)\/prompt$/.exec(page.url())[1];
  const review = reviewPane(page, 'What the helper made');
  // P17-03: the review says what the prompt named and the design lacks, before anything is used.
  await expect(review.getByText(/^Not made: .*Clients/)).toBeVisible();
  await expect(review.getByText(/^Not made: .*Jobs/)).toBeVisible();
  // P17-17: the app carries the capitalised name of the person, not the first two words.
  const named = async () => (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.name;
  expect(await named()).toBe('Green Acre Landscaping');

  for (const words of ASKS) {
    await j.fill(page.getByLabel('Ask for a change'), words);
    await j.click(page.getByRole('button', { name: 'Ask', exact: true }));
    const done = page.getByRole('region').filter({ has: page.locator('q', { hasText: words }) });
    // P17-02: the ask is judged against the change ("Done: ..."), and the one just asked is the one quoted.
    await expect(done.getByRole('list', { name: 'Your ask' }).getByRole('listitem').filter({ hasText: /^Done:/ })).toHaveCount(1, { timeout: 30_000 });
    await expect(done.getByText('Nothing changed.')).toHaveCount(0);
  }
  // The tables asked for are in the design now and are no longer "Not made" as tables; no page shows them yet,
  // so phase 26 says "a page for" each of them (src/studio/lib/notMade.ts).
  const after = reviewPane(page, 'What the helper made');
  await expect(after.getByRole('list', { name: 'Tables' }).getByRole('listitem').filter({ hasText: /^Clients: Name, Phone, Address/ })).toHaveCount(1);
  await expect(after.getByRole('list', { name: 'Tables' }).getByRole('listitem').filter({ hasText: /^Jobs: / })).toHaveCount(1);
  const notMade = await page.getByText(/^Not made: /).allInnerTexts();
  for (const line of notMade) expect(line.replace(/a page for (Clients|Jobs)/g, '')).not.toMatch(/Clients|Jobs/);
  expect(notMade.join(' ')).toMatch(/a page for Clients/);
  expect(notMade.join(' ')).toMatch(/a page for Jobs/);
  await expect(page.getByLabel('Your prompt')).toHaveValue(PROMPT);
  await j.click(page.getByRole('button', { name: 'Use this', exact: true }));
  await expect(page).toHaveURL(/\/design$/);
  const saved = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data;
  expect(saved.spec.tables.map((t) => t.label)).toEqual(expect.arrayContaining(['Crews', 'Clients', 'Jobs']));
  // P17-12: the first design is runnable: the menu bar is on and the listed table has its form.
  expect(JSON.stringify(saved.spec.pages)).toContain('RecordForm');

  // Preview: a row goes in through the form of the design, with no visit to Design before it.
  j.stage('Preview');
  const p = preview(page);
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Preview/ }));
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const scope = p.scope;
  await j.fill(scope.getByRole('textbox', { name: /^Name/ }).first(), 'North crew');
  // The list on Home shows the open crews, so the row is given that status.
  await j.select(scope.getByLabel('Status', { exact: true }).first(), { label: 'open' });
  await j.click(scope.getByRole('button', { name: 'Add', exact: true }).first());
  await expect(scope.getByRole('table').first().getByText('North crew')).toBeVisible();

  // Build: the step is reachable and says what it needs in plain words.
  j.stage('Build');
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Build/ }));
  await expect(page.getByRole('heading', { level: 3, name: /Build/ }).first()).toBeVisible();
  expect((await page.getByRole('main').innerText()).match(NEVER_SHOWN), 'a word that is never shown, on Build').toBeNull();

  // Apps: export by the name of the app (P17-15), duplicate for the second site (P17-16).
  j.stage('Design');
  await page.goto('/apps');
  const card = appCards(page).filter({ hasText: 'Green Acre Landscaping' }).first();
  await j.click(card.getByRole('button', { name: 'More actions for Green Acre Landscaping' }));
  const download = page.waitForEvent('download');
  await j.click(page.getByRole('menuitem', { name: 'Export', exact: true }));
  expect((await download).suggestedFilename()).toBe('Green Acre Landscaping app.json');
  await expect(page.getByText('It holds the design. Records added in Preview stay on this computer.').first()).toBeVisible();

  await j.click(card.getByRole('button', { name: 'More actions for Green Acre Landscaping' }));
  await j.click(page.getByRole('menuitem', { name: 'Duplicate', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Duplicate Green Acre Landscaping' });
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Green Acre Landscaping Copy');
  await j.fill(dialog.getByLabel('Name', { exact: true }), 'Green Acre North Site');
  await j.click(dialog.getByRole('button', { name: 'Duplicate', exact: true }));
  await expect(page.getByText('Duplicated "Green Acre Landscaping" as "Green Acre North Site". The copy starts with no records.').first()).toBeVisible();

  const counts = j.report(test.info(), 'freelancer');
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(BUDGET);
  expect(ctx.server.outbound()).toEqual([]);
});
