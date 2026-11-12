// The built UI renders GFM markdown: the web build stubs the to-markdown half of mdast-util-gfm and two zod
// JSON-schema modules (scripts/lib/webStubs/), and vitest uses the real modules, so only this spec against dist/
// proves rendering is unchanged. Surface: the Assistant's page advice, fed fixed text by the fake Ollama's chat hook.
import { test, expect, useApp } from '../support/fixtures.js';
import { assistant } from '../pages/assistant.js';

const REPLY = [
  'Here is a summary.',
  '',
  '| Item | Count |',
  '| --- | --- |',
  '| Apples | 3 |',
  '| Pears | 5 |',
  '',
  'This is ~~old~~ news. See https://example.com/docs for more.',
  '',
  '- [x] Done task',
  '- [ ] Open task',
].join('\n');

useApp({ seed: true, ollama: 'fake', fakeChat: () => REPLY });

test('GFM table, strikethrough, autolink and task list render in the built UI', async ({ page }) => {
  await page.goto('/settings');
  const j = assistant(page);
  await j.open();

  const table = j.panel.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(['Item', 'Count']);
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('cell', { name: 'Pears' })).toBeVisible();

  await expect(j.panel.locator('del')).toHaveText('old');

  // An autolink is still parsed (the gfm half the web build keeps), but no model-written link is clickable
  // (AssistantMessage.jsx SafeLink, OQ-26-2): the words show, then the real host in brackets.
  await expect(j.panel.getByText('https://example.com/docs (example.com)')).toBeVisible();
  await expect(j.panel.getByRole('link')).toHaveCount(0);

  const boxes = j.panel.locator('input[type="checkbox"]');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
});
