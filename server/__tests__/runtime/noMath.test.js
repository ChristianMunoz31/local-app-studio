// Product rule in a built app: AI summarizes, code calculates. The runtime Assistant prompt and tool descriptions never ask
// a model for arithmetic, every figure the model receives is computed in code (list totals, get_stats), and the
// model is told to quote them. Mirrors aiNoMath.test.js for the kit.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = `${process.cwd()}/packages/runtime/src/spec/fixtures/crew-roster.json`;
});

import request from 'supertest';

vi.mock('../../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { installFakeOllama, textReply, toolReply } from '../helpers/fakeOllama.js';
import { __resetAiForTests } from '../../ai/index.js';
import { __resetPendingActionsForTests } from '../../agents/pendingActions.js';
import { ASSISTANT_PERSONALITY, ASSISTANT_VOICE, assistantSystemPrompt } from '../../agents/prompts.js';
import { ASSISTANT_TOOLS, INTERNAL_TOOLS } from '../../agents/assistantTools.js';
import { computeStats } from '@local-app-studio/runtime/server/stats.js';
import { getCompiledSpec } from '../../spec/source.js';
import { closeTestDb, createTestDb, resetDb, seedDb } from '../helpers/testDb.js';

// Words that ask a model to do arithmetic.
const MATH_INSTRUCTION = /\b(calculate|compute|add (?:up|together)|sum (?:up|of)|subtract|multiply|divide|tally|work out the|average (?:of|the))\b/i;
// Prohibitions ("never add, subtract, count or compare numbers yourself") are not instructions.
const withoutProhibitions = (text) =>
  text
    .replace(/(?:never|don't|do not)\s+[^.\n]*?\byourself\b/gi, '')
    .replace(/(?:don't|do not|never|not)\s+(?:\w+\s+){0,2}?(?:calculate|compute|add|sum|subtract|multiply|divide|tally|work|average)/gi, '');

let app;
let db;
let ip = 0;
const nextIp = () => `192.0.2.${(ip += 1) % 250}`;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
});
beforeEach(() => {
  resetDb(db);
  __resetAiForTests();
  __resetPendingActionsForTests();
  fetch.mockReset();
});

describe('the runtime prompts never ask the model to do math', () => {
  const prompts = {
    'runtime assistant system prompt': assistantSystemPrompt({ now: new Date(0).toISOString(), displayName: 'Sam' }),
    'persona text': ASSISTANT_PERSONALITY,
    'voice text': ASSISTANT_VOICE,
    ...Object.fromEntries([...ASSISTANT_TOOLS, ...INTERNAL_TOOLS].map((t) => [`tool ${t.function.name}`, t.function.description])),
  };

  it.each(Object.entries(prompts))('%s has no arithmetic instruction', (_label, text) => {
    expect(text.length).toBeGreaterThan(10);
    expect(withoutProhibitions(text)).not.toMatch(MATH_INSTRUCTION);
  });

  it('the guard regex does catch an instruction (not vacuous)', () => {
    expect(withoutProhibitions('Please add up the sizes and calculate the total.')).toMatch(MATH_INSTRUCTION);
    expect(withoutProhibitions('Never add, subtract, count or compare numbers yourself.')).not.toMatch(MATH_INSTRUCTION);
  });

  it('the prompt sends every number to a tool result and tells the model to quote it', () => {
    const text = prompts['runtime assistant system prompt'];
    expect(text).toMatch(/Every number comes from a tool result/);
    expect(text).toMatch(/total returned by list_records/);
    expect(text).toMatch(/figures returned by get_stats/);
    expect(text).toMatch(/Never add, subtract, count or compare numbers yourself/);
    expect(text).toMatch(/quote the totals, counts and values the tools return/);
  });
});

describe('the figures the model receives are computed by code', () => {
  const ask = (prompt) =>
    request(app)
      .post('/api/assistant')
      .set('X-Forwarded-For', nextIp())
      .send({ prompt })
      .buffer(true)
      .parse((res, cb) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => cb(null, d));
      });

  it('get_stats results reach the model as code-computed numbers, and nothing in the request asks for a calculation', async () => {
    seedDb(db, {
      crews: [
        { name: 'Alpha', size: 4, status: 'active' },
        { name: 'Bravo', size: 6, status: 'paused' },
        { name: 'Charlie', size: 3, status: 'active' },
      ],
    });
    const expected = computeStats(getCompiledSpec(), 'crews');
    expect(expected.fields.size).toEqual({ count: 3, sum: 13, avg: 13 / 3, min: 3, max: 6 });
    const fake = installFakeOllama(fetch, { replies: [toolReply([{ name: 'get_stats', arguments: { table: 'crews' } }]), textReply('There are 13 crew members across 3 crews.')] });
    const res = await ask('how many people are in all my crews?');
    expect(res.status).toBe(200);

    expect(fake.chatBodies).toHaveLength(2);
    const toolMessage = fake.chatBodies[1].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content)).toEqual({ ...expected, filter: null, scope: 'All records.' });
    for (const body of fake.chatBodies) {
      const system = body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      expect(withoutProhibitions(system)).not.toMatch(MATH_INSTRUCTION);
      expect(withoutProhibitions(JSON.stringify(body.tools))).not.toMatch(MATH_INSTRUCTION);
    }
  });

  it('list_records returns the matching total from the database, not a list to be counted', async () => {
    seedDb(db, { crews: Array.from({ length: 30 }, (_v, i) => ({ name: `Crew ${i}`, size: 1 })) });
    const fake = installFakeOllama(fetch, { replies: [toolReply([{ name: 'list_records', arguments: { table: 'crews', limit: 5 } }]), textReply('30 crews.')] });
    await ask('how many crews do I have?');
    const result = JSON.parse(fake.chatBodies[1].messages.find((m) => m.role === 'tool').content);
    expect(result.total).toBe(30);
    expect(result.rows).toHaveLength(5);
  });
});
