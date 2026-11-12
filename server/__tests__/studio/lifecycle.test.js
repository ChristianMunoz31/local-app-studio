import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, rowsOf } from '../helpers/testDb.js';
import studioModule from '../../modules/studio.js';
import { getPreviewManager } from '../../studio/preview/manager.js';

let db;
beforeAll(() => {
  db = createTestDb();
});
afterAll(() => closeTestDb(db));

describe('studio module lifecycle', () => {
  it('declares its budgets and paths', () => {
    expect(studioModule).toMatchObject({
      modes: ['studio'],
      noStorePaths: ['/api/studio', '/api/preview'],
      aiPostPaths: ['/api/studio/apps/:id/describe'],
      ownBody: [],
    });
    expect(studioModule.limiters.map((l) => [l.path, l.max])).toEqual([
      ['/api/studio', 1200],
      ['/api/preview', 3000],
    ]);
  });

  it('onStart marks running builds interrupted', () => {
    const appId = crypto.randomUUID();
    db.prepare('INSERT INTO apps (id, name, slug, spec) VALUES (?, ?, ?, ?)').run(appId, 'Life Cycle', 'life-cycle', '{}');
    db.prepare('INSERT INTO builds (id, app_id, status, started_at) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), appId, 'running', '2026-01-01T00:00:00.000Z');
    studioModule.onStart();
    expect(rowsOf(db, 'builds')[0].status).toBe('interrupted');
  });

  it('onStop stops the preview manager', async () => {
    const stop = vi.spyOn(getPreviewManager(), 'stop');
    await studioModule.onStop();
    expect(stop).toHaveBeenCalledTimes(1);
    stop.mockRestore();
  });
});
