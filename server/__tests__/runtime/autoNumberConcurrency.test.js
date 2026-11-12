// The counter under load (phase 28, section 2): concurrent POSTs, two handles on one file, and random interleavings of inserts,
// deletes, CSV style batches and resyncs never give a duplicate number or one at or below a number already handed out.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Set before any import (a module reads the app mode and spec when it loads), so it must run synchronously: no dynamic import here.
vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28-'));
  const file = path.join(dir, 'app-spec.json');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server', '__tests__', 'helpers', 'automationSpec.json'), 'utf8'));
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { readAutoNumber, parseAutoNumber } from '@local-app-studio/runtime/spec/autoNumber.ts';
import { createNumberer, readAutoNumberStates, resyncAutoNumbers } from '@local-app-studio/runtime/server/autoNumberStore.js';
import { createRecord } from '@local-app-studio/runtime/server/write.js';
import { count, openDb, remove, select, withTransaction } from '../../db/index.js';
import { getAppSpec, getCompiledSpec } from '../../spec/source.js';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
const savedPw = { APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  fs.rmSync(process.env.__TEST_SPEC_DIR, { recursive: true, force: true });
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
  delete process.env.__TEST_SPEC_DIR;
  for (const [k, v] of Object.entries(savedPw)) if (v !== undefined) process.env[k] = v;
});

const cfg = () => readAutoNumber(getAppSpec().tables.find((t) => t.id === 'invoices'));
const n = (value) => parseAutoNumber(cfg(), value);
const add = (handle, numberer) => {
  const w = createRecord({ compiled: getCompiledSpec(), spec: getAppSpec(), table: 'invoices', body: {}, db: handle, numberer });
  return n(w.row.number);
};

describe('concurrent POSTs', () => {
  it('200 at once give 200 distinct consecutive numbers', async () => {
    const results = await Promise.all(Array.from({ length: 200 }, () => request(app).post('/api/data/invoices').send({})));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const got = results.map((r) => n(r.body.data.number)).sort((a, b) => a - b);
    expect(got[0]).toBe(1001);
    expect(got).toEqual(Array.from({ length: 200 }, (_, i) => 1001 + i));
  });
});

describe('two handles on one file', () => {
  it('alternating transactions give distinct numbers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28-two-'));
    const file = path.join(dir, 'two.db');
    const a = openDb({ filename: file });
    const b = openDb({ filename: file });
    try {
      const seen = [];
      for (let i = 0; i < 30; i += 1) seen.push(add(i % 2 === 0 ? a : b));
      expect(new Set(seen).size).toBe(30);
      expect(seen).toEqual(Array.from({ length: 30 }, (_, i) => 1001 + i));
      expect(count('invoices', { db: a })).toBe(30);
    } finally {
      a.close();
      b.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('random interleavings', () => {
  it('never give a duplicate or a number at or below one already handed out', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28-rand-'));
    const handle = openDb({ filename: path.join(dir, 'rand.db') });
    let seed = 20261111;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const handed = new Set();
    let highest = 0;
    const take = (value) => {
      expect(value).toBeGreaterThan(highest);
      expect(handed.has(value)).toBe(false);
      handed.add(value);
      highest = value;
    };
    try {
      for (let step = 0; step < 300; step += 1) {
        const roll = rnd();
        if (roll < 0.4) take(add(handle));
        else if (roll < 0.6) {
          const rows = select('invoices', { columns: ['id'], db: handle });
          if (rows.length > 0) remove('invoices', { where: { id: rows[Math.floor(rnd() * rows.length)].id }, db: handle });
        } else if (roll < 0.85) {
          withTransaction(() => {
            const numberer = createNumberer({ db: handle, table: 'invoices', cfg: cfg() });
            for (let i = 0, k = 1 + Math.floor(rnd() * 5); i < k; i += 1) take(add(handle, numberer));
            numberer.commit();
          }, handle);
        } else {
          resyncAutoNumbers({ db: handle, spec: getAppSpec(), before: readAutoNumberStates({ db: handle, spec: getAppSpec() }) });
        }
      }
      expect(handed.size).toBeGreaterThan(50);
    } finally {
      handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
