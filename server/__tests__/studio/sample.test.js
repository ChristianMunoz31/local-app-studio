// An example's sample records: stored with the app by the import route, listed as a flag, copied by Duplicate, removed by
// Delete, never part of the app record or its file, carried by the data archive.
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { openDb } from '../../db/index.js';
import { buildExportZip } from '../../exportRoutes.js';
import { importZipBuffer } from '../../import/importExport.js';
import { clearSample, copySample, readSample, sampleAppIds, sampleKey, writeSample } from '../../studio/sample.js';
import { starterSpec } from '../../studio/specCheck.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
let n = 0;
const ip = () => `10.8.${Math.floor(n / 250)}.${(n += 1) % 250}`;
const req = (method, url) => request(app)[method](url).set('X-Forwarded-For', ip());

const specWithTables = (name = 'Crew Board', slug = 'crew-board') => {
  const spec = starterSpec(name, slug);
  spec.tables = [
    { id: 'crews', label: 'Crews', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
    {
      id: 'people',
      label: 'People',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'crew', label: 'Crew', type: 'reference', table: 'crews' },
        { id: 'started', label: 'Started', type: 'date' },
      ],
    },
  ];
  return spec;
};
const sample = () => ({
  v: 1,
  tables: {
    crews: [{ _id: 'c1', name: 'North Crew' }],
    people: [{ name: 'Mara Quill', crew: 'c1', started: { $days: -3 } }],
  },
});
const importWith = (body) => req('post', '/api/studio/apps/import').send(body);
const keyRows = () => rowsOf(db, 'app_state').filter((r) => r.key.startsWith('studio.sample.'));

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

describe('import with sample records', () => {
  it('stores the sample under studio.sample.<appId> and answers the plain record', async () => {
    const res = await importWith({ spec: specWithTables(), sample: sample() });
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('sample');
    const rows = keyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(sampleKey(res.body.data.id));
    expect(rows[0].value).toEqual(sample());
    expect(readSample(res.body.data.id)).toEqual(sample());
  });

  it('refuses a bad sample with 400 invalid_request and makes no app', async () => {
    const bad = [
      { v: 1, tables: { nope: [] } },
      { v: 1, tables: { people: [{ name: 'a', started: '2026-01-01' }] } },
      { v: 1, tables: { people: [{ name: 'a', crew: 'missing' }] } },
      'text',
      null,
    ];
    for (const sampleBody of bad) {
      const res = await importWith({ spec: specWithTables(), sample: sampleBody });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_request');
    }
    expect(rowsOf(db, 'apps')).toHaveLength(0);
    expect(keyRows()).toHaveLength(0);
  });

  it('behaves as before without a sample', async () => {
    const res = await importWith({ spec: specWithTables() });
    expect(res.status).toBe(201);
    expect(keyRows()).toHaveLength(0);
    expect((await req('get', '/api/studio/apps')).body.data[0].sample).toBe(false);
  });

  it('keeps the sample with the suffixed app when the slug is taken', async () => {
    await importWith({ spec: specWithTables(), sample: sample() });
    const second = await importWith({ spec: specWithTables(), sample: sample() });
    expect(second.body.data.slug).toBe('crew-board-2');
    expect(keyRows()).toHaveLength(2);
  });

  it('writes nothing for a spec that fails its checks', async () => {
    const spec = specWithTables();
    spec.tables[1].fields[1].table = 'nowhere';
    const res = await importWith({ spec, sample: sample() });
    expect(res.status).toBe(400);
    expect(keyRows()).toHaveLength(0);
  });
});

describe('list, record, duplicate, delete', () => {
  it('flags apps that have a sample and leaves the record and the app file without it', async () => {
    const a = (await importWith({ spec: specWithTables(), sample: sample() })).body.data;
    const b = (await importWith({ spec: specWithTables('Plain App', 'plain-app') })).body.data;
    const list = (await req('get', '/api/studio/apps')).body.data;
    expect(list.find((s) => s.id === a.id).sample).toBe(true);
    expect(list.find((s) => s.id === b.id).sample).toBe(false);
    const record = (await req('get', `/api/studio/apps/${a.id}`)).body.data;
    expect(JSON.stringify(record)).not.toContain('Mara Quill');
    expect(Object.keys(record)).not.toContain('sample');
    expect(Object.keys(record.spec)).not.toContain('sample');
  });

  it('Duplicate copies the sample to the copy, and the copy is independent', async () => {
    const a = (await importWith({ spec: specWithTables(), sample: sample() })).body.data;
    const copy = (await req('post', `/api/studio/apps/${a.id}/duplicate`).send({})).body.data;
    expect(readSample(copy.id)).toEqual(sample());
    expect(keyRows()).toHaveLength(2);
    expect((await req('delete', `/api/studio/apps/${a.id}`)).status).toBe(200);
    expect(readSample(copy.id)).toEqual(sample());
    expect(readSample(a.id)).toBeNull();
  });

  it('Duplicate of an app without a sample writes none', async () => {
    const b = (await importWith({ spec: specWithTables() })).body.data;
    expect((await req('post', `/api/studio/apps/${b.id}/duplicate`).send({})).status).toBe(201);
    expect(keyRows()).toHaveLength(0);
  });

  it('Delete removes the sample row', async () => {
    const a = (await importWith({ spec: specWithTables(), sample: sample() })).body.data;
    expect(keyRows()).toHaveLength(1);
    expect((await req('delete', `/api/studio/apps/${a.id}`)).status).toBe(200);
    expect(keyRows()).toHaveLength(0);
  });
});

describe('sample.js', () => {
  it('reads null for a missing or damaged value and never throws', () => {
    expect(readSample('00000000-0000-4000-8000-000000000000')).toBeNull();
    writeSample('x', { v: 1, tables: { a: [{ n: { nope: 1 } }] } });
    expect(readSample('x')).toBeNull();
    writeSample('y', 'not an object');
    expect(readSample('y')).toBeNull();
  });

  it('copies, clears and lists ids with one select', () => {
    writeSample('a', sample());
    copySample('a', 'b');
    copySample('missing', 'c');
    expect(sampleAppIds(['a', 'b', 'c']).size).toBe(2);
    expect(sampleAppIds([]).size).toBe(0);
    expect(clearSample('a')).toBe(true);
    expect(clearSample('a')).toBe(false);
    expect([...sampleAppIds(['a', 'b'])]).toEqual(['b']);
  });
});

describe('data archive', () => {
  it('carries the sample row with its app and an import restores it', async () => {
    const a = (await importWith({ spec: specWithTables(), sample: sample() })).body.data;
    const { zip } = await buildExportZip({ db });
    const dest = openDb({ filename: ':memory:' });
    try {
      importZipBuffer(zip, { db: dest });
      expect(rowsOf(dest, 'apps').map((r) => r.id)).toEqual([a.id]);
      const restored = rowsOf(dest, 'app_state').filter((r) => r.key.startsWith('studio.sample.'));
      expect(restored).toHaveLength(1);
      expect(restored[0].key).toBe(sampleKey(a.id));
      expect(restored[0].value).toEqual(sample());
    } finally {
      dest.close();
    }
  });
});

describe('read the stored sample', () => {
  it('answers the stored records with no-store, and an empty sample for an app without any', async () => {
    const withSample = (await importWith({ spec: specWithTables(), sample: sample() })).body.data.id;
    const res = await req('get', `/api/studio/apps/${withSample}/sample`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual(sample());
    const without = (await importWith({ spec: specWithTables('Other', 'other') })).body.data.id;
    const empty = await req('get', `/api/studio/apps/${without}/sample`);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({ v: 1, tables: {} });
  });

  it('answers 404 in the error envelope for an unknown or malformed app id', async () => {
    const unknown = await req('get', '/api/studio/apps/0b9a4c1e-5f1d-4b57-8d0e-2a3f6c1d9e11/sample');
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('app_not_found');
    expect(unknown.headers['cache-control']).toBe('no-store');
    const malformed = await req('get', '/api/studio/apps/not-an-id/sample');
    expect(malformed.status).toBe(404);
    expect(malformed.headers['cache-control']).toBe('no-store');
  });
});
