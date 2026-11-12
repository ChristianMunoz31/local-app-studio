// Phase 14 proof flow, the Build step in plain words (DESIGN-phase14.md P-44).
// The switch reads "Allow downloads for builds", the blocked line points at it by name, and the hosts and the tool list fold under Details.
// Studio API calls (estimate): about 20, well under the 300 per 15 minutes. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { makeApp } from '../support/critiqueApps.js';
import { skipWithoutPro } from '../support/proBuild.js';

const ctx = useApp({ seed: true, ollama: 'dead' });

test('P-44: Build shows "Allow downloads for builds", the blocked line names it, and the details fold', { tag: '@pro' }, async ({ page }) => {
  skipWithoutPro(test, 'the installer is not in a public build');
  const app = await makeApp(page.request, 'Build Words', (spec) => {
    spec.pages[0].layout.children.push({ id: 'text_b', type: 'Text', props: {}, children: 'Hello' });
  });
  await page.goto(`/apps/${app.id}/build`);
  const sw = page.getByRole('switch', { name: 'Allow downloads for builds' });
  await expect(sw).toBeVisible();
  await expect(sw).not.toBeChecked();

  // The line that says what stops the installer points at the switch by its name.
  await expect(page.getByText(/^Before you can make an installer: .*turn on "Allow downloads for builds"/)).toBeVisible({ timeout: 30_000 });

  // The hosts it contacts are folded under Details until asked for.
  const hosts = page.getByText(/^It contacts: /);
  await expect(hosts).toBeHidden();
  const summary = page.locator('details').filter({ has: hosts }).locator('summary');
  await expect(summary).toHaveText('Details about the sites a build contacts');
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(hosts).toBeVisible();

  // The tool table is folded too: "Details about the build tools" when tools are missing, "Show tools" when all are found. Either way the rows are hidden at first.
  const folded = page.locator('details').filter({ has: page.locator('summary', { hasText: /^(Details about the build tools|Show tools)$/ }) });
  expect(await folded.count()).toBeGreaterThanOrEqual(1);
  await expect(page.getByText(/Required for builds/).first()).toBeHidden();
  const toolsFold = page.locator('details').filter({ hasText: /Required for builds/ }).first();
  await toolsFold.locator('summary').first().click();
  await expect(page.getByText(/Required for builds/).first()).toBeVisible();
  // The install hints are words, not a command line to decode.
  const missing = await page.getByText(/^How to install: /).allInnerTexts();
  for (const hint of missing) expect(hint.length).toBeGreaterThan('How to install: '.length);
  expect(ctx.server.outbound()).toEqual([]);
});
