// Phase 17 proof, the Prompt step judges what it did (DESIGN-phase17.md P17-02, P17-03, P17-04, P17-05, P17-17, P17-19, P17-21) on the
// honest fake helper (cannedDescribeChat: it does the asks it can read and otherwise returns the design as it was).
//   1. A waiting design: an ask the fake does says "Done: ...", one it cannot do says "Not done: ..." with its exit and "Nothing changed.";
//      "You asked for" shows the newest ask and "Asked before:" the earlier ones; one sentence about the app when a design is replaced.
//   2. A saved app: "Your first prompt" in the left pane and exactly one Ask box; asks on the saved app are judged too.
//   3. The freelancer's prompt: "Not made:" lists what the design lacks; the app is named from the person's own capitalised name.
// Nothing leaves this computer. Studio API calls (estimate): about 120, well under the 300 per 15 minutes.
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { NEVER_SHOWN } from '../pages/journey.js';
import { ask, makeWithHelper, paneHeading, recordStatus, reviewPane, savedApp, useThis } from '../support/helperApps.js';
import { skipWithoutPro } from '../support/proBuild.js';

const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });

test.describe.configure({ mode: 'serial' });

const LOANS_IDEA = 'A loans log for my workshop: items, people and which person has which item.';
const FREELANCER =
  'A job tracking app for Green Acre Landscaping. Clients (name, phone, address). Jobs with a date, a status (Scheduled, In progress, Done) and the crew assigned. ' +
  'A chart of jobs by status on the home page and a menu button to add a job.';
const lineOf = (review, text) => review.getByRole('list', { name: 'Your ask' }).getByRole('listitem').filter({ hasText: text });

let appId = '';

test('a waiting design: an ask the fake does is Done, an ask it cannot do is Not done with its exit and Nothing changed, and only the newest ask is quoted', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  appId = await makeWithHelper(page, LOANS_IDEA);
  const review = reviewPane(page, 'What the helper made');
  await expect(review.getByRole('list', { name: 'Tables' }).getByRole('listitem').filter({ hasText: /^People: Name, Phone/ })).toHaveCount(1);
  const said = await recordStatus(page);

  // Ask 1, one the fake does: the field is added, the ask is judged Done, and nothing else changed.
  const first = 'Add an email address to each person.';
  await ask(page, first);
  const done = reviewPane(page, 'What the helper made');
  await expect(done.locator('q', { hasText: first })).toBeVisible({ timeout: 30_000 });
  await expect(lineOf(done, 'Done: Add an email address to each person')).toHaveCount(1);
  await expect(done.getByRole('list', { name: 'Tables' }).getByRole('listitem').filter({ hasText: /^People: Name, Phone, Email address/ })).toHaveCount(1);
  await expect(done.getByText('Nothing changed.')).toHaveCount(0);
  await expect(done.getByText('It also changed', { exact: true })).toHaveCount(0);
  // The left box keeps the first prompt: the ask is not glued onto it.
  await expect(page.getByLabel('Your prompt')).toHaveValue(LOANS_IDEA);

  // P17-21: an ask on a waiting design says what happened to it once, on the answer (not at the ask start): a sentence about the app.
  const CHANGED = 'The helper changed the waiting design. Check it, then press Use this.';
  await expect.poll(said, { timeout: 10_000 }).toContain(CHANGED);
  const spoken = await said();
  expect(spoken.split(CHANGED).length - 1, 'the answer is announced once').toBe(1);
  expect(spoken).not.toContain('The waiting design was replaced.');
  expect(spoken).not.toContain('The helper suggested no changes.');

  // Ask 2, one the fake cannot do: Not done, with its exit, and the design is the one it replaced.
  const second = 'Add a page for one person that shows their payments.';
  await ask(page, second);
  const miss = page.getByRole('region').filter({ has: page.locator('q', { hasText: second }) });
  await expect(miss.locator('q', { hasText: second })).toBeVisible({ timeout: 30_000 });
  await expect(lineOf(miss, 'Not done: Add a page for one person that shows their payments')).toHaveCount(1);
  await expect(lineOf(miss, 'Not done:').getByRole('button', { name: /^Do it in Design\. .*Add a page for one person that shows their payments/ })).toBeVisible();
  await expect(miss.getByText('Nothing changed.')).toBeVisible();
  await expect(lineOf(miss, /^Done:/)).toHaveCount(0);

  // P17-04 and P17-19: "You asked for" is the newest ask only, the earlier one sits under "Asked before:", nothing is joined or cut.
  await expect(miss.locator('q', { hasText: second })).toHaveCount(1);
  await expect(miss.getByText('Asked before:')).toBeVisible();
  await expect(miss.getByText('Asked before:').locator('..').locator('q', { hasText: first })).toHaveCount(1);
  await expect(miss.locator('q', { hasText: `${first} ${second}` })).toHaveCount(0);
  await expect(page.getByLabel('Your prompt')).toHaveValue(LOANS_IDEA);
  const text = await miss.innerText();
  expect(text.match(NEVER_SHOWN), 'a word that is never shown, on the judged review').toBeNull();
  expect(ctx.server.outbound()).toEqual([]);
});

test('the email field the first ask made is saved by Use this, and nothing was added behind the ask', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto(`/apps/${appId}/prompt`);
  // The waiting design came back from the server with its asks; it is the one the second ask returned unchanged.
  await expect(paneHeading(page, 'What the helper made')).toBeVisible({ timeout: 30_000 });
  await useThis(page);
  const spec = (await savedApp(page, appId)).spec;
  const people = spec.tables.find((t) => t.id === 'people');
  expect(people.fields.map((f) => f.label)).toEqual(['Name', 'Phone', 'Email address']);
  expect(spec.tables.flatMap((t) => t.fields).some((f) => f.id === 'notes')).toBe(false);
  expect(spec.pages.map((p) => p.title)).toEqual(['Open loans', 'Items', 'People', 'Loan']);
});

test('a saved app: the left pane shows Your first prompt as words and there is exactly one Ask box; asks on it are judged Done or Not done', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  // The first prompt is kept in this browser (per app); each test has a new browser, so the person's own browser is stood in for.
  await page.addInitScript(([id, words]) => window.localStorage.setItem(`app.studio.prompt.${id}`, words), [appId, LOANS_IDEA]);
  await page.goto(`/apps/${appId}/prompt`);
  const review = reviewPane(page, 'Your app');
  await expect(review).toBeVisible();
  // P17-05: one ask box per screen, in the right pane; the left pane holds the first prompt and no box.
  await expect(page.getByText('Your first prompt', { exact: true })).toBeVisible();
  await expect(page.getByText(LOANS_IDEA, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ask for a change')).toHaveCount(1);
  await expect(page.getByLabel('What should change?')).toHaveCount(0);
  await expect(page.getByLabel('Your prompt')).toHaveCount(0);
  await expect(review.getByLabel('Ask for a change')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Start over with a new prompt' })).toBeVisible();

  // An ask the fake does, on the saved app: Done, and the saved app is untouched until Use this.
  await ask(page, 'Add a deposit amount field to Loans.');
  const done = reviewPane(page, 'Your changes');
  await expect(done).toBeVisible({ timeout: 30_000 });
  await expect(lineOf(done, 'Done: Add a deposit amount field to Loans')).toHaveCount(1);
  await expect(done.getByText('Nothing changed.')).toHaveCount(0);
  await expect(done.locator('q', { hasText: 'Add a deposit amount field to Loans.' })).toHaveCount(1);
  await expect(page.getByLabel('Ask for a change')).toHaveCount(1);
  expect((await savedApp(page, appId)).spec.tables.find((t) => t.id === 'loans').fields.some((f) => f.id === 'deposit_amount')).toBe(false);

  // An ask it cannot do, on the saved app: Not done, with the matching exit (a table or field goes to Data), and Nothing changed.
  await ask(page, 'Rename the Loans table to Borrowing.');
  const miss = page.getByRole('region').filter({ has: page.locator('q', { hasText: 'Borrowing' }) });
  await expect(miss.locator('q', { hasText: 'Borrowing' })).toBeVisible({ timeout: 30_000 });
  await expect(lineOf(miss, 'Not done: Rename the Loans table to Borrowing')).toHaveCount(1);
  await expect(lineOf(miss, 'Not done:').getByRole('button', { name: /^Do it on Data\. .*Rename the Loans table to Borrowing/ })).toBeVisible();
  await expect(miss.getByText('Nothing changed.')).toBeVisible();
  await expect(miss.getByText('The helper did not do what you asked. Try other words, or do it yourself.')).toBeVisible();
  expect(ctx.server.outbound()).toEqual([]);
});

test('an ask with two clauses is judged clause by clause, and a change no clause explains goes under It also changed', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  await page.goto(`/apps/${appId}/prompt`);
  // The earlier ask left a waiting change on the server, so the pane may be Your app or Your changes; the Ask box is in both.
  await expect(page.getByLabel('Ask for a change')).toBeVisible({ timeout: 30_000 });
  const words = 'Add a Clients table (name, phone). Remove the Moon page.';
  await ask(page, words);
  const review = page.getByRole('region').filter({ has: page.locator('q', { hasText: 'Clients table' }) });
  await expect(review.locator('q', { hasText: 'Clients table' })).toBeVisible({ timeout: 30_000 });
  await expect(lineOf(review, 'Done: Add a Clients table (name, phone)')).toHaveCount(1);
  await expect(lineOf(review, 'Not done: Remove the Moon page')).toHaveCount(1);
  // One clause was done, so the design did change and it is not "Nothing changed".
  await expect(review.getByText('Nothing changed.')).toHaveCount(0);
  await expect(review.getByText('The helper did not do what you asked. Try other words, or do it yourself.')).toHaveCount(0);
  const text = await review.innerText();
  // Side effects, if the design has any, sit under their own heading and never inside a Done line.
  if (/It also changed/.test(text)) {
    await expect(review.getByRole('list', { name: 'It also changed' }).getByRole('listitem').first()).toBeVisible();
  }
  expect(text.match(NEVER_SHOWN), 'a word that is never shown, on the two clause review').toBeNull();
  expect(ctx.server.outbound()).toEqual([]);
});

test('the freelancer prompt: "Not made:" lists Clients, Jobs, a chart and a menu button, and the app is named Green Acre Landscaping', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  test.setTimeout(90_000);
  const id = await makeWithHelper(page, FREELANCER);
  const review = reviewPane(page, 'What the helper made');
  // The words the prompt named that the design does not hold (the fake gave the crew roster: one table, no chart, no menu button).
  await expect(review.getByText('Not made: Clients, Jobs, a chart, a menu button', { exact: true })).toBeVisible();
  await expect(review.getByRole('list', { name: 'Tables' }).getByRole('listitem').filter({ hasText: /^Crews: / })).toHaveCount(1);
  // P17-17: the person's own capitalised name wins over the first two words ("Job Green").
  expect((await savedApp(page, id)).name).toBe('Green Acre Landscaping');
  // P17-19: the quote is the whole prompt or is cut at a word with "...", never in the middle of a word.
  const quoted = await review.locator('q').first().innerText();
  expect(quoted).toMatch(/^A job tracking app for Green Acre Landscaping\./);
  expect(quoted.endsWith('...') || quoted.endsWith('menu button to add a job.')).toBe(true);
  expect((await review.innerText()).match(NEVER_SHOWN), 'a word that is never shown').toBeNull();
  expect(ctx.server.outbound()).toEqual([]);
});
