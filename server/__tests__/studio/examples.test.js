// Every example in public/examples/<slug>.spec.json passes the server's own spec checks and imports through the route with its
// <slug>.records.json (201, the sample stored). Skips while the folder holds no example.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { expandAndCheck } from '../../studio/specCheck.js';
import { readSample } from '../../studio/sample.js';

vi.mock('../../../loadEnv.js', () => ({}));

const dir = path.join(process.cwd(), 'public', 'examples');
const slugs = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.spec.json')).map((f) => f.slice(0, -'.spec.json'.length))
  : [];
const read = (slug, file) => JSON.parse(fs.readFileSync(path.join(dir, `${slug}.${file}`), 'utf8'));

let app;
let db;
let n = 0;
const ip = () => `10.7.${Math.floor(n / 250)}.${(n += 1) % 250}`;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

describe.skipIf(slugs.length === 0)('example apps', () => {
  it.each(slugs)('%s passes the server checks', (slug) => {
    const checked = expandAndCheck(read(slug, 'spec.json'), new Map());
    expect(checked.issues).toEqual([]);
    expect(checked.ok).toBe(true);
    expect(checked.spec.app.slug).toBe(slug);
  });

  it.each(slugs)('%s imports with its records through the route', async (slug) => {
    const records = read(slug, 'records.json');
    const res = await request(app).post('/api/studio/apps/import').set('X-Forwarded-For', ip()).send({ spec: read(slug, 'spec.json'), sample: records });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.slug).toBe(slug);
    expect(rowsOf(db, 'app_state').filter((r) => r.key.startsWith('studio.sample.'))).toHaveLength(1);
    expect(readSample(res.body.data.id)).toEqual(records);
  });
});

// The sample rows go through the real runtime data routes (the same ones the Preview seeder calls), one fresh runtime per
// example: every row must be accepted (nothing skipped) and the created count must equal the number of rows.
describe.skipIf(slugs.length === 0)('example sample rows against the runtime data routes', () => {
  const keys = ['APP_MODE', 'APP_SPEC_PATH', 'APP_PASSWORD', 'AUTH_SECRET'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  it.each(slugs)('%s: every sample row is accepted by the runtime', async (slug) => {
    const checked = expandAndCheck(read(slug, 'spec.json'), new Map());
    expect(checked.ok).toBe(true);
    const records = read(slug, 'records.json');
    const total = Object.values(records.tables).reduce((n, rows) => n + rows.length, 0);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'las-exseed-'));
    const file = path.join(tmp, 'app-spec.json');
    fs.writeFileSync(file, JSON.stringify(checked.spec));
    process.env.APP_MODE = 'runtime';
    process.env.APP_SPEC_PATH = file;
    delete process.env.APP_PASSWORD;
    delete process.env.AUTH_SECRET;
    vi.resetModules();
    const helpers = await import('../helpers/testDb.js');
    const { seedSample } = await import('../../studio/preview/seed.js');
    const rdb = helpers.createTestDb();
    const runtime = (await import('../../../server.js')).default;
    const server = http.createServer(runtime);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const result = await seedSample({ port: server.address().port, cookie: 'unused', spec: checked.spec, sample: records, today: new Date(2026, 5, 15, 12) });
      expect(result).toEqual({ created: total, skipped: 0, hadRows: false, aborted: false });
    } finally {
      await new Promise((resolve) => server.close(resolve));
      helpers.closeTestDb(rdb);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
