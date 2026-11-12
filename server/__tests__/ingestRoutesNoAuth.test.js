// POST /api/ingest/parse wired into server.js WITHOUT sign-in (loopback client): no-store on every answer.
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { INGEST_BODY_PATH } from '../ingestRoutes.js';

vi.mock('../../loadEnv.js', () => ({}));

const b64 = (buf) => Buffer.from(buf).toString('base64');

describe('wired into server.js without sign-in (loopback)', () => {
  it('no-store on 200, 400 (bad JSON), 413 (body limit) and 422', async () => {
    const { default: app } = await import('../../server.js');
    const bad = await request(app).post(INGEST_BODY_PATH).set('content-type', 'application/json').send('{"data":');
    const big = await request(app)
      .post(INGEST_BODY_PATH)
      .set('content-type', 'application/json')
      .send(JSON.stringify({ data: 'A'.repeat(36 * 1024 * 1024) }));
    const unsupported = await request(app).post(INGEST_BODY_PATH).send({ data: b64(Buffer.from([1, 2, 0, 3])) });
    const ok = await request(app).post(INGEST_BODY_PATH).send({ data: b64('plain words\n'), kind: 'text' });
    expect([bad.status, big.status, unsupported.status, ok.status]).toEqual([400, 413, 422, 200]);
    for (const res of [bad, big, unsupported, ok]) expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(JSON.stringify(bad.body)).not.toContain('Unexpected');
  }, 120_000);
});
