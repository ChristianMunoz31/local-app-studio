// Input validation returns 400 before any backend work. The database is a real
// in-memory one so the data preflight passes and the handler's own validation runs;
// validation runs before any model call (a missing prompt 400s before the AI gate).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
// Pro is on for this file (the Pro gate itself is covered in proGating.test.js).
vi.mock('../license/index.js', async (importOriginal) => (await import('./helpers/pro.js')).mockLicenseModule(importOriginal));
import request from 'supertest';
import { closeTestDb, createTestDb } from './helpers/testDb.js';

vi.mock('../../loadEnv.js', () => ({}));

let app;
let db;
// The shell may export SECRETS_ENCRYPTION_KEY; keep these tests independent of it.
const savedEncKey = process.env.SECRETS_ENCRYPTION_KEY;
afterAll(() => {
  closeTestDb(db);
  if (savedEncKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = savedEncKey;
});

beforeAll(async () => {
  delete process.env.SECRETS_ENCRYPTION_KEY;
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../server.js')).default;
});

describe('input validation (400s)', () => {
  it('400 on POST /api/assistant with no prompt', async () => {
    const res = await request(app).post('/api/assistant').send({});
    expect(res.status).toBe(400);
  });

  it('400 on POST /api/assistant with a prompt over the server max, before any AI work', async () => {
    const { ASSISTANT_MAX_MESSAGE_CHARS } = await import('../assistant/pages.js');
    const tooLong = await request(app)
      .post('/api/assistant')
      .send({ prompt: 'a'.repeat(ASSISTANT_MAX_MESSAGE_CHARS + 1) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe('prompt_too_long');
  });

  it('400 on POST /api/assistant/conversations with a non-string title; a string title is accepted', async () => {
    for (const title of [42, {}, ['x'], true]) {
      const res = await request(app).post('/api/assistant/conversations').send({ title });
      expect(res.status, JSON.stringify(title)).toBe(400);
    }
    const ok = await request(app).post('/api/assistant/conversations').send({ title: 'Plans' });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe('Plans');
  });
});
