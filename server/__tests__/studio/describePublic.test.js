// A public build has no helper: the Describe route answers the 403 feature_unavailable envelope before it reads the body,
// checks the app or asks for an AI client (requireInBuild('helper') is mounted first). The pro twin of this file is
// routesDescribe.test.js, which runs only in a pro build.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FeatureUnavailableError } from '../../buildFeatures.js';
import { DescribeError, runDescribe } from '../../studio/describe/pipeline.js';
import { PUBLIC_BUILD } from '../helpers/proBuild.js';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'APP_AI'].map((k) => [k, process.env[k]]));

beforeAll(async () => {
  for (const k of Object.keys(saved)) delete process.env[k];
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe.skipIf(!PUBLIC_BUILD)('the Describe route in a public build (runs only in a public build, where the helper is not in the build)', () => {
  it('answers 403 feature_unavailable with the helper sentence, even for an unknown app and a bad body', async () => {
    for (const [id, body] of [
      [crypto.randomUUID(), { mode: 'create', instruction: 'A roster of crews', baseRevision: 1 }],
      ['nope', {}],
    ]) {
      const res = await request(app).post(`/api/studio/apps/${id}/describe`).set('X-Forwarded-For', '203.0.113.7').send(body);
      expect(res.status).toBe(403);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        code: 'feature_unavailable',
        feature: 'helper',
        error: 'The helper is not in this build. Build it yourself in Design.',
      });
      expect(typeof res.body.requestId).toBe('string');
    }
  });

  it('the stub pipeline refuses to run and says the helper is not in the build', async () => {
    const err = await runDescribe({ instruction: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(FeatureUnavailableError);
    expect(err).toMatchObject({ feature: 'helper', status: 403, message: 'The helper is not in this build. Build it yourself in Design.' });
    expect(new DescribeError('invalid_input').publicMessage).toBe('The helper is not in this build. Build it yourself in Design.');
  });
});
