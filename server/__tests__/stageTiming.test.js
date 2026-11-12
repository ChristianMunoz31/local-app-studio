// Stage timings under one request id (DESIGN phase 15, section 5.5): Describe, build and migrations log `stage` records.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLogForTests, tail, withRequestId } from '../log.js';
import { runDescribe } from '../studio/describe/pipeline.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { loadMigrations, migrate } from '../db/migrate.js';
import { FIXED_MESSAGE, createBuildService } from '../studio/build/service.js';
import { createApp } from '../studio/apps.js';
import { closeTestDb, createTestDb } from './helpers/testDb.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

vi.mock('../../loadEnv.js', () => ({}));

const stages = () => tail().filter((r) => r.event === 'stage');
const names = () => stages().map((r) => r.stage);

beforeEach(() => resetLogForTests());
afterEach(() => resetLogForTests());

describe.skipIf(PUBLIC_BUILD)('Describe stage timings (needs the helper pipeline, which is not in a public build)', () => {
  const client = {
    async complete({ messages, format }) {
      return { content: cannedDescribeChat({ messages, format }) };
    },
  };
  const baseSpec = { specVersion: 1, app: { name: 'Canned App', slug: 'canned-app', identifier: 'com.example.cannedapp', version: '1.0.0' }, theme: { preset: 'ocean', radius: 'md' } };

  it('logs tables, outline, one page per page and a total under the request id', async () => {
    const result = await withRequestId('req-describe-1', () =>
      runDescribe({ client, scope: { categories: ['studio'] }, instruction: 'A roster of work crews.', baseSpec }),
    );
    const rows = stages();
    expect(rows.every((r) => r.requestId === 'req-describe-1')).toBe(true);
    expect(names().slice(0, 2)).toEqual(['describe.tables', 'describe.outline']);
    expect(names().filter((n) => n === 'describe.page')).toHaveLength(result.proposal.pages.length);
    expect(rows.filter((r) => r.stage === 'describe.page').every((r) => typeof r.pageId === 'string')).toBe(true);
    const total = rows.at(-1);
    expect(total.stage).toBe('describe.total');
    expect(total.calls).toBe(2 + result.proposal.pages.length);
    expect(total.fallbacks).toBe(0);
    expect(rows.every((r) => typeof r.durationMs === 'number')).toBe(true);
  });

  it('logs describe.total when the run fails or is refused, not only on success', async () => {
    await expect(runDescribe({ client, scope: { categories: ['studio'] }, instruction: '', baseSpec })).rejects.toMatchObject({ code: 'invalid_input' });
    const boom = { async complete() { throw new Error('model down'); } };
    await expect(runDescribe({ client: boom, scope: { categories: ['studio'] }, instruction: 'A roster of work crews.', baseSpec })).rejects.toThrow('model down');
    const totals = stages().filter((r) => r.stage === 'describe.total');
    expect(totals).toHaveLength(2);
    expect(totals[1]).toMatchObject({ calls: 1, fallbacks: 0 });
  });

  it('logs a describe.repair stage for each repair round', async () => {
    let n = 0;
    const flaky = {
      async complete({ messages, format }) {
        n += 1;
        return { content: n === 1 ? '{"nope":' : cannedDescribeChat({ messages, format }) };
      },
    };
    await runDescribe({ client: flaky, scope: { categories: ['studio'] }, instruction: 'A roster of work crews.', baseSpec });
    const repair = stages().filter((r) => r.stage === 'describe.repair');
    expect(repair).toHaveLength(1);
    expect(repair[0]).toMatchObject({ round: 1, step: 'tables' });
  });
});

describe.skipIf(PUBLIC_BUILD)('build stage timings (needs the build service, which is not in a public build)', () => {
  let db;
  let tmp;
  beforeAll(() => {
    db = createTestDb();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'las-stage-'));
  });
  afterAll(() => {
    closeTestDb(db);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports FIXED_MESSAGE with the plain sentences', () => {
    expect(FIXED_MESSAGE.toolchain_missing).toMatch(/build tools/);
  });

  it('logs build.toolchain and build.total with the failed status', async () => {
    const service = createBuildService({
      detect: async () => ({ ok: false, items: [] }),
      roots: { buildsRoot: path.join(tmp, 'builds'), cargoTargetDir: path.join(tmp, 'cargo'), outputRoot: path.join(tmp, 'out') },
      templateZip: path.join(tmp, 'none.zip'),
      sea: false,
      assertNetwork: async () => {},
      recordNetwork: async () => {},
      timeouts: { settle: 200 },
    });
    try {
      const app = createApp({ name: 'Stage Timing App' });
      await withRequestId('req-build-1', async () => {
        const b = service.start({ appId: app.id, baseRevision: app.revision });
        await new Promise((resolve) => {
          const sub = service.subscribe(b.id, (e) => e.type === 'end' && resolve());
          if (!sub || !sub.snapshot.live) resolve();
        });
      });
      const rows = stages();
      expect(rows.every((r) => r.requestId === 'req-build-1')).toBe(true);
      expect(rows.find((r) => r.stage === 'build.toolchain')).toMatchObject({ status: 'failed' });
      expect(rows.find((r) => r.stage === 'build.total')).toMatchObject({ status: 'failed' });
    } finally {
      await service.shutdown();
    }
  });
});

describe('migration stage timings', () => {
  it('logs migrate.apply per version and migrate.total under the startup id', () => {
    const db = new DatabaseSync(':memory:');
    try {
      migrate(db, { migrations: loadMigrations(), appMigrations: [] });
      const rows = stages();
      expect(rows.every((r) => r.requestId === 'startup')).toBe(true);
      const applied = rows.filter((r) => r.stage === 'migrate.apply');
      expect(applied.length).toBe(loadMigrations().length);
      expect(applied[0]).toMatchObject({ track: 'core', version: 1 });
      expect(rows.at(-1)).toMatchObject({ stage: 'migrate.total', applied: loadMigrations().length });
    } finally {
      db.close();
    }
  });

  it('keeps the request id of a caller inside a request and logs migrate.backup for a real file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-stage-mig-'));
    const file = path.join(dir, 'a.db');
    const db = new DatabaseSync(file);
    try {
      const all = loadMigrations();
      migrate(db, { migrations: all.slice(0, 1), appMigrations: [], filename: file });
      resetLogForTests();
      withRequestId('req-mig-1', () => migrate(db, { migrations: all, appMigrations: [], filename: file }));
      const rows = stages();
      expect(rows.every((r) => r.requestId === 'req-mig-1')).toBe(true);
      expect(names()).toContain('migrate.backup');
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
