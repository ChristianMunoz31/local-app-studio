// ADR-015: every path that reads a design refuses a newer one with spec_too_new and the sentence, and an old one loads unchanged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorRow } from '../../errors.js';
import { resolveSpecSource } from '../../spec/source.js';
import { validateAppSpec } from '../../spec/index.js';
import { SPEC_TOO_NEW, checkSpec, expandAndCheck } from '../../studio/specCheck.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

const FIXTURE_FILE = path.resolve(import.meta.dirname, '../../../packages/runtime/src/spec/fixtures/crew-roster.json');
const OLD = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
const NEWER = { ...OLD, features: ['time-travel'] };
const SENTENCE = 'This app uses Time travel, which this version does not know.';
const VERSION_SENTENCE = 'This app was made by a newer version of Local App Studio.';

describe('an old spec loads exactly as before', () => {
  it('checkSpec returns the same value as validateAppSpec, with no features key', () => {
    const plain = validateAppSpec(OLD);
    const checked = checkSpec(OLD);
    expect(plain.ok).toBe(true);
    expect(checked.ok).toBe(true);
    expect(checked.spec).toEqual(plain.value);
    expect('features' in checked.spec).toBe(false);
    expect(expandAndCheck(OLD, new Map()).spec).toEqual(plain.value);
  });

  it('a built app resolves it (baked JSON)', () => {
    const out = resolveSpecSource({ mode: 'runtime', bundledMode: 'runtime', bundledJson: JSON.stringify(OLD), env: {}, root: '.' });
    expect(out.kind).toBe('baked');
    expect(out.spec.app.name).toBe('Crew Roster');
  });
});

describe('Studio checkSpec', () => {
  it('refuses a newer feature id with one spec_too_new issue that names it', () => {
    expect(checkSpec(NEWER)).toEqual({ ok: false, spec: null, issues: [{ path: '(root)', code: SPEC_TOO_NEW, message: SENTENCE }] });
    expect(expandAndCheck(NEWER, new Map()).issues[0].code).toBe('spec_too_new');
  });

  it('an unknown top-level key is a shape error with its path, not a newer version', () => {
    const checked = checkSpec({ ...OLD, search: { on: true } });
    expect(checked.ok).toBe(false);
    expect(checked.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(checked.issues[0].message).toContain('search');
  });

  it('an unknown key on a part is a shape error with its path', () => {
    const page = { ...OLD.pages[0], layout: { ...OLD.pages[0].layout, color: 'red' } };
    const checked = checkSpec({ ...OLD, pages: [page, ...OLD.pages.slice(1)] });
    expect(checked.ok).toBe(false);
    expect(checked.issues[0]).toMatchObject({ code: 'unrecognized_keys' });
    expect(checked.issues[0].path).toContain('layout');
    expect(checked.issues[0].message).toContain('color');
  });

  it('a higher specVersion is spec_too_new with the plain sentence', () => {
    const checked = checkSpec({ ...OLD, specVersion: 2 });
    expect(checked).toEqual({ ok: false, spec: null, issues: [{ path: '(root)', code: SPEC_TOO_NEW, message: VERSION_SENTENCE }] });
  });
});

describe('a built app (resolveSpecSource)', () => {
  const run = (json) => () => resolveSpecSource({ mode: 'runtime', bundledMode: 'runtime', bundledJson: JSON.stringify(json), env: {}, root: '.' });

  it('refuses to start and carries the code and the sentence', () => {
    expect(run(NEWER)).toThrow('spec_too_new: ' + SENTENCE);
    try {
      run(NEWER)();
    } catch (err) {
      expect(err).toMatchObject({ code: 'spec_too_new', sentence: SENTENCE });
    }
  });

  it('still refuses an unknown top-level or layer key (no schema runs here)', () => {
    expect(run({ ...OLD, search: { on: true } })).toThrow('spec_too_new: This app uses "search", which this version does not know.');
    const page = { ...OLD.pages[0], layout: { ...OLD.pages[0].layout, color: 'red' } };
    expect(run({ ...OLD, pages: [page, ...OLD.pages.slice(1)] })).toThrow('This app uses "color"');
    // a different specVersion stays app_spec_invalid here (checkSpecShape; pinned by source.test.js)
    expect(run({ ...OLD, specVersion: 2 })).toThrow(/^app_spec_invalid: /);
  });

  it('reads a file and an APP_SPEC_PATH design the same way', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-compat-'));
    try {
      const file = path.join(dir, 'app-spec.json');
      fs.writeFileSync(file, JSON.stringify(NEWER));
      expect(() => resolveSpecSource({ mode: 'runtime', bundledMode: 'studio', env: { APP_SPEC_PATH: file }, root: dir })).toThrow(SENTENCE);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the error row', () => {
  it('has a plain sentence and a next step', () => {
    const row = errorRow('spec_too_new');
    expect(row.status).toBe(409);
    expect(row.action).toBe('Update Local App Studio, then open it again.');
  });
});

describe('Studio routes', () => {
  let app;
  let db;
  let n = 0;
  const req = (method, url) => request(app)[method](url).set('X-Forwarded-For', `10.7.0.${(n += 1) % 250}`);

  beforeAll(async () => {
    delete process.env.APP_PASSWORD;
    delete process.env.AUTH_SECRET;
    db = createTestDb();
    app = (await import('../../../server.js')).default;
  });
  beforeEach(() => resetDb(db));
  afterAll(() => closeTestDb(db));

  it('import refuses a newer design with code spec_too_new, 409 and the sentence', async () => {
    const res = await req('post', '/api/studio/apps/import').send({ spec: NEWER });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'spec_too_new', error: SENTENCE, action: 'Update Local App Studio, then open it again.' });
    expect((await req('get', '/api/studio/apps')).body.data).toEqual([]);
  });

  it('import of an unknown key is 400 invalid_spec with the key path; a higher specVersion is 409 spec_too_new', async () => {
    const unknown = await req('post', '/api/studio/apps/import').send({ spec: { ...OLD, search: { on: true } } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('invalid_spec');
    expect(JSON.stringify(unknown.body)).toContain('search');
    const higher = await req('post', '/api/studio/apps/import').send({ spec: { ...OLD, specVersion: 2 } });
    expect(higher.status).toBe(409);
    expect(higher.body).toMatchObject({ code: 'spec_too_new', error: VERSION_SENTENCE });
    expect((await req('get', '/api/studio/apps')).body.data).toEqual([]);
  });

  it('import still accepts an old design and a bad one still gets invalid_spec', async () => {
    expect((await req('post', '/api/studio/apps/import').send({ spec: OLD })).status).toBe(201);
    const bad = await req('post', '/api/studio/apps/import').send({ spec: { specVersion: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_spec');
  });

  it('save refuses a newer design too', async () => {
    const made = (await req('post', '/api/studio/apps').send({ name: 'Crew Roster' })).body.data;
    const res = await req('put', `/api/studio/apps/${made.id}`).send({ spec: { ...made.spec, features: ['time-travel'] }, baseRevision: made.revision });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('spec_too_new');
  });
});
