// Assistant against the fake Ollama: page advice shows the model reply. The write-confirmation flow is covered by the
// runtime vitest suite (server/__tests__/runtime/assistantRuntime.test.js); Studio's Assistant has only a read tool.
import { test, expect, useApp } from '../support/fixtures.js';
import { PLAIN_REPLY } from '../../scripts/lib/fakeOllamaServer.js';
import { assistant } from '../pages/assistant.js';

const ctx = useApp({ seed: true, ollama: 'fake' });

test('page advice on Settings shows the model reply', async ({ page }) => {
  await page.goto('/settings');
  const j = assistant(page);
  await j.open();
  await expect(j.message(PLAIN_REPLY)).toBeVisible();

  const chats = ctx.server.fake.requests.filter((r) => r.path === '/api/chat');
  expect(chats.length).toBeGreaterThan(0);
});
