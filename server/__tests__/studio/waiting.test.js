// P17-01, P17-04, P17-16 and the fix round (stale design, versions, cancelled runs, read caps): the helper's waiting design is kept with the app on the server.
import crypto from 'node:crypto';
import http from 'node:http';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('../../studio/describe/pipeline.js', async (importOriginal) => ({ ...(await importOriginal()), runDescribe: vi.fn() }));

import fetch from 'node-fetch';
import { __resetAiForTests } from '../../ai/index.js';
import { buildExportZip } from '../../export/buildArchive.js';
import { importZipBuffer } from '../../import/importExport.js';
import { runDescribe } from '../../studio/describe/pipeline.js';
import { StudioError, createApp, deleteApp, duplicateApp, listApps, saveSpec } from '../../studio/apps.js';
import { clearWaiting, getWaiting, startRun, storeProposal, waitingKey } from '../../studio/waiting.js';
import { installFakeOllama } from '../helpers/fakeOllama.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { PUBLIC_BUILD } from '../helpers/proBuild.js';

let app;
let db;
let n = 0;
const nextIp = () => `198.51.100.${(n += 1) % 250}`;
const sseParse = (res, cb) => {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', (d) => {
    text += d;
  });
  res.on('end', () => cb(null, text));
};
const events = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return [e.slice(7), JSON.parse(d.slice(6))];
    });
const post = (id, body) => request(app).post(`/api/studio/apps/${id}/describe`).set('X-Forwarded-For', nextIp()).buffer(true).parse(sseParse).send(body);
const req = (method, url) => request(app)[method](url).set('X-Forwarded-For', nextIp());
const withTable = (spec, id, label) => {
  const next = structuredClone(spec);
  next.tables.push({ id, label, titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] });
  return next;
};
const answer = (proposal) => ({ proposal, fallbacks: [], steps: [] });
// Seeds a waiting design straight through server/studio/waiting.js (open code), the way the helper's run leaves it, so the tests that
// read, list or export an entry run in a public build too (the route tests above need the helper, which is pro).
const seedWaiting = (a, proposal) => {
  startRun(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1, refine: false });
  return storeProposal(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1, proposal, fallbacks: [], refine: false, savedSpec: a.spec });
};
const waitingKeys = () => rowsOf(db, 'app_state').map((r) => r.key).filter((k) => k.startsWith('studio.waiting.'));

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  delete process.env.APP_AI;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => closeTestDb(db));
beforeEach(() => {
  resetDb(db);
  __resetAiForTests();
  fetch.mockReset();
  runDescribe.mockReset();
  installFakeOllama(fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.skipIf(PUBLIC_BUILD)('keeping the run with the app (a waiting design comes from the helper, which is not in a public build)', () => {
  it('stores the words at the start and the checked proposal when the helper answers, and serves them', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockImplementation(async () => {
      // the words are already kept while the helper works
      expect(getWaiting(a.id)).toMatchObject({ mode: 'create', instruction: 'A roster of crews', proposal: null });
      return answer(withTable(a.spec, 'crews', 'Crews'));
    });
    const list = events((await post(a.id, { mode: 'create', instruction: 'A roster of crews', baseRevision: 1 })).body);
    const sent = list.find(([e]) => e === 'proposal')[1];
    const res = await req('get', `/api/studio/apps/${a.id}/waiting`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ mode: 'create', instruction: 'A roster of crews', asks: [], replaced: null, baseRevision: 1 });
    expect(res.body.data.proposal).toEqual(sent.proposal);
    expect(listApps()[0].waiting).toEqual({ tableCount: 1, pageCount: 1 });
  });

  it('keeps only the words for an unreadable stored design', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue(answer(withTable(a.spec, 'crews', 'Crews')));
    await post(a.id, { mode: 'create', instruction: 'Crews please', baseRevision: 1 });
    const row = rowsOf(db, 'app_state').find((r) => r.key === waitingKey(a.id));
    db.prepare('UPDATE app_state SET value = ? WHERE key = ?').run(JSON.stringify({ ...row.value, proposal: { specVersion: 99 } }), row.key);
    const res = await req('get', `/api/studio/apps/${a.id}/waiting`);
    expect(res.body.data).toMatchObject({ instruction: 'Crews please', proposal: null });
    expect(listApps()[0].waiting).toBeNull();
  });

  it('does not keep a design equal to the saved one, only the words', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue(answer(a.spec));
    await post(a.id, { mode: 'create', instruction: 'Nothing new', baseRevision: 1 });
    expect(getWaiting(a.id)).toMatchObject({ instruction: 'Nothing new', proposal: null });
  });

  it('DELETE clears it, and a save with clearWaiting clears it in the same save', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const design = withTable(a.spec, 'crews', 'Crews');
    runDescribe.mockResolvedValue(answer(design));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    expect((await req('delete', `/api/studio/apps/${a.id}/waiting`)).body).toEqual({ data: { id: a.id } });
    expect(getWaiting(a.id)).toBeNull();

    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    const keep = await req('put', `/api/studio/apps/${a.id}`).send({ spec: design, baseRevision: 1 });
    expect(keep.status).toBe(200);
    expect(getWaiting(a.id)).not.toBeNull();
    const done = await req('put', `/api/studio/apps/${a.id}`).send({ spec: design, baseRevision: 2, clearWaiting: true });
    expect(done.status).toBe(200);
    expect(getWaiting(a.id)).toBeNull();
    expect((await req('put', `/api/studio/apps/${a.id}`).send({ spec: a.spec, baseRevision: 3, clearWaiting: 'yes' })).status).toBe(400);
  });

  it('a conflicting save keeps the entry', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue(answer(withTable(a.spec, 'crews', 'Crews')));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    expect(() => saveSpec(a.id, a.spec, 7, { clearWaiting: true })).toThrow(StudioError);
    expect(getWaiting(a.id)).not.toBeNull();
  });

  it('deleting the app removes its entry', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue(answer(withTable(a.spec, 'crews', 'Crews')));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    expect(waitingKeys()).toHaveLength(1);
    expect(deleteApp(a.id)).toBe(true);
    expect(waitingKeys()).toEqual([]);
  });

  it('a new plain run drops the old waiting design', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValueOnce(answer(withTable(a.spec, 'crews', 'Crews')));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    runDescribe.mockRejectedValueOnce(new Error('boom'));
    await post(a.id, { mode: 'create', instruction: 'Tasks', baseRevision: 1 });
    expect(getWaiting(a.id)).toMatchObject({ instruction: 'Tasks', proposal: null });
  });
});

describe('the waiting route with nothing waiting', () => {
  it('answers null when nothing waits, 404 for an unknown app', async () => {
    const a = createApp({ name: 'Crew Roster' });
    expect((await req('get', `/api/studio/apps/${a.id}/waiting`)).body).toEqual({ data: null });
    expect((await req('get', `/api/studio/apps/${crypto.randomUUID()}/waiting`)).status).toBe(404);
    expect((await req('delete', `/api/studio/apps/${crypto.randomUUID()}/waiting`)).status).toBe(404);
    expect(listApps()[0].waiting).toBeNull();
  });
});

describe('the first prompt kept by Use this (L-16)', () => {
  const promptKeys = () => rowsOf(db, 'app_state').map((r) => r.key).filter((k) => k.startsWith('studio.prompt.'));

  it('Use this keeps the create words, the app routes return them as firstPrompt, and deleting the app removes them', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const design = withTable(a.spec, 'crews', 'Crews');
    seedWaiting(a, design);
    expect((await req('get', `/api/studio/apps/${a.id}`)).body.data.firstPrompt).toBeUndefined();
    const keep = await req('put', `/api/studio/apps/${a.id}`).send({ spec: design, baseRevision: 1 });
    expect(keep.body.data.firstPrompt).toBeUndefined();
    expect(promptKeys()).toEqual([]);
    const done = await req('put', `/api/studio/apps/${a.id}`).send({ spec: design, baseRevision: 2, clearWaiting: true });
    expect(done.body.data.firstPrompt).toBe('Crews');
    expect(getWaiting(a.id)).toBeNull();
    expect((await req('get', `/api/studio/apps/${a.id}`)).body.data.firstPrompt).toBe('Crews');
    expect(promptKeys()).toEqual([`studio.prompt.${a.id}`]);
    expect(deleteApp(a.id)).toBe(true);
    expect(promptKeys()).toEqual([]);
  });

  it('keeps nothing for an edit run, and does not replace a first prompt already kept', () => {
    const a = createApp({ name: 'Crew Roster' });
    startRun(a.id, { mode: 'edit', instruction: 'Rename it', baseRevision: 1, refine: false });
    clearWaiting(a.id, null, true);
    expect(promptKeys()).toEqual([]);
    startRun(a.id, { mode: 'create', instruction: 'First words', baseRevision: 1, refine: false });
    clearWaiting(a.id, null, true);
    startRun(a.id, { mode: 'create', instruction: 'Later words', baseRevision: 1, refine: false });
    clearWaiting(a.id, null, true);
    expect(rowsOf(db, 'app_state').find((r) => r.key === `studio.prompt.${a.id}`).value).toEqual({ instruction: 'First words' });
  });
});

describe.skipIf(PUBLIC_BUILD)('an ask on the waiting design (onto waiting) (a waiting design comes from the helper, which is not in a public build)', () => {
  it('edits the stored design, keeps the first words, appends the ask and keeps the replaced design', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const first = withTable(a.spec, 'crews', 'Crews');
    runDescribe.mockResolvedValueOnce(answer(first));
    await post(a.id, { mode: 'create', instruction: 'A roster of crews', baseRevision: 1 });
    const second = withTable(first, 'jobs', 'Jobs');
    runDescribe.mockResolvedValueOnce(answer(second));
    const res = await post(a.id, { mode: 'edit', instruction: 'Add jobs', baseRevision: 1, onto: 'waiting' });
    const call = runDescribe.mock.calls[1][0];
    expect(call).toMatchObject({ mode: 'edit', instruction: 'Add jobs' });
    expect(call.baseSpec).toEqual(first);
    const sent = events(res.body).find(([e]) => e === 'proposal')[1];
    expect(sent).toMatchObject({ onto: 'waiting', baseRevision: 1 });
    expect(sent.replaced).toEqual(first);
    const kept = getWaiting(a.id);
    expect(kept).toMatchObject({ instruction: 'A roster of crews', asks: ['Add jobs'], mode: 'create' });
    expect(kept.proposal).toEqual(sent.proposal);
    expect(kept.replaced).toEqual(first);
    expect(kept.proposal.tables.map((t) => t.id)).toEqual(['crews', 'jobs']);
  });

  it('a failed ask leaves the waiting design as it was', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValueOnce(answer(withTable(a.spec, 'crews', 'Crews')));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    runDescribe.mockRejectedValueOnce(new Error('boom'));
    await post(a.id, { mode: 'edit', instruction: 'More', baseRevision: 1, onto: 'waiting' });
    expect(getWaiting(a.id)).toMatchObject({ instruction: 'Crews', asks: [] });
    expect(getWaiting(a.id).proposal).not.toBeNull();
  });

  it('answers 400 with no waiting design, with mode create and with a bad value, and 409 for a stale revision', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const none = await post(a.id, { mode: 'edit', instruction: 'More', baseRevision: 1, onto: 'waiting' });
    expect(none.status).toBe(400);
    expect(JSON.parse(none.body)).toMatchObject({ code: 'invalid_request', error: 'There is no waiting design to change. Make your app first.' });
    expect((await post(a.id, { mode: 'create', instruction: 'More', baseRevision: 1, onto: 'waiting' })).status).toBe(400);
    expect((await post(a.id, { mode: 'edit', instruction: 'More', baseRevision: 1, onto: 'saved' })).status).toBe(400);
    expect((await post(a.id, { mode: 'edit', instruction: 'More', baseRevision: 4, onto: 'waiting' })).status).toBe(409);
    expect(runDescribe).not.toHaveBeenCalled();
  });
});

const planted = (a) => rowsOf(db, 'app_state').find((r) => r.key === waitingKey(a.id));
const setValue = (a, change) => {
  const row = planted(a);
  db.prepare('UPDATE app_state SET value = ? WHERE key = ?').run(JSON.stringify({ ...row.value, ...change }), row.key);
};
const proposalEvent = (res) => events(res.body).find(([e]) => e === 'proposal')[1];

describe.skipIf(PUBLIC_BUILD)('a waiting design older than the saved app (a waiting design comes from the helper, which is not in a public build)', () => {
  it('refuses an ask before running with waiting_stale and leaves the entry alone', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const first = withTable(a.spec, 'crews', 'Crews');
    runDescribe.mockResolvedValueOnce(answer(first));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    // The person saved in Design after the design was made.
    expect(saveSpec(a.id, withTable(a.spec, 'projects', 'Projects'), 1).revision).toBe(2);
    runDescribe.mockClear();
    const res = await post(a.id, { mode: 'edit', instruction: 'More', baseRevision: 2, onto: 'waiting' });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'waiting_stale', error: expect.stringContaining('saved after the waiting design was made') });
    expect(runDescribe).not.toHaveBeenCalled();
    expect(getWaiting(a.id)).toMatchObject({ baseRevision: 1, asks: [] });
  });
});

describe.skipIf(PUBLIC_BUILD)('the entry version (at) (a waiting design comes from the helper, which is not in a public build)', () => {
  it('is returned by GET and the proposal event and changes with every write', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const first = withTable(a.spec, 'crews', 'Crews');
    runDescribe.mockResolvedValueOnce(answer(first));
    const sent = proposalEvent(await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 }));
    const got = (await req('get', `/api/studio/apps/${a.id}/waiting`)).body.data;
    expect(typeof sent.at).toBe('string');
    expect(got.at).toBe(sent.at);
    runDescribe.mockResolvedValueOnce(answer(withTable(first, 'jobs', 'Jobs')));
    const next = proposalEvent(await post(a.id, { mode: 'edit', instruction: 'Add jobs', baseRevision: 1, onto: 'waiting' }));
    expect(next.at).not.toBe(sent.at);
    expect(getWaiting(a.id).at).toBe(next.at);
  });

  it('a save with clearWaiting and waitingAt clears only the entry it saw, so one window cannot delete the newer design of another', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const design = withTable(a.spec, 'crews', 'Crews');
    runDescribe.mockResolvedValue(answer(design));
    const seenByA = proposalEvent(await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 })).at;
    // Window B makes a newer design.
    runDescribe.mockResolvedValue(answer(withTable(a.spec, 'jobs', 'Jobs')));
    const newer = proposalEvent(await post(a.id, { mode: 'create', instruction: 'Jobs', baseRevision: 1 })).at;
    expect(newer).not.toBe(seenByA);
    const save = await req('put', `/api/studio/apps/${a.id}`).send({ spec: design, baseRevision: 1, clearWaiting: true, waitingAt: seenByA });
    expect(save.status).toBe(200);
    expect(getWaiting(a.id)).toMatchObject({ instruction: 'Jobs', at: newer });
    const matching = await req('put', `/api/studio/apps/${a.id}`).send({ spec: design, baseRevision: 2, clearWaiting: true, waitingAt: newer });
    expect(matching.status).toBe(200);
    expect(getWaiting(a.id)).toBeNull();
    expect((await req('put', `/api/studio/apps/${a.id}`).send({ spec: design, baseRevision: 3, waitingAt: 7 })).status).toBe(400);
  });

  it('DELETE with ?at= clears only a matching entry and always succeeds', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue(answer(withTable(a.spec, 'crews', 'Crews')));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    const at = getWaiting(a.id).at;
    const stale = await req('delete', `/api/studio/apps/${a.id}/waiting?at=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`);
    expect(stale.body).toEqual({ data: { id: a.id } });
    expect(getWaiting(a.id)).not.toBeNull();
    expect((await req('delete', `/api/studio/apps/${a.id}/waiting?at=${encodeURIComponent(at)}`)).status).toBe(200);
    expect(getWaiting(a.id)).toBeNull();
    expect(clearWaiting(a.id, at)).toBe(false);
  });

  it('a refine whose entry was replaced meanwhile sends an error and writes nothing', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const first = withTable(a.spec, 'crews', 'Crews');
    runDescribe.mockResolvedValueOnce(answer(first));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    runDescribe.mockImplementationOnce(async () => {
      // Another window starts a plain run while this ask works.
      startRun(a.id, { mode: 'create', instruction: 'Tasks', baseRevision: 1, refine: false });
      return answer(withTable(first, 'jobs', 'Jobs'));
    });
    const res = await post(a.id, { mode: 'edit', instruction: 'Add jobs', baseRevision: 1, onto: 'waiting' });
    const list = events(res.body);
    expect(list.some(([e]) => e === 'proposal')).toBe(false);
    expect(list.find(([e]) => e === 'error')[1]).toMatchObject({ code: 'revision_conflict', error: expect.stringContaining('another window') });
    expect(getWaiting(a.id)).toMatchObject({ instruction: 'Tasks', asks: [], proposal: null });
  });

  it('two refines from the same version: the first to answer lands, the other is refused', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const first = withTable(a.spec, 'crews', 'Crews');
    runDescribe.mockResolvedValueOnce(answer(first));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    runDescribe.mockClear();
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    runDescribe.mockImplementationOnce(async () => {
      await gate;
      return answer(withTable(first, 'jobs', 'Jobs'));
    });
    runDescribe.mockImplementationOnce(async () => answer(withTable(first, 'projects', 'Projects')));
    const slow = post(a.id, { mode: 'edit', instruction: 'Add jobs', baseRevision: 1, onto: 'waiting' }).then((r) => r);
    while (runDescribe.mock.calls.length < 1) await new Promise((r) => setTimeout(r, 10));
    const fast = events((await post(a.id, { mode: 'edit', instruction: 'Add projects', baseRevision: 1, onto: 'waiting' })).body);
    expect(fast.some(([e]) => e === 'proposal')).toBe(true);
    release();
    const lost = events((await slow).body);
    expect(lost.some(([e]) => e === 'proposal')).toBe(false);
    expect(lost.some(([e]) => e === 'error')).toBe(true);
    expect(getWaiting(a.id).asks).toEqual(['Add projects']);
  });
});

describe.skipIf(PUBLIC_BUILD)('a cancelled or orphaned run keeps nothing (a waiting design comes from the helper, which is not in a public build)', () => {
  it('does not store a proposal the person cancelled', async () => {
    const a = createApp({ name: 'Crew Roster' });
    let finished = false;
    runDescribe.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          // A pipeline that ignores the abort and answers anyway.
          signal.addEventListener('abort', () =>
            setTimeout(() => {
              finished = true;
              resolve(answer(withTable(a.spec, 'crews', 'Crews')));
            }, 20),
          );
        }),
    );
    const server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const payload = JSON.stringify({ mode: 'create', instruction: 'Crews', baseRevision: 1 });
      const call = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        path: `/api/studio/apps/${a.id}/describe`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'x-forwarded-for': nextIp() },
      });
      call.on('error', () => {});
      call.on('response', (res) => res.once('data', () => call.destroy()));
      call.end(payload);
      const end = Date.now() + 5000;
      while (!finished && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 100));
      expect(finished).toBe(true);
      // The words were kept when the run started; the answer was not.
      expect(getWaiting(a.id)).toMatchObject({ instruction: 'Crews', proposal: null });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('does not recreate an entry for an app deleted while the helper worked', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockImplementationOnce(async () => {
      deleteApp(a.id);
      return answer(withTable(a.spec, 'crews', 'Crews'));
    });
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    expect(waitingKeys()).toEqual([]);
  });
});

describe('the list summary', () => {
  it('checks a waiting design once per version of its entry', () => {
    const a = createApp({ name: 'Crew Roster' });
    seedWaiting(a, withTable(a.spec, 'crews', 'Crews'));
    expect(listApps()[0].waiting).toEqual({ tableCount: 1, pageCount: 1 });
    // The design changes under the same version: the cached summary answers.
    setValue(a, { proposal: withTable(withTable(a.spec, 'crews', 'Crews'), 'jobs', 'Jobs') });
    expect(listApps()[0].waiting).toEqual({ tableCount: 1, pageCount: 1 });
    // A new version is checked again.
    setValue(a, { at: '2999-01-01T00:00:00.000Z' });
    expect(listApps()[0].waiting).toEqual({ tableCount: 2, pageCount: 1 });
    // A removed entry is forgotten.
    clearWaiting(a.id);
    expect(listApps()[0].waiting).toBeNull();
  });
});

describe('reading a stored entry', () => {
  it('keeps only string fallbacks and caps the asks and fallbacks in count and length', () => {
    const a = createApp({ name: 'Crew Roster' });
    seedWaiting(a, withTable(a.spec, 'crews', 'Crews'));
    setValue(a, {
      asks: Array.from({ length: 80 }, (_, i) => (i === 79 ? 'x'.repeat(5000) : `ask ${i}`)),
      fallbacks: [{ part: 'Chart', pageId: 'home', message: 'No chart' }, { part: 3, message: 'x' }, 'text', { part: 'List', message: 'y', extra: { deep: true } }, null],
    });
    const kept = getWaiting(a.id);
    expect(kept.asks).toHaveLength(50);
    expect(kept.asks[49]).toHaveLength(2000);
    expect(kept.fallbacks).toEqual([{ part: 'Chart', pageId: 'home', message: 'No chart' }, { part: 'List', message: 'y' }]);
    setValue(a, { fallbacks: Array.from({ length: 90 }, () => ({ part: 'p', message: 'm' })) });
    expect(getWaiting(a.id).fallbacks).toHaveLength(50);
  });
});

describe('duplicate with a name (P17-16)', () => {
  it('uses the given name, defaults without one, and refuses a bad or taken name', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const named = await req('post', `/api/studio/apps/${a.id}/duplicate`).send({ name: 'North Site' });
    expect(named.status).toBe(201);
    expect(named.body.data).toMatchObject({ name: 'North Site', slug: 'north-site' });
    expect((await req('post', `/api/studio/apps/${a.id}/duplicate`)).body.data.name).toBe('Crew Roster Copy');
    const bad = await req('post', `/api/studio/apps/${a.id}/duplicate`).send({ name: '1' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_request');
    expect((await req('post', `/api/studio/apps/${a.id}/duplicate`).send({ name: 7 })).status).toBe(400);
    expect(duplicateApp(a.id, { name: 'Other Site' }).name).toBe('Other Site');
  });
});

describe('export and import leave waiting entries alone', () => {
  it('the export omits them and an import never sets one', async () => {
    const a = createApp({ name: 'Crew Roster' });
    seedWaiting(a, withTable(a.spec, 'crews', 'Crews'));
    expect(waitingKeys()).toEqual([waitingKey(a.id)]);
    const { zip } = await buildExportZip({ db });
    const files = unzipSync(zip);
    const exported = JSON.parse(strFromU8(files['json/app_state.json']));
    expect(exported.some((r) => String(r.key).startsWith('studio.waiting.'))).toBe(false);

    const id = crypto.randomUUID();
    const archive = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'local-app-studio-export', formatVersion: 1, tables: [{ id: 'app_state' }] })),
      'json/app_state.json': strToU8(JSON.stringify([{ key: `studio.waiting.${id}`, value: { instruction: 'x' } }, { key: 'ui.note', value: 1 }])),
    });
    importZipBuffer(archive, { db });
    const keys = rowsOf(db, 'app_state').map((r) => r.key);
    expect(keys).toContain('ui.note');
    expect(keys).not.toContain(`studio.waiting.${id}`);
  });
});

describe.skipIf(PUBLIC_BUILD)('fix round 2: versions and stale summaries (L2, L3) (a waiting design comes from the helper, which is not in a public build)', () => {
  it('L3: the Apps list does not claim a waiting design made before a later save', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue(answer(withTable(a.spec, 'crews', 'Crews')));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    expect(listApps()[0].waiting).toEqual({ tableCount: 1, pageCount: 1 });
    // The same entry version, a newer app revision: the cached count is not reused and the stale design is dropped from the card.
    saveSpec(a.id, withTable(a.spec, 'projects', 'Projects'), 1);
    expect(listApps()[0].waiting).toBeNull();
    // The entry itself is kept (the pane offers Try again or Throw it away).
    expect(getWaiting(a.id)).toMatchObject({ baseRevision: 1 });
  });

  it('L2: an entry whose version is not a date has no version', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue(answer(withTable(a.spec, 'crews', 'Crews')));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    setValue(a, { at: 'not a date' });
    expect(getWaiting(a.id).at).toBeNull();
    setValue(a, { at: '2026-11-05T00:00:00.000Z' });
    expect(getWaiting(a.id).at).toBe('2026-11-05T00:00:00.000Z');
  });

  it('L2: a change to the waiting design that cannot be stored is an error, not a design with no version', async () => {
    const a = createApp({ name: 'Crew Roster' });
    const first = withTable(a.spec, 'crews', 'Crews');
    runDescribe.mockResolvedValueOnce(answer(first));
    await post(a.id, { mode: 'create', instruction: 'Crews', baseRevision: 1 });
    db.exec("CREATE TRIGGER refuse_waiting_update BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT, 'refused'); END;");
    try {
      runDescribe.mockResolvedValueOnce(answer(withTable(first, 'jobs', 'Jobs')));
      const list = events((await post(a.id, { mode: 'edit', instruction: 'Add jobs', baseRevision: 1, onto: 'waiting' })).body);
      expect(list.some(([e]) => e === 'proposal')).toBe(false);
      const failure = list.find(([e]) => e === 'error')[1];
      expect(failure).toMatchObject({ code: 'server_error', error: expect.stringContaining('could not be kept') });
    } finally {
      db.exec('DROP TRIGGER refuse_waiting_update');
    }
    expect(getWaiting(a.id).proposal).toEqual(first);
  });
});
