// Importing and saving an app whose layout has a Grid that places parts freely (docs/phase21/DESIGN-phase21.md 11): the blocks
// round trip byte-equal, a bad block is refused with its code and path, and an old spec round trips as it was.
import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

const FIXTURE = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const plain = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** Crew Roster whose home page holds a free Grid of two Text parts with the given blocks (the blocks are written as given). */
function withGrid(first, second, gridProps = { columns: 12, placement: 'free', rows: 2 }) {
  const spec = plain();
  const text = (id, grid) => ({ id, type: 'Text', ...(grid === undefined ? {} : { grid }), props: {}, children: id });
  spec.pages[0].layout.children = [{ id: 'free_grid', type: 'Grid', props: gridProps, children: [text('left', first), text('right', second)] }];
  return spec;
}
const A = { col: 1, span: 6, row: 1, rowSpan: 1 };
const B = { col: 4, span: 3, row: 2, rowSpan: 1 };

let app;
let db;
let n = 0;
const ip = () => `10.9.${Math.floor(n / 250)}.${(n += 1) % 250}`;
const req = (method, url) => request(app)[method](url).set('X-Forwarded-For', ip());

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

describe('import and save with a free Grid', () => {
  it('imports a free Grid and returns the blocks as written', async () => {
    const imp = await req('post', '/api/studio/apps/import').send({ spec: withGrid(A, B) });
    expect(imp.status).toBe(201);
    const got = await req('get', `/api/studio/apps/${imp.body.data.id}`);
    expect(got.status).toBe(200);
    const grid = got.body.data.spec.pages[0].layout.children[0];
    expect(grid.props).toEqual({ columns: 12, placement: 'free', rows: 2 });
    expect(grid.children[0].grid).toEqual(A);
    expect(grid.children[1].grid).toEqual(B);
  });

  it('PUT accepts a free Grid', async () => {
    const imp = await req('post', '/api/studio/apps/import').send({ spec: plain() });
    expect(imp.status).toBe(201);
    const put = await req('put', `/api/studio/apps/${imp.body.data.id}`).send({ spec: withGrid(A, B), baseRevision: imp.body.data.revision ?? 1 });
    expect(put.status).toBe(200);
  });

  it('refuses a block outside a free Grid with grid_not_allowed', async () => {
    const r = await req('post', '/api/studio/apps/import').send({ spec: withGrid(A, B, { columns: 2 }) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('invalid_spec');
    const codes = r.body.issues.map((i) => i.code);
    expect(codes).toContain('grid_not_allowed');
    expect(JSON.stringify(r.body.issues)).toContain('pages.0.layout.children.0.children.0.grid');
  });

  it('refuses two parts on the same cells with grid_overlap', async () => {
    const r = await req('post', '/api/studio/apps/import').send({ spec: withGrid(A, { col: 6, span: 3, row: 1, rowSpan: 1 }, { columns: 12, placement: 'free', rows: 1 }) });
    expect(r.status).toBe(400);
    const overlap = r.body.issues.find((i) => i.code === 'grid_overlap');
    expect(overlap.path).toBe('pages.0.layout.children.0.children.1.grid');
  });

  it('refuses a bad block with its path', async () => {
    const r = await req('post', '/api/studio/apps/import').send({ spec: withGrid({ col: 10, span: 4, row: 1, rowSpan: 1 }, undefined) });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.issues)).toContain('pages.0.layout.children.0.children.0.grid.span');
  });
});

describe('an old spec', () => {
  it('round trips with no grid key', async () => {
    const imp = await req('post', '/api/studio/apps/import').send({ spec: plain() });
    expect(imp.status).toBe(201);
    const got = await req('get', `/api/studio/apps/${imp.body.data.id}`);
    expect(JSON.stringify(got.body.data.spec)).not.toContain('"grid"');
    expect(JSON.stringify(got.body.data.spec)).not.toContain('"placement"');
  });
});
