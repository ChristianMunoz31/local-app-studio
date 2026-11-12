import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const dir = mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-test-'));
process.env.APP_TEST_DATA_DIR = dir;
process.env.APP_DATA_DIR = dir; // belt and braces for code that calls getDataDir() directly

// Local AI settings from the developer's own shell (an Ollama install often sets OLLAMA_HOST)
// must not leak into tests: every AI test mocks node-fetch and expects the defaults.
for (const name of [
  'APP_AI',
  'OLLAMA_HOST',
  'OLLAMA_NUM_CTX',
  'OLLAMA_KEEP_ALIVE',
  'APP_AI_CHAT_MODEL',
  'APP_AI_TOOL_MODEL',
  'APP_AI_AUTO_MAX_PARAMS_B',
  'APP_AI_FREE_RAM_GB',
  'APP_AI_FIRST_TOKEN_TIMEOUT_MS',
  'APP_AI_TOTAL_TIMEOUT_MIN',
  'APP_AI_CONCURRENCY',
  'APP_AI_QUEUE_MAX',
  'APP_AI_QUEUE_TIMEOUT_MS',
  'APP_AI_HEALTH_TTL_MS',
  'ASSISTANT_CONFIRM_WRITES',
  'AI_CLOUD_API_KEY',
  'APP_CHANNEL',
  'APP_STABLE_DATA_DIR',
  'APP_DISPLAY_VERSION',
]) {
  delete process.env[name];
}
// The automatic tools model follows free memory (D16); tests pin a quiet 16 GB PC so the choice never depends on the machine running them.
process.env.APP_AI_FREE_RAM_GB = '16';

afterAll(async () => {
  try {
    (await import('../../db/index.js')).closeDb();
  } catch {
    /* ignore */
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    /* Windows EBUSY: leak tmp */
  }
});
