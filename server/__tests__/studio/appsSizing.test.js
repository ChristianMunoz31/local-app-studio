// Importing an app whose layout carries `sizing` (DESIGN-phase9.md 3): the block round trips through GET, a spec
// without it stores no `sizing` key, and a bad block is refused with its path.
import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

const FIXTURE = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const plain = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
/** Crew Roster with `sizing` on the heading h1 and the table t1 of the home page. */
function withSizing(h1, t1) {
  const spec = plain();
  const [heading, table] = spec.pages[0].layout.children;
  if (h1 !== undefined) heading.sizing = h1;
  if (t1 !== undefined) table.sizing = t1;
  return spec;
}

let app;
let db;
let n = 0;
const ip = () => `10.8.${Math.floor(n / 250)}.${(n += 1) % 250}`;
const req = (method, url) => request(app)[method](url).set('X-Forwarded-For', ip());

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

describe('import with layer sizing', () => {
  it('round trips the block through GET, with grow filled', async () => {
    const imp = await req('post', '/api/studio/apps/import').send({ spec: withSizing({ width: 'third' }, { width: 'two-thirds', grow: true }) });
    expect(imp.status).toBe(201);
    const got = await req('get', `/api/studio/apps/${imp.body.data.id}`);
    expect(got.status).toBe(200);
    const [heading, table] = got.body.data.spec.pages[0].layout.children;
    expect(heading.sizing).toEqual({ width: 'third', grow: false });
    expect(table.sizing).toEqual({ width: 'two-thirds', grow: true });
    expect(Object.keys(table)).toEqual(['id', 'type', 'sizing', 'props', 'children']);
  });

  it('stores no sizing key for a spec without one', async () => {
    const imp = await req('post', '/api/studio/apps/import').send({ spec: plain() });
    expect(imp.status).toBe(201);
    const got = await req('get', `/api/studio/apps/${imp.body.data.id}`);
    expect(JSON.stringify(got.body.data.spec)).not.toContain('"sizing"');
  });

  it('keeps an explicit full block as written', async () => {
    const imp = await req('post', '/api/studio/apps/import').send({ spec: withSizing(undefined, { width: 'full', grow: false }) });
    expect(imp.status).toBe(201);
    const got = await req('get', `/api/studio/apps/${imp.body.data.id}`);
    expect(got.body.data.spec.pages[0].layout.children[1].sizing).toEqual({ width: 'full', grow: false });
  });

  it('refuses a bad block with 400 and the path', async () => {
    const extra = await req('post', '/api/studio/apps/import').send({ spec: withSizing(undefined, { width: 'half', basis: '50%' }) });
    expect(extra.status).toBe(400);
    expect(extra.body.code).toBe('invalid_spec');
    expect(JSON.stringify(extra.body)).toContain('pages.0.layout.children.1.sizing');
    const root = plain();
    root.pages[0].layout.sizing = { width: 'half' };
    const onRoot = await req('post', '/api/studio/apps/import').send({ spec: root });
    expect(onRoot.status).toBe(400);
    expect(JSON.stringify(onRoot.body)).toContain('pages.0.layout.sizing');
    expect(JSON.stringify(onRoot.body)).toContain('sizing_not_allowed');
  });
});
