// Product rule: AI summarizes, code calculates. Every number a model sees is computed natively
// (SQL/JS) and handed over as a result; no prompt asks the model to do arithmetic, and tool
// results are aggregates rather than lists the model would have to add up.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('../license/index.js', async (importOriginal) => (await import('./helpers/pro.js')).mockLicenseModule(importOriginal));

import fetch from 'node-fetch';
import { advisorSystemPrompt, AUTO_ADVICE_REQUEST } from '../assistant/advisorPrompt.js';
import { ASSISTANT_PERSONALITY, ASSISTANT_VOICE, assistantSystemPrompt } from '../agents/prompts.js';
import { ASSISTANT_TOOLS } from '../agents/assistantTools.js';
import { configureCloud, installFakeCloud, resetCloud } from './helpers/fakeCloud.js';
import { getAiClient, withheldMessage, withheldToolResult } from '../ai/index.js';
import { generateAdvice } from '../assistant/advisorService.js';
import { runAssistant } from '../agents/assistantAgent.js';

// Words that ask a model to do arithmetic.
const MATH_INSTRUCTION = /\b(calculate|compute|add (?:up|together)|sum (?:up|of)|subtract|multiply|divide|tally|work out the|average (?:of|the))\b/i;

// A prompt may forbid the model from computing (e.g. "never add, subtract, count or compare numbers
// yourself"); only affirmative instructions count, so drop prohibitions before matching.
const withoutProhibitions = (text) =>
  text
    .replace(/(?:never|don't|do not)\s+[^.\n]*?\byourself\b/gi, '')
    .replace(/(?:don't|do not|never|not)\s+(?:\w+\s+){0,2}?(?:calculate|compute|add|sum|subtract|multiply|divide|tally|work|average)/gi, '');

describe('prompts never ask the model to do math', () => {
  const prompts = {
    'advisor system prompt': advisorSystemPrompt({ pageLabel: 'Settings', fenceTag: 'page_context_0123456789ab' }),
    'assistant system prompt': assistantSystemPrompt({ now: new Date(0).toISOString() }),
    'persona text': ASSISTANT_PERSONALITY,
    'voice text': ASSISTANT_VOICE,
    'auto advice request': AUTO_ADVICE_REQUEST,
  };

  it.each(Object.entries(prompts))('%s has no arithmetic instruction', (_label, text) => {
    expect(text.length).toBeGreaterThan(10);
    expect(withoutProhibitions(text)).not.toMatch(MATH_INSTRUCTION);
  });

  it('the guard regex does catch an instruction (not vacuous)', () => {
    expect(withoutProhibitions('Please add up the amounts and calculate the total.')).toMatch(MATH_INSTRUCTION);
    expect(withoutProhibitions('Never add, subtract, count or compare numbers yourself.')).not.toMatch(MATH_INSTRUCTION);
  });

  it('the advisor prompt restricts the model to numbers present in the snapshot', () => {
    expect(prompts['advisor system prompt']).toContain('Use only numbers, names and dates present in the snapshot');
  });

  it('the assistant prompt tells the model to quote totals instead of working them out', () => {
    expect(prompts['assistant system prompt']).toMatch(/Never add, subtract, count or compare numbers yourself/);
    expect(prompts['assistant system prompt']).toMatch(/quote the totals, counts and values the tools return/);
  });

  it('the assistant prompt asks the model to name what list_features returns (phase 26 eval)', () => {
    expect(prompts['assistant system prompt']).toMatch(/call list_features first and name each feature it returns/);
  });

});

describe('tool descriptions steer the model to results', () => {
  it('every tool description steers the model to results, not arithmetic', () => {
    for (const t of ASSISTANT_TOOLS) expect(withoutProhibitions(t.function.description)).not.toMatch(MATH_INSTRUCTION);
  });
});

describe('the cloud path keeps the same rule', () => {
  let db;
  beforeAll(() => {
    db = createTestDb();
  });
  beforeEach(async () => {
    resetDb(db);
    fetch.mockReset();
    await configureCloud();
  });
  afterAll(async () => {
    await resetCloud();
    closeTestDb(db);
  });

  const system = (body) => body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

  it.skipIf(PUBLIC_BUILD)('no prompt sent to a cloud provider asks for arithmetic (advice, Assistant) (needs the cloud provider, which is not in a public build)', async () => {
    const cloud = installFakeCloud(fetch, { replies: ['ok'] });
    const client = await getAiClient({ purpose: 'chat' });
    expect(client.isCloud).toBe(true);
    await generateAdvice({ page: 'settings', pageLabel: 'Settings', context: '{"total":25}', messages: [{ role: 'user', content: 'how is it?' }] }, { client });
    await runAssistant({ prompt: 'what do I have?', client: await getAiClient({ purpose: 'tools' }) });
    expect(cloud.requests.length).toBeGreaterThanOrEqual(2);
    for (const r of cloud.requests) {
      const sys = system(r.body);
      expect(sys.length).toBeGreaterThan(10);
      expect(withoutProhibitions(sys)).not.toMatch(MATH_INSTRUCTION);
    }
  });

  it('the withheld copy asks for no arithmetic and tells the model not to guess', () => {
    const texts = [withheldMessage(['features']), withheldToolResult('features').message, withheldToolResult(null).message];
    for (const t of texts) expect(withoutProhibitions(t)).not.toMatch(MATH_INSTRUCTION);
    expect(withheldToolResult('features').message).toMatch(/Do not guess/);
  });
});
