// The helper path end to end with the sandbox's canned answers (DESIGN-phase15.md 10): a loans prompt picks the
// three-table design (items, people and loans linked by two references and two dates), Make my app shows the review beside
// the box on Prompt with all three tables and no fallback notice, Use this opens Design, and the Data step lists Items, People and Loans.
// Nothing leaves this computer. Studio API calls (estimate): about 40 (page loads and their status polls, one create,
// the two table and outline calls plus one per page, the spec reads), well under the 300 per 15 minutes the server allows.
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { visibleNotice } from '../pages/design.js';
import { skipWithoutPro } from '../support/proBuild.js';
import { openStartBox } from '../pages/apps.js';

useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });

test.describe.configure({ mode: 'serial' });

const PROMPT =
  'An app to track equipment loans for my tool rental shop. I have items (name, serial number, condition), people (name, phone), and loans: which person borrowed which item, the date out, and the due date. I want to see which loans are overdue.';

test('a loans prompt gets the three-table design with no fallback, Use this keeps it, and Data lists the three tables', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the helper is not in a public build');
  await page.goto('/apps');
  await openStartBox(page);
  await page.getByLabel('Your prompt').fill(PROMPT);
  await page.getByRole('button', { name: 'Make my app' }).click();

  await expect(page).toHaveURL(/\/apps\/[^/]+\/prompt$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'What the helper made' })).toBeVisible({ timeout: 30_000 });
  for (const table of ['Items:', 'People:', 'Loans:']) await expect(page.getByText(table).first()).toBeVisible();
  await expect(visibleNotice(page, 'Could not generate this part')).toHaveCount(0);

  await page.getByRole('button', { name: 'Use this', exact: true }).click();
  await expect(page).toHaveURL(/\/design$/);
  await expect(visibleNotice(page, 'Could not generate this part')).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: /Data/ }).click();
  await expect(page).toHaveURL(/\/data$/);
  const tables = page.getByRole('navigation', { name: 'Tables' });
  await expect(tables.getByRole('button', { name: /Items/ })).toContainText('3 fields');
  await expect(tables.getByRole('button', { name: /People/ })).toContainText('2 fields');
  await expect(tables.getByRole('button', { name: /Loans/ })).toContainText('6 fields');
});
