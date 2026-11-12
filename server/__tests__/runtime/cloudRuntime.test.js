// Cloud AI in a built app (runtime mode, Crew Roster fixture): one cloud category per spec table, enforced by canonical
// tool name. Crews shared, people withheld: the people tool answers with the not-shared placeholder and never runs, its
// data and its turn never reach the provider, and a write to a withheld table is neither run nor parked.
// Fake provider behind a mocked node-fetch; nothing real is contacted.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from '../helpers/proBuild.js';

vi.hoisted(() => {
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = `${process.cwd()}/packages/runtime/src/spec/fixtures/crew-roster.json`;
});

vi.mock('../../license/index.js', async (importOriginal) => (await import('../helpers/pro.js')).mockLicenseModule(importOriginal));
import request from 'supertest';

vi.mock('../../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { textReply, toolReply } from '../helpers/fakeOllama.js';
import { CLOUD_HOST, configureCloud, installCloudAndOllama, resetCloud } from '../helpers/fakeCloud.js';
import { closeTestDb, createTestDb, resetDb, rowsOf, seedDb } from '../helpers/testDb.js';
import { __resetPendingActionsForTests } from '../../agents/pendingActions.js';
import { CLOUD_CATEGORY_IDS, CLOUD_CATEGORY_DEFAULTS, TOOL_CATEGORIES, createAiPolicy, withheldMessage, withheldToolResult } from '../../ai/privacy.js';
import { appendMessage, createConversation } from '../../dataAccess.js';
import { executeTool } from '../../agents/assistantTools.js';

const PEOPLE_SENTINEL = 'SENTINEL_PEOPLE_zq91';
const CREWS_SENTINEL = 'SENTINEL_CREWS_zq92';

let app;
let db;
let ip = 0;
const nextIp = () => `203.0.113.${(ip += 1) % 250}`;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'ASSISTANT_CONFIRM_WRITES', 'APP_AI'].map((k) => [k, process.env[k]]));

beforeAll(async () => {
  for (const k of Object.keys(saved)) delete process.env[k];
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(async () => {
  await resetCloud();
  closeTestDb(db);
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
});
beforeEach(async () => {
  resetDb(db);
  fetch.mockReset();
  __resetPendingActionsForTests();
  await resetCloud();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const events = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });

const ask = async (prompt, extra = {}) => {
  const res = await request(app)
    .post('/api/assistant')
    .set('X-Forwarded-For', nextIp())
    .send({ prompt, ...extra })
    .buffer(true)
    .parse((r, cb) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => cb(null, d));
    });
  return { res, ev: events(res.body) };
};

const seed = () =>
  seedDb(db, {
    people: [{ name: PEOPLE_SENTINEL }],
    crews: [{ name: CREWS_SENTINEL, size: 3 }],
  });

describe('categories of a built app', () => {
  it('has one cloud category per spec table, off by default, and one tool category per canonical name', () => {
    expect(CLOUD_CATEGORY_IDS).toEqual(expect.arrayContaining(['people', 'crews']));
    expect(CLOUD_CATEGORY_DEFAULTS).toMatchObject({ people: false, crews: false });
    expect(TOOL_CATEGORIES).toMatchObject({
      describe_data: null,
      list_records__people: 'people',
      list_records__crews: ['crews', 'people'],
      get_stats__crews: ['crews', 'people'],
      save_record__crews: ['crews', 'people'],
      save_record__people: 'people',
      list_records: ['people', 'crews'],
    });
  });
});

describe('a table tool also needs the tables its links point at (RV26-12) and describe_data hides withheld counts (RV26-17)', () => {
  const policy = (categories) => createAiPolicy({ isCloud: true, categories });
  const linkedId = () => rowsOf(db, 'people')[0].id;

  it('crews shared and people withheld: list_records, get_stats and save_record of crews are refused naming people; both shared: allowed', async () => {
    seed();
    const only = { policy: policy({ crews: true, people: false }) };
    const refused = withheldToolResult(['people']);
    expect(await executeTool('list_records__crews', {}, only)).toEqual(refused);
    expect(await executeTool('list_records__crews', { match: { lead_id: PEOPLE_SENTINEL } }, only)).toEqual(refused);
    expect(await executeTool('get_stats__crews', {}, only)).toEqual(refused);
    expect(await executeTool('save_record__crews', { values: { name: 'Echo', lead_id: PEOPLE_SENTINEL } }, only)).toEqual(refused);
    expect(rowsOf(db, 'crews')).toHaveLength(1);
    const both = { policy: policy({ crews: true, people: true }) };
    expect((await executeTool('list_records__crews', {}, both)).total).toBe(1);
    expect((await executeTool('get_stats__crews', {}, both)).count).toBe(1);
    expect((await executeTool('save_record__crews', { values: { name: 'Echo', lead_id: linkedId() } }, both)).created).toBe(true);
    expect(rowsOf(db, 'crews')).toHaveLength(2);
  });

  it('people (no links) stays under its own category alone, and local runs everything', async () => {
    seed();
    expect((await executeTool('list_records__people', {}, { policy: policy({ people: true }) })).total).toBe(1);
    expect((await executeTool('list_records__crews', {}, { policy: createAiPolicy({ isCloud: false }) })).total).toBe(1);
  });

  it('describe_data under cloud leaves out the count of a withheld table; local and shared keep it', async () => {
    seed();
    const cloud = await executeTool('describe_data', {}, { policy: policy({ crews: true, people: false }) });
    expect(Object.hasOwn(cloud.tables[0], 'count')).toBe(false);
    expect(cloud.tables[1].count).toBe(1);
    const local = await executeTool('describe_data', {});
    expect(local.tables.map((t) => t.count)).toEqual([1, 1]);
    const all = await executeTool('describe_data', {}, { policy: policy({ crews: true, people: true }) });
    expect(all.tables.map((t) => t.count)).toEqual([1, 1]);
  });
});

describe('a withheld table never runs and never reaches the provider', () => {
  it.skipIf(PUBLIC_BUILD)('list_records on people answers with the placeholder, one notice, and no people data is sent (needs the cloud provider, which is not in a public build)', async () => {
    seed();
    await configureCloud({ categories: { crews: true } });
    const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'list_records', arguments: { table: 'people' } }] }, 'I cannot see that.'] });
    const { res, ev } = await ask('who is on the roster?');
    expect(res.status).toBe(200);
    const start = ev.find((e) => e.event === 'tool.start').data;
    expect(start.name).toBe('list_records__people');
    expect(ev.find((e) => e.event === 'tool.done').data.result).toEqual(withheldToolResult('people'));
    const notices = ev.filter((e) => e.event === 'notice');
    expect(notices).toHaveLength(1);
    expect(notices[0].data).toMatchObject({ code: 'cloud_withheld', categories: ['people'], message: withheldMessage(['people']) });
    expect(cloud.sent()).not.toContain(PEOPLE_SENTINEL);
    expect(cloud.sent()).not.toContain(CREWS_SENTINEL);
    expect(cloud.requests.every((r) => r.url === `https://${CLOUD_HOST}/v1/chat/completions`)).toBe(true);
  });

  it.skipIf(PUBLIC_BUILD)('list_records on crews runs and its data goes to the provider, the people stay out of it (needs the cloud provider, which is not in a public build)', async () => {
    seed();
    await configureCloud({ categories: { crews: true, people: true } });
    const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'list_records', arguments: { table: 'crews' } }] }, 'One crew.'] });
    const { ev } = await ask('which crews?');
    expect(ev.find((e) => e.event === 'tool.done').data.result.rows).toHaveLength(1);
    expect(ev.filter((e) => e.event === 'notice')).toHaveLength(0);
    expect(cloud.sent()).toContain(CREWS_SENTINEL);
    expect(cloud.sent()).not.toContain(PEOPLE_SENTINEL);
  });

  it.skipIf(PUBLIC_BUILD)('get_stats follows the same per-table rule, and describe_data (no category) always runs (needs the cloud provider, which is not in a public build)', async () => {
    seed();
    await configureCloud({ categories: { people: true } });
    const stats = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'get_stats', arguments: { table: 'crews' } }] }, 'ok'] });
    const a = await ask('crew totals?');
    expect(a.ev.find((e) => e.event === 'tool.done').data.result).toEqual(withheldToolResult('crews'));
    expect(stats.cloud.sent()).not.toContain('"sum"');
    fetch.mockReset();
    const d = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'describe_data' }] }, 'ok'] });
    const b = await ask('what do you track?');
    expect(b.ev.find((e) => e.event === 'tool.done').data.result.tables).toHaveLength(2);
    expect(b.ev.filter((e) => e.event === 'notice')).toHaveLength(0);
    expect(d.cloud.sent()).not.toContain(PEOPLE_SENTINEL);
  });

  it.skipIf(PUBLIC_BUILD)('a write to a withheld table is neither run nor parked; a write to a shared table is parked (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud({ categories: { crews: true } });
    installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'save_record', arguments: { table: 'people', values: { name: 'Zed' } } }] }, 'Cannot.'] });
    const denied = await ask('add Zed');
    expect(denied.ev.filter((e) => e.event === 'confirm.required')).toHaveLength(0);
    expect(denied.ev.find((e) => e.event === 'tool.done').data.result).toEqual(withheldToolResult('people'));
    expect(denied.ev.at(-1).data).toMatchObject({ pending: 0, writes: 0 });
    expect(rowsOf(db, 'people')).toHaveLength(0);

    fetch.mockReset();
    await configureCloud({ categories: { crews: true, people: true } });
    installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'save_record', arguments: { table: 'crews', values: { name: 'Echo' } } }] }] });
    const parked = await ask('add crew Echo');
    expect(parked.ev.find((e) => e.event === 'confirm.required').data.summary).toBe('Add to Crews: "Echo"');
    expect(rowsOf(db, 'crews')).toHaveLength(0);
  });

  it('local Ollama (cloud not consented) reads every table', async () => {
    seed();
    await configureCloud({ consent: false });
    const side = installCloudAndOllama(fetch, {
      ollama: { replies: [toolReply([{ name: 'list_records', arguments: { table: 'people' } }]), textReply('ok')] },
    });
    const { ev } = await ask('people?');
    expect(ev.find((e) => e.event === 'tool.done').data.result.total).toBe(1);
    expect(side.local.chatBodies.length).toBeGreaterThan(0);
  });
});

describe.skipIf(PUBLIC_BUILD)('history (needs the cloud provider, which is not in a public build)', () => {
  it('a turn that used a withheld table locally is dropped before the cloud sees the conversation; a shared one keeps its question', async () => {
    seed();
    const conv = await createConversation({ title: 'earlier' });
    await appendMessage(conv.id, { role: 'user', content: 'who is on the roster?' });
    await appendMessage(conv.id, { role: 'assistant', content: '', toolCalls: [{ id: 'h1', type: 'function', function: { name: 'list_records__people', arguments: '{}' } }] });
    await appendMessage(conv.id, { role: 'tool', content: JSON.stringify({ table: 'people', total: 1, rows: [{ name: PEOPLE_SENTINEL }] }), toolCallId: 'h1' });
    await appendMessage(conv.id, { role: 'assistant', content: `Roster: ${PEOPLE_SENTINEL}` });
    await configureCloud({ categories: { crews: true } });
    const first = installCloudAndOllama(fetch, { replies: ['Sure.'] });
    await ask('how many crews are there?', { conversationId: conv.id });
    expect(first.cloud.sent()).not.toContain(PEOPLE_SENTINEL);
    expect(first.cloud.sent()).not.toContain('who is on the roster?');
    expect(first.cloud.sent()).toContain('how many crews are there?');

    const conv2 = await createConversation({ title: 'shared' });
    await appendMessage(conv2.id, { role: 'user', content: 'list the crews please' });
    await appendMessage(conv2.id, { role: 'assistant', content: '', toolCalls: [{ id: 'h2', type: 'function', function: { name: 'list_records__crews', arguments: '{}' } }] });
    await appendMessage(conv2.id, { role: 'tool', content: JSON.stringify({ table: 'crews', total: 1, rows: [{ name: CREWS_SENTINEL }] }), toolCallId: 'h2' });
    await appendMessage(conv2.id, { role: 'assistant', content: `Crews: ${CREWS_SENTINEL}` });
    fetch.mockReset();
    await configureCloud({ categories: { crews: true, people: true } });
    const second = installCloudAndOllama(fetch, { replies: ['Sure.'] });
    await ask('and now?', { conversationId: conv2.id });
    expect(second.cloud.sent()).toContain('list the crews please');
    expect(second.cloud.sent()).not.toContain(CREWS_SENTINEL);
  });
});
