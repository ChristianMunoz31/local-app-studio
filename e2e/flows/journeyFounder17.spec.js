// Phase 17 journey, the founder (CRITIQUE-phase17-founder.md): a person who types what they want, asks for changes and touches Design only when
// the helper cannot do it. On the honest fake helper (cannedDescribeChat): the asks it can read are Done, the ones it cannot are Not done with an
// exit and Nothing changed, a negated ask is never Done, the first prompt stays as it was, and the saved app has one Ask box. Then Design: a total
// and a chart by month in the words of the app. Actions are counted per stage with stageCounter.js and printed. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { NEVER_SHOWN } from '../pages/journey.js';
import { design, visibleNotice } from '../pages/design.js';
import { paneHeading, recordStatus, reviewPane } from '../support/helperApps.js';
import { stagedJourney } from '../support/stageCounter.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { openStartBox } from '../pages/apps.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });

const IDEA =
  'A membership app for my climbing gym: members, plans and payments with an amount and a date. A page for each member, a total of what was paid and a chart of payments by month. Overdue ones first.';
const lineOf = (review, text) => review.getByRole('list', { name: 'Your ask' }).getByRole('listitem').filter({ hasText: text });
const BUDGET = 40;

test('a founder asks for changes: Done and Not done are said, the prompt stays, one Ask box; then a total and a chart by month in Design', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(60_000);
  const j = stagedJourney(page);
  const asked = async (words, region = page.getByRole('region')) => {
    await j.fill(page.getByLabel('Ask for a change'), words);
    await j.click(page.getByRole('button', { name: 'Ask', exact: true }));
    const r = region.filter({ has: page.locator('q', { hasText: words }) });
    await expect(r.locator('q', { hasText: words })).toBeVisible({ timeout: 30_000 });
    return r;
  };

  // Prompt
  j.stage('Prompt');
  await page.goto('/apps');
  await openStartBox(page, (l) => j.click(l));
  await j.fill(page.getByLabel('Your prompt'), IDEA);
  await j.click(page.getByRole('button', { name: 'Make my app', exact: true }));
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });
  const appId = /\/apps\/([^/]+)\/prompt$/.exec(page.url())[1];
  const said = await recordStatus(page);

  // An ask the helper does: Done. It says what happened to the waiting design once, on the answer (P17-21).
  const one = await asked('Add an email address to each person.');
  await expect(lineOf(one, /^Done: Add an email address to each person/)).toHaveCount(1);
  await expect.poll(said, { timeout: 10_000 }).toContain('The helper changed the waiting design. Check it, then press Use this.');
  await expect(page.getByLabel('Your prompt')).toHaveValue(IDEA);

  // An ask it cannot do: Not done, with an exit named for the clause, and Nothing changed (P17-02).
  const two = await asked('Add a chart of payments by month on the home page.');
  await expect(lineOf(two, /^Not done: Add a chart of payments by month/)).toHaveCount(1);
  await expect(lineOf(two, /^Not done:/).getByRole('button', { name: /^Do it in Design\. / })).toBeVisible();
  await expect(two.getByText('Nothing changed.')).toBeVisible();
  // Only the newest ask is quoted, and the earlier one is under "Asked before:" (P17-04).
  await expect(two.getByText('Asked before:')).toBeVisible();
  await expect(two.locator('q', { hasText: 'Add an email address to each person. Add a chart' })).toHaveCount(0);

  // A negated ask is never Done, even when the words of the change match the words of the ask (P17-02).
  const three = await asked('Do not add a Notes field to Items.');
  await expect(lineOf(three, /^Done:/)).toHaveCount(0);

  // The look, an ask the helper reads (a theme-less app): Done.
  const four = await asked('Change the look to dark green.');
  await expect(lineOf(four, /^Done: Change the look to dark green/)).toHaveCount(1);

  await j.click(page.getByRole('button', { name: 'Use this', exact: true }));
  await expect(page).toHaveURL(/\/design$/);

  // Back on Prompt: the first prompt is words (P17-05), and one Ask box.
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Prompt/ }));
  await expect(page.getByText('Your first prompt', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ask for a change')).toHaveCount(1);
  await expect(page.getByLabel('What should change?')).toHaveCount(0);

  // Design: a total and a chart by month, in the words of the app.
  j.stage('Design');
  const d = design(page);
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Design/ }));
  await expect(d.canvas).toBeVisible();
  await j.click(page.getByRole('button', { name: 'Add Number tile', exact: true }));
  // P17-14: the page lists Loans and the app has other tables, so the part asks which table instead of joining silently.
  const tile = page.getByRole('dialog', { name: 'Settings for Number tile' });
  await expect(tile.getByLabel('Table', { exact: true })).toBeVisible();
  // The page's own list comes first, then the other lists and tables.
  const tableOptions = await tile.getByLabel('Table', { exact: true }).locator('option').allInnerTexts();
  expect(tableOptions[1]).toBe('Loans (Returned is false)');
  await j.select(tile.getByLabel('Table', { exact: true }), { label: 'Loans (Returned is false)' });
  await expect(visibleNotice(page, 'Connected to Loans.')).toBeVisible();
  await j.click(page.getByRole('button', { name: 'Add Chart', exact: true }));
  const chart = page.getByRole('dialog', { name: 'Settings for Chart' });
  if (await chart.isVisible().catch(() => false)) await j.select(chart.getByLabel('Table', { exact: true }), { label: 'Loans (Returned is false)' });
  const group = page.getByRole('dialog', { name: 'Settings for Chart' }).getByLabel('Group by', { exact: true });
  if (!(await group.isVisible().catch(() => false))) await j.click(page.locator('[data-connection-badge]').last());
  const groupBy = page.getByRole('dialog', { name: 'Settings for Chart' }).getByLabel('Group by', { exact: true });
  await expect(groupBy).toBeVisible();
  // P17-23: a date field is offered as "Date out (by month)".
  const options = await groupBy.locator('option').allInnerTexts();
  expect(options.map((o) => o.trim())).toContain('Date out (by month)');
  await j.select(groupBy, { label: 'Date out (by month)' });
  await j.click(page.getByRole('dialog', { name: 'Settings for Chart' }).getByRole('button', { name: 'Apply' }));
  await j.click(page.getByRole('button', { name: 'Save', exact: true }));
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  const spec = (await (await page.request.get(`/api/studio/apps/${appId}`)).json()).data.spec;
  const kinds = JSON.stringify(spec.pages);
  expect(kinds).toContain('"StatCard"');
  expect(kinds).toContain('"Chart"');
  expect(spec.tables.find((t) => /person|people/i.test(t.label)).fields.map((f) => f.label)).toContain('Email address');
  expect((await page.getByRole('main').innerText()).match(NEVER_SHOWN), 'a word that is never shown, on Design').toBeNull();

  // Data and Preview: the Email field is on Data in plain words, and the app runs.
  j.stage('Data');
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Data/ }));
  await expect(page.getByRole('heading', { level: 3, name: 'Data', exact: true })).toBeVisible();
  // P17-24: the type hint is said once per table.
  const hints = await page.getByText('Number holds whole numbers. Decimal holds amounts like 12.50.', { exact: true }).count();
  expect(hints).toBeLessThanOrEqual(spec.tables.length);
  j.stage('Preview');
  await j.click(page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Preview/ }));
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  await expect(reviewPane(page, 'Your app')).toHaveCount(0);

  const counts = j.report(test.info(), 'founder');
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(BUDGET);
  expect(ctx.server.outbound()).toEqual([]);
});
