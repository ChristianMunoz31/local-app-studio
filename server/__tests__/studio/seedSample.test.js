// seedSample against the real runtime data routes (in process, on a loopback port): defaults filled, references mapped, a row
// the app refuses skipped, existing rows mean no writes, tokens resolved with an injected today, a dead or silent child aborts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json'), 'utf8'));
  spec.tables.find((t) => t.id === 'crews').fields.push({ id: 'started', label: 'Started', type: 'date' });
  spec.tables.find((t) => t.id === 'people').fields.push({ id: 'seen', label: 'Seen', type: 'datetime' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-seed-'));
  const file = path.join(dir, 'app-spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SEED_DIR = dir;
});

import fs from 'node:fs';
import http from 'node:http';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { seedSample } from '../../studio/preview/seed.js';

vi.mock('../../../loadEnv.js', () => ({}));

let db;
let server;
let port;
let spec;
const savedPw = { APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };
const today = new Date(2026, 5, 15, 12);

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  spec = JSON.parse(fs.readFileSync(process.env.APP_SPEC_PATH, 'utf8'));
  const app = (await import('../../../server.js')).default;
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeTestDb(db);
  fs.rmSync(process.env.__TEST_SEED_DIR, { recursive: true, force: true });
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
  delete process.env.__TEST_SEED_DIR;
  for (const [k, v] of Object.entries(savedPw)) if (v !== undefined) process.env[k] = v;
});
beforeEach(() => resetDb(db));

const sample = {
  v: 1,
  tables: {
    // listed before the table it points at: the seeder orders them
    crews: [
      { _id: 'c1', name: 'North Crew', lead_id: 'p1', started: { $days: -2 } },
      { name: 'Refused Crew', lead_id: 'p1', status: 'not an option' },
      { name: 'South Crew', lead_id: 'p2', size: 4 },
    ],
    people: [
      { _id: 'p1', name: 'Mara Quill', seen: { $days: 1, time: '09:30' } },
      { _id: 'p2', name: 'Theo Brannock' },
    ],
  },
};
const run = (extra = {}) => seedSample({ port, cookie: 'unused', spec, sample, today, ...extra });

describe('seedSample', () => {
  it('creates the rows parents first, maps references, fills defaults, resolves tokens and skips a refused row', async () => {
    const result = await run();
    expect(result).toEqual({ created: 4, skipped: 1, hadRows: false, aborted: false });
    const people = rowsOf(db, 'people');
    const crews = rowsOf(db, 'crews');
    expect(people.map((p) => p.name)).toEqual(['Mara Quill', 'Theo Brannock']);
    expect(crews.map((c) => c.name)).toEqual(['North Crew', 'South Crew']);
    const north = crews[0];
    expect(north.lead_id).toBe(people[0].id);
    expect(north.started).toBe('2026-06-13');
    expect(north.size).toBe(1);
    expect(north.status).toBe('active');
    expect(crews[1]).toMatchObject({ lead_id: people[1].id, size: 4 });
    const seen = new Date(people[0].seen);
    expect([seen.getFullYear(), seen.getMonth(), seen.getDate(), seen.getHours(), seen.getMinutes()]).toEqual([2026, 5, 16, 9, 30]);
  });

  it('writes nothing when a table already has rows', async () => {
    expect(await run()).toMatchObject({ created: 4 });
    const again = await run();
    expect(again).toEqual({ created: 0, skipped: 0, hadRows: true, aborted: false });
    expect(rowsOf(db, 'people')).toHaveLength(2);
    expect(rowsOf(db, 'crews')).toHaveLength(2);
  });

  it('skips a table the sample does not have and a row of a table the app lost', async () => {
    const result = await run({ sample: { v: 1, tables: { people: [{ name: 'Only Person' }], gone: [{ name: 'x' }] } } });
    expect(result).toMatchObject({ created: 1, skipped: 0, aborted: false });
    expect(rowsOf(db, 'crews')).toHaveLength(0);
  });

  it('aborts when nothing listens, and when the child never answers', async () => {
    const closed = http.createServer();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const deadPort = closed.address().port;
    await new Promise((resolve) => closed.close(resolve));
    expect(await run({ port: deadPort })).toMatchObject({ created: 0, aborted: true });

    const silent = http.createServer(() => {});
    await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
    try {
      const result = await run({ port: silent.address().port, timeoutMs: 100 });
      expect(result).toMatchObject({ created: 0, aborted: true });
    } finally {
      silent.closeAllConnections();
      await new Promise((resolve) => silent.close(resolve));
    }
  });

  it('stops at the total time limit', async () => {
    const result = await run({ totalMs: 0 });
    expect(result).toMatchObject({ created: 0, aborted: true });
  });
});
