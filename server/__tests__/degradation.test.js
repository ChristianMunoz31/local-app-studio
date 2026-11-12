// Graceful degradation. With Ollama not running (or AI turned off) the AI routes 503; a fresh local
// database answers data routes normally; a database that cannot be used 503s with a
// fixed message instead of crashing. loadEnv is mocked so .env can't supply keys.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { closeTestDb, createTestDb } from './helpers/testDb.js';

vi.mock('../../loadEnv.js', () => ({}));
// No Ollama: every local AI request is refused at the socket.
vi.mock('node-fetch', () => ({
  default: vi.fn(async () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
  }),
}));

let app;
let db;
// The shell may export SECRETS_ENCRYPTION_KEY; keep these tests independent of it.
const savedEncKey = process.env.SECRETS_ENCRYPTION_KEY;
afterAll(() => {
  if (db) closeTestDb(db);
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

describe('graceful degradation', () => {
  it('answers a data route with 200 {} on a fresh database', async () => {
    const res = await request(app).get('/api/state');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('503s the page advisor when Ollama is not running', async () => {
    const res = await request(app).post('/api/assistant/advice').send({ page: 'settings', context: '{}', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ollama_unavailable');
  });

  it('503s ai_not_configured when AI is turned off', async () => {
    process.env.APP_AI = '0';
    try {
      const res = await request(app).post('/api/assistant/advice').send({ page: 'settings', context: '{}', messages: [{ role: 'user', content: 'hi' }] });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('ai_not_configured');
    } finally {
      delete process.env.APP_AI;
    }
  });

  it('503s data routes with a fixed message when the database handle is closed', async () => {
    const broken = createTestDb();
    broken.close();
    try {
      const res = await request(app).get('/api/state');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'db_unavailable', message: 'Local database is unavailable.' });
    } finally {
      closeTestDb(db);
      db = createTestDb();
    }
  });
});
