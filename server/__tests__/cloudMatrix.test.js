// Exhaustive category enforcement matrix for the cloud AI safeguards: EVERY Assistant page id and
// EVERY tool in ASSISTANT_TOOLS (studio mode: list_features), against cloud (category off, category on) and local
// Ollama. A data sentinel must be absent from every request body sent to the fake cloud when its category is
// off, present when it is on, and always present locally. Fake providers only (api.example.com,
// sk-test-fake); the network guard blocks anything real.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { textReply, toolReply } from './helpers/fakeOllama.js';
import { configureCloud, installCloudAndOllama, resetCloud } from './helpers/fakeCloud.js';
import { SEED_FEATURES } from '../../src/catalog/features/index.ts';
import { createFeature } from '../studio/features/store.js';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';
import { __resetPendingActionsForTests } from '../agents/pendingActions.js';
import { ASSISTANT_TOOLS } from '../agents/assistantTools.js';
import { ASSISTANT_PAGE_LABELS } from '../assistant/pages.js';
import { CLOUD_CATEGORY_DEFAULTS, CLOUD_CATEGORY_IDS, PAGE_CATEGORIES, TOOL_CATEGORIES } from '../ai/privacy.js';

let app;
let db;
let ip = 0;
const nextIp = () => `198.51.100.${(ip += 1) % 250}`;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'ASSISTANT_CONFIRM_WRITES', 'APP_AI'].map((k) => [k, process.env[k]]));

beforeAll(async () => {
  for (const k of Object.keys(saved)) delete process.env[k];
  db = createTestDb();
  app = (await import('../../server.js')).default;
});
afterAll(async () => {
  await resetCloud();
  closeTestDb(db);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  resetDb(db);
  fetch.mockReset();
  __resetPendingActionsForTests();
  await resetCloud();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const S = (cat) => `SENTINEL_MX_${cat.toUpperCase()}_k3p9`;

// One saved feature whose description carries the `features` sentinel.
const seedAll = () => {
  const def = structuredClone(SEED_FEATURES.find((f) => f.id === 'kpi_row'));
  delete def.version;
  delete def.updatedAt;
  createFeature({ ...def, description: S('features') });
};

const frames = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });

const ask = async (prompt) => {
  const res = await request(app)
    .post('/api/assistant')
    .set('X-Forwarded-For', nextIp())
    .send({ prompt })
    .buffer(true)
    .parse((r, cb) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => cb(null, d));
    });
  return frames(res.body);
};
const advise = (body) => request(app).post('/api/assistant/advice').set('X-Forwarded-For', nextIp()).send(body);

describe('page advice: every page id, cloud off / cloud on / local', () => {
  const pages = Object.keys(ASSISTANT_PAGE_LABELS);

  it('covers exactly the pages the policy maps', () => {
    expect(pages.sort()).toEqual(Object.keys(PAGE_CATEGORIES).sort());
  });

  // Studio pages carry no private data today. A page with a category would be tested per category here.
  const single = pages.filter((p) => PAGE_CATEGORIES[p]);
  const open = pages.filter((p) => PAGE_CATEGORIES[p] === null);

  it('every studio page is open (no category)', () => {
    expect(single).toEqual([]);
    expect(open.length).toBeGreaterThan(0);
  });

  describe.each(open)('page %s (no category)', (page) => {
    it.skipIf(PUBLIC_BUILD)('is always shared, even with every category off (needs the cloud provider, which is not in a public build)', async () => {
      await configureCloud({ categories: Object.fromEntries(CLOUD_CATEGORY_IDS.map((c) => [c, false])) });
      const { cloud } = installCloudAndOllama(fetch, { replies: ['- ok'] });
      const res = await advise({ page, context: JSON.stringify({ t: S(page) }), messages: [{ role: 'user', content: 'hi' }] });
      expect(res.body.data).toMatchObject({ blocked: false, withheld: [] });
      expect(cloud.sent()).toContain(S(page));
    });

    it('local: always sent', async () => {
      await configureCloud({ categories: Object.fromEntries(CLOUD_CATEGORY_IDS.map((c) => [c, false])), consent: false });
      const side = installCloudAndOllama(fetch, { ollama: { replies: [textReply('- fine')] } });
      const res = await advise({ page, context: JSON.stringify({ t: S(page) }), messages: [{ role: 'user', content: 'hi' }] });
      expect(res.body.data).toMatchObject({ blocked: false, ai: { kind: 'local', host: null } });
      expect(JSON.stringify(side.local.chatBodies)).toContain(S(page));
      expect(side.cloud.requests).toHaveLength(0);
    });
  });
});

describe('Assistant tools: every tool in ASSISTANT_TOOLS, cloud off / cloud on / local', () => {
  const names = ASSISTANT_TOOLS.map((t) => t.function.name);

  // Arguments chosen so that, where the category is on, the tool finds its seeded sentinel row.
  const ARGS = { list_features: {} };
  // Where the sentinel of a category shows up in a READ tool's result.
  const READ_SENTINEL = { list_features: ['features'] };

  it('the table covers every tool', () => {
    expect(Object.keys(ARGS).sort()).toEqual([...names].sort());
    expect(Object.keys(TOOL_CATEGORIES).sort()).toEqual([...names].sort());
  });

  describe.each(names)('%s', (name) => {
    const cats = [].concat(TOOL_CATEGORIES[name]);
    const call = [{ name, arguments: ARGS[name] }];

    (PUBLIC_BUILD ? it.skip : it).each(cats)('cloud, %s off: refused with the placeholder, nothing runs or is sent (needs the cloud provider, which is not in a public build)', async (c) => {
      seedAll();
      await configureCloud({ categories: Object.fromEntries(cats.map((x) => [x, x !== c])) });
      const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: call }, 'I cannot see that.'] });
      const ev = await ask('please use the tool');
      const done = ev.find((e) => e.event === 'tool.done').data.result;
      expect(done).toMatchObject({ not_shared: true, category: c });
      expect(ev.find((e) => e.event === 'notice').data.categories).toEqual([c]);
      for (const id of CLOUD_CATEGORY_IDS) expect(cloud.sent()).not.toContain(S(id));
    });

    it.skipIf(PUBLIC_BUILD)(`cloud, ${cats.join(' and ')} on: the tool runs and its data goes to the provider (needs the cloud provider, which is not in a public build)`, async () => {
      seedAll();
      await configureCloud({ categories: Object.fromEntries(cats.map((x) => [x, true])) });
      const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: call }, 'Done.'] });
      const ev = await ask('please use the tool');
      const done = ev.find((e) => e.event === 'tool.done')?.data.result;
      expect(done?.not_shared).toBeUndefined();
      expect(ev.filter((e) => e.event === 'notice')).toHaveLength(0);
      for (const id of READ_SENTINEL[name] ?? []) expect(cloud.sent()).toContain(S(id));
    });

    it('local: runs and reaches the model whatever the saved cloud categories say', async () => {
      seedAll();
      await configureCloud({ categories: Object.fromEntries(cats.map((x) => [x, false])), consent: false });
      const side = installCloudAndOllama(fetch, { ollama: { replies: [toolReply(call), textReply('Done.')] } });
      const ev = await ask('please use the tool');
      const done = ev.find((e) => e.event === 'tool.done')?.data.result;
      expect(done?.not_shared).toBeUndefined();
      expect(ev.filter((e) => e.event === 'notice')).toHaveLength(0);
      for (const id of READ_SENTINEL[name] ?? []) expect(JSON.stringify(side.local.chatBodies)).toContain(S(id));
      expect(side.cloud.requests).toHaveLength(0);
    });
  });

  it('every category has a documented default, and all are on', () => {
    expect(CLOUD_CATEGORY_IDS).toEqual(['features']);
    expect(CLOUD_CATEGORY_IDS.filter((c) => !CLOUD_CATEGORY_DEFAULTS[c])).toEqual([]);
  });
});
