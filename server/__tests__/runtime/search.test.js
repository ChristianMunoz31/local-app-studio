// Full text search (ADR-016) on a built app: the FTS path and the LIKE path give the same rows and totals, the index stays in
// step through every write path (routes, CSV import, ZIP import), an app without the index keeps working on LIKE, the
// global search route, and a speed check. Real temp SQLite; the spec is made here (runtime mode, spec from APP_SPEC_PATH).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Set before any import (a module reads the app mode and spec when it loads), so it must run synchronously: no dynamic import here.
vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const page = (id, route, sources) => ({
    id,
    title: id,
    route,
    sources,
    layout: { id: 'root', type: 'Page', props: {}, children: [{ id: 'h1', type: 'Heading', props: { size: 'lg' }, children: id }] },
  });
  const spec = {
    specVersion: 1,
    app: { name: 'Search Test', slug: 'search-test', identifier: 'com.example.searchtest', version: '1.0.0', description: 'Search', icon: 'users' },
    tables: [
      {
        id: 'tickets',
        label: 'Tickets',
        titleField: 'title',
        fields: [
          { id: 'title', label: 'Title', type: 'text', required: true },
          { id: 'body', label: 'Body', type: 'longtext' },
          { id: 'status', label: 'Status', type: 'select', options: ['open', 'done'], default: 'open' },
          { id: 'score', label: 'Score', type: 'integer' },
        ],
      },
      {
        id: 'people',
        label: 'People',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text' },
          { id: 'city', label: 'City', type: 'text' },
        ],
      },
      { id: 'tags', label: 'Tags', fields: [{ id: 'label', label: 'Label', type: 'text' }] },
      { id: 'counters', label: 'Counters', fields: [{ id: 'n', label: 'N', type: 'integer' }] },
    ],
    pages: [
      page('home', '/', [
        { id: 'all_notes', table: 'tickets' },
        { id: 'all_tags', table: 'tags' },
      ]),
      page('ticket_page', '/tickets/:id', [{ id: 'one', table: 'tickets', mode: 'record' }]),
      page('person_page', '/people/:id', [{ id: 'one', table: 'people', mode: 'record' }]),
    ],
    nav: [{ pageId: 'home', label: 'Home', icon: 'home' }],
    theme: { preset: 'aurora', radius: 'md' },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-fts-'));
  const file = path.join(dir, 'app-spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { count, countSearch, hasFtsIndex, insertMany, select, selectSearch } from '../../db/index.js';
import { recreateFtsStatements } from '../../spec/fts.js';
import { getAppSpec } from '../../spec/source.js';
import { createPreviewProxy } from '../../studio/preview/proxy.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

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
beforeEach(() => resetDb(db));

const integrity = (table) => db.exec(`INSERT INTO "fts:${table}"("fts:${table}", rank) VALUES('integrity-check', 1)`);
const BY_ROWID = [{ column: 'rowid' }];
const NOTE_COLUMNS = ['title', 'body'];

/** A handle that records every statement, so a test can tell which path ran. */
const spied = (log) => ({
  prepare: (sql) => {
    log.push(sql);
    return db.prepare(sql);
  },
});
const usesIndex = (log) => log.some((sql) => sql.includes('MATCH'));
const expectsIndex = (term) => term.trim() !== '' && !term.includes('\u0000') && [...term].length >= 3;

// ---------------------------------------------------------------------------------------------
// A few hundred rows with the hard characters in them
// ---------------------------------------------------------------------------------------------

const WORDS = [
  'Alpha', 'béta', 'GAMMA', 'delta "quoted" text', 'star* wars', 'NEAR miss', 'a {brace} here', 'key:value pair', 'dash-ed word', 'OR gate',
  'AND then', 'NOT this', 'naïve café', 'İstanbul trip', 'Straße 12', 'ΟΔΟΣ road', '日本語テキスト', 'emoji 🙂 face', "o'neil's", '100% sure', 'under_score',
  'back\\slash', 'wrench set', 'Wrench Kit', 'plain words only', 'x', 'ab', 'NEAR(a b, 2)', 'a OR "b"', '(parens) [brackets]', 'tab\there', 'line\nbreak',
];

function seedNotes(n = 400) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const a = WORDS[i % WORDS.length];
    const b = WORDS[(i * 7 + 3) % WORDS.length];
    rows.push({
      title: `${a} ${i}`.slice(0, 500),
      body: i % 3 === 0 ? null : `${b} and ${WORDS[(i * 5) % WORDS.length]} #${i}`,
      status: i % 4 === 0 ? 'done' : 'open',
      score: i,
    });
  }
  insertMany('tickets', rows, { db });
}

const TERMS = [
  'alpha', 'ALPHA', 'alp', 'BÉTA', 'béta', 'beta', 'gam', 'delta "quoted"', '"', '"quoted', 'd "q', '""', 'star*', '*', 'wars', 'NEAR', 'near', 'NEAR(',
  'near miss', '{', '{brace}', 'a {b', ':', 'key:value', 'y:v', '-', 'dash-', 'sh-ed', 'OR', 'or ', ' OR ', 'AND', 'and then', 'NOT', 'not this', 'café',
  'CAFÉ', 'cafe', 'naïve', 'NAÏVE', 'İst', 'ist', 'istanbul', 'Straße', 'STRASSE', 'straße', 'ΟΔΟΣ', 'οδοσ', 'οδος', 'ΟΔΟ', '日本', '日本語', 'テキスト',
  '🙂 f', '🙂', "o'n", "'s", '%', '100%', '_u', 'under_', 'back\\', '\\s', 'wrench', 'WRENCH', 'wr', 'w', 'ab', 'xy', '', ' ', '   ', '  a', '\t', 'tab\th',
  'line\nb', '(par', '[brack', 'a OR "b"', 'OR "b"', 'x'.repeat(200), 'ñ'.repeat(3), '#12', '#1', ' #', 'and', 'a b', 'e  ', '\u0000', 'ab\u0000c', '%%%', '___', '**', 'a*',
];

describe('the FTS path and the LIKE path return the same rows and totals', () => {
  beforeEach(() => seedNotes());

  it('has the index and uses it exactly for terms of 3 or more characters', () => {
    expect(hasFtsIndex('tickets', { db })).toBe(true);
    expect(hasFtsIndex('tickets', { db, columns: NOTE_COLUMNS })).toBe(true);
    expect(hasFtsIndex('tickets', { db, columns: ['status'] })).toBe(false);
    expect(hasFtsIndex('counters', { db })).toBe(false);
    expect(count('tickets', { db })).toBe(400);
    integrity('tickets');
  });

  it.each(TERMS.map((t) => [JSON.stringify(t), t]))('term %s', (_label, term) => {
    for (const columns of [NOTE_COLUMNS, ['title'], ['body']]) {
      const search = { term, columns };
      const like = select('tickets', { search, orderBy: BY_ROWID, db });
      const log = [];
      const found = selectSearch('tickets', { search, orderBy: BY_ROWID, db: spied(log) });
      expect(found).toEqual(like);
      expect(usesIndex(log)).toBe(expectsIndex(term));
      const countLog = [];
      expect(countSearch('tickets', { search, db: spied(countLog) })).toBe(count('tickets', { search, db }));
      expect(usesIndex(countLog)).toBe(expectsIndex(term));
    }
  });

  it('keeps a filter, an order, a limit and an offset', () => {
    const search = { term: 'wrench', columns: NOTE_COLUMNS };
    for (const extra of [
      { where: { status: 'done' } },
      { where: { status: 'open' }, limit: 5 },
      { limit: 7, offset: 3 },
      { offset: 2 },
      { orderBy: [{ column: 'score', dir: 'desc' }, { column: 'id' }], limit: 4 },
      { columns: ['id', 'title'], limit: 3 },
    ]) {
      const opts = { search, orderBy: BY_ROWID, ...extra, db };
      expect(selectSearch('tickets', opts)).toEqual(select('tickets', opts));
      expect(countSearch('tickets', opts)).toBe(count('tickets', opts));
    }
    expect(select('tickets', { search, db }).length).toBeGreaterThan(10);
  });

  it('answers a hostile term as plain text, with the term only ever bound', () => {
    const log = [];
    const term = 'x" OR rowid > 0 OR "';
    expect(selectSearch('tickets', { search: { term, columns: NOTE_COLUMNS }, db: spied(log) })).toEqual([]);
    expect(log.filter((s) => s.includes('MATCH'))).toHaveLength(1);
    expect(log.some((s) => s.includes(term))).toBe(false);
  });

  it('refuses a column that is not a column of the table', () => {
    expect(() => selectSearch('tickets', { search: { term: 'wrench', columns: ['nope'] }, db })).toThrow(/unknown_column|Unknown column/i);
    expect(() => selectSearch('nope', { search: { term: 'wrench', columns: ['title'] }, db })).toThrow();
  });
});

describe('an app without the index (built before it)', () => {
  // The next tests need the index and its triggers back, as a migration that touches the table would make them.
  afterEach(() => {
    db.exec(recreateFtsStatements(getAppSpec().tables.find((t) => t.id === 'tickets')).join('\n'));
  });

  const dropIndex = () => {
    for (const k of ['ai', 'ad', 'au']) db.exec(`DROP TRIGGER IF EXISTS "fts:tickets:${k}"`);
    db.exec('DROP TABLE IF EXISTS "fts:tickets"');
  };

  it('notices the missing table, uses LIKE and answers the same', () => {
    seedNotes(120);
    const search = { term: 'wrench', columns: NOTE_COLUMNS };
    const withIndex = select('tickets', { search, orderBy: BY_ROWID, db });
    expect(hasFtsIndex('tickets', { db })).toBe(true);
    dropIndex();
    expect(hasFtsIndex('tickets', { db })).toBe(false);
    const log = [];
    expect(selectSearch('tickets', { search, orderBy: BY_ROWID, db: spied(log) })).toEqual(withIndex);
    expect(usesIndex(log)).toBe(false);
    expect(countSearch('tickets', { search, db })).toBe(withIndex.length);
  });

  it('the data routes and the global search keep working', async () => {
    seedNotes(60);
    dropIndex();
    const list = await request(app).get('/api/data/tickets').query({ search: 'wrench', limit: 5 });
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(count('tickets', { search: { term: 'wrench', columns: NOTE_COLUMNS }, db }));
    const global = await request(app).get('/api/data/_search').query({ q: 'wrench' });
    expect(global.status).toBe(200);
    expect(global.body.data.groups[0]).toMatchObject({ table: 'tickets', total: list.body.data.total });
  });

  it('an index that comes back is noticed too', () => {
    dropIndex();
    expect(hasFtsIndex('tickets', { db })).toBe(false);
    db.exec(
      `CREATE VIRTUAL TABLE "fts:tickets" USING fts5("title", "body", content='tickets', content_rowid='rowid', tokenize='trigram case_sensitive 0');`,
    );
    expect(hasFtsIndex('tickets', { db })).toBe(true);
  });
});

describe('the triggers keep the index in step through every write path', () => {
  const found = (term, table = 'tickets') => {
    const columns = table === 'tickets' ? NOTE_COLUMNS : ['name', 'city'];
    return selectSearch(table, { search: { term, columns }, orderBy: BY_ROWID, db });
  };
  const same = (term, table = 'tickets') => {
    const columns = table === 'tickets' ? NOTE_COLUMNS : ['name', 'city'];
    expect(found(term, table)).toEqual(select(table, { search: { term, columns }, orderBy: BY_ROWID, db }));
  };

  it('create, edit and delete through the routes', async () => {
    const made = (await request(app).post('/api/data/tickets').send({ title: 'Broken hinge', body: 'door will not close' })).body.data;
    expect(found('hinge').map((r) => r.id)).toEqual([made.id]);
    expect(found('close').map((r) => r.id)).toEqual([made.id]);
    await request(app).patch(`/api/data/tickets/${made.id}`).send({ title: 'Fixed latch' });
    expect(found('hinge')).toEqual([]);
    expect(found('latch').map((r) => r.id)).toEqual([made.id]);
    await request(app).patch(`/api/data/tickets/${made.id}`).send({ score: 5 });
    expect(found('latch')).toHaveLength(1);
    await request(app).delete(`/api/data/tickets/${made.id}`);
    expect(found('latch')).toEqual([]);
    expect(found('close')).toEqual([]);
    integrity('tickets');
  });

  it('CSV import (a real run)', async () => {
    const csv = ['Title,Body,Status,Score', 'Ladder rental,"two, long ones",open,1', 'Paint order,"white, 5 gallons",done,2', 'Ladder repair,,open,3'].join('\n');
    const res = await request(app).post('/api/data/tickets/import').set('X-Forwarded-For', '10.31.0.1').send({ csv, dryRun: false });
    expect(res.status).toBe(200);
    expect(count('tickets', { db })).toBe(3);
    expect(found('ladder')).toHaveLength(2);
    expect(found('gallons')).toHaveLength(1);
    same('ladder');
    same('white, 5');
    integrity('tickets');
    const dry = await request(app).post('/api/data/tickets/import').set('X-Forwarded-For', '10.31.0.1').send({ csv: 'Title\nDry run only' });
    expect(dry.body.data.dryRun).toBe(true);
    expect(found('dry run')).toEqual([]);
    integrity('tickets');
  });

  it('ZIP import after an export, and a delete of everything before it', async () => {
    insertMany('tickets', [{ title: 'Alpha zip', body: 'first body' }, { title: 'Beta zip', body: null }, { title: 'Gamma', body: 'zip inside' }], { db });
    const binary = (res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const exported = await request(app).post('/api/export').send({ tables: ['tickets'] }).buffer(true).parse(binary);
    expect(exported.status).toBe(200);
    resetDb(db);
    expect(found('zip')).toEqual([]);
    integrity('tickets');
    const imported = await request(app).post('/api/import').set('Content-Type', 'application/zip').send(Buffer.from(exported.body));
    expect(imported.status).toBe(200);
    expect(count('tickets', { db })).toBe(3);
    expect(found('zip')).toHaveLength(3);
    same('zip');
    same('body');
    integrity('tickets');
  });

  it('every table has its own index and a table with no text field has none', () => {
    insertMany('people', [{ name: 'Ann Lee', city: 'Oslo' }, { name: 'Bo', city: 'Rome' }], { db });
    insertMany('tags', [{ label: 'urgent' }], { db });
    expect(found('oslo', 'people')).toHaveLength(1);
    same('Ann', 'people');
    expect(hasFtsIndex('people', { db })).toBe(true);
    expect(hasFtsIndex('tags', { db })).toBe(true);
    expect(hasFtsIndex('counters', { db })).toBe(false);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'fts:counters'").get()).toBeUndefined();
    integrity('people');
    integrity('tags');
  });
});

describe('GET /api/data/:table with a search', () => {
  it('lists the same page and total as the LIKE path would, with the usual response shape', async () => {
    seedNotes(300);
    const res = await request(app).get('/api/data/tickets').query({ search: 'wrench', limit: 10, offset: 2, sort: 'score:asc' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const search = { term: 'wrench', columns: NOTE_COLUMNS };
    expect(res.body.data).toMatchObject({ total: count('tickets', { search, db }), limit: 10, offset: 2 });
    expect(res.body.data.rows.map((r) => r.id)).toEqual(
      select('tickets', { search, orderBy: [{ column: 'score', nocase: false, dir: 'asc' }, { column: 'id' }], limit: 10, offset: 2, db }).map((r) => r.id),
    );
    const narrowed = await request(app).get('/api/data/tickets').query({ search: 'wrench', searchFields: 'title' });
    expect(narrowed.body.data.total).toBe(count('tickets', { search: { term: 'wrench', columns: ['title'] }, db }));
    const short = await request(app).get('/api/data/tickets').query({ search: 'wr' });
    expect(short.body.data.total).toBe(count('tickets', { search: { term: 'wr', columns: NOTE_COLUMNS }, db }));
  });
});

describe('GET /api/data/_search', () => {
  const seedGlobal = () => {
    insertMany(
      'tickets',
      Array.from({ length: 8 }, (_, i) => ({ title: `Wrench note ${i}`, body: i === 0 ? 'wrench in the body' : null })),
      { db },
    );
    insertMany('people', [{ name: 'Wrenn Smith', city: 'Oslo' }, { name: null, city: 'Wrenchton' }, { name: 'Zed', city: 'Rome' }], { db });
    insertMany('tags', [{ label: 'wrench' }], { db });
    insertMany('counters', [{ n: 3 }], { db });
  };

  it('answers groups in spec order, five rows at most, with the real total and the title field', async () => {
    seedGlobal();
    const res = await request(app).get('/api/data/_search').query({ q: 'wrench' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body)).toEqual(['data']);
    const { groups } = res.body.data;
    expect(groups.map((g) => g.table)).toEqual(['tickets', 'people']);
    const [tickets, people] = groups;
    expect(tickets).toMatchObject({ table: 'tickets', label: 'Tickets', pageId: 'ticket_page', total: 8 });
    expect(tickets.rows).toHaveLength(5);
    expect(Object.keys(tickets.rows[0]).sort()).toEqual(['id', 'title']);
    for (const row of tickets.rows) expect(row.title).toMatch(/^Wrench note \d$/);
    expect(new Set(tickets.rows.map((r) => r.id)).size).toBe(5);
    expect(people).toMatchObject({ table: 'people', label: 'People', pageId: 'person_page', total: 1 });
    // The person with no name matched on the city: the title falls back to the id.
    expect(people.rows).toHaveLength(1);
    expect(people.rows[0].title).toBe(people.rows[0].id);
    expect(people.rows[0].id).toBe(select('people', { where: { city: 'Wrenchton' }, db })[0].id);
  });

  it('newest first, like the list', async () => {
    insertMany('tickets', [{ title: 'first wrench' }], { db });
    db.exec("UPDATE tickets SET created_at = '2020-01-01T00:00:00.000Z'");
    insertMany('tickets', [{ title: 'second wrench' }], { db });
    const res = await request(app).get('/api/data/_search').query({ q: 'wrench' });
    expect(res.body.data.groups[0].rows.map((r) => r.title)).toEqual(['second wrench', 'first wrench']);
  });

  it('leaves out tables with no record page, tables with no text field, empty groups and the kit tables', async () => {
    seedGlobal();
    const none = await request(app).get('/api/data/_search').query({ q: 'zzzzqqq' });
    expect(none.body).toEqual({ data: { groups: [] } });
    const res = await request(app).get('/api/data/_search').query({ q: 'wrench' });
    const tables = res.body.data.groups.map((g) => g.table);
    expect(tables).not.toContain('tags');
    expect(tables).not.toContain('counters');
    for (const kit of ['app_state', 'app_secrets', 'audit_log', 'assistant_messages']) expect(tables).not.toContain(kit);
    const onlyPeople = await request(app).get('/api/data/_search').query({ q: 'zed' });
    expect(onlyPeople.body.data.groups.map((g) => g.table)).toEqual(['people']);
  });

  it('an empty, missing or blank q gives empty groups', async () => {
    seedGlobal();
    for (const url of ['/api/data/_search', '/api/data/_search?q=', '/api/data/_search?q=%20%20%20']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { groups: [] } });
    }
  });

  it('checks q like search: text of at most 200 characters', async () => {
    const ok = await request(app).get('/api/data/_search').query({ q: 'a'.repeat(200) });
    expect(ok.status).toBe(200);
    const long = await request(app).get('/api/data/_search').query({ q: 'a'.repeat(201) });
    expect(long.status).toBe(400);
    expect(long.body).toMatchObject({ code: 'invalid_query', field: 'q' });
    expect(typeof long.body.error).toBe('string');
    expect(long.headers['cache-control']).toBe('no-store');
    const twice = await request(app).get('/api/data/_search?q=a&q=b');
    expect(twice.status).toBe(400);
    expect(twice.body).toMatchObject({ code: 'invalid_query', field: 'q' });
    const nested = await request(app).get('/api/data/_search?q[a]=b');
    expect(nested.status).toBe(400);
  });

  it('a term of under 3 characters (trimmed, in code points) gives empty groups and touches no table', async () => {
    insertMany('people', [{ name: 'Al', city: 'Oslo' }, { name: 'Bob', city: 'Rome' }], { db });
    for (const q of ['al', 'a', ' al ', '\u{1F642}\u{1F642}']) {
      const res = await request(app).get('/api/data/_search').query({ q });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { groups: [] } });
    }
    const three = await request(app).get('/api/data/_search').query({ q: 'bob' });
    expect(three.body.data.groups).toHaveLength(1);
    expect(three.body.data.groups[0].rows.map((r) => r.title)).toEqual(['Bob']);
  });

  it('a quote and the FTS operators in q are plain text', async () => {
    insertMany(
      'tickets',
      [
        { title: 'say "hi" OR leave' },
        { title: 'NEAR(a b)' },
        { title: 'star* gazing' },
        { title: 'a {b} c: d - e' },
        { title: 'plain note' },
        { title: 'other note' },
      ],
      { db },
    );
    const titles = async (q) => {
      const res = await request(app).get('/api/data/_search').query({ q });
      expect(res.status).toBe(200);
      return (res.body.data.groups[0]?.rows ?? []).map((r) => r.title).sort();
    };
    expect(await titles('"hi" OR')).toEqual(['say "hi" OR leave']);
    expect(await titles('hi" OR "x')).toEqual([]);
    expect(await titles('" OR "')).toEqual([]);
    expect(await titles('NEAR(a b)')).toEqual(['NEAR(a b)']);
    expect(await titles('star*')).toEqual(['star* gazing']);
    expect(await titles('plain OR other')).toEqual([]);
    expect(await titles('note NOT plain')).toEqual([]);
    expect(await titles('{b} c: d')).toEqual(['a {b} c: d - e']);
    expect(await titles('c: d - e')).toEqual(['a {b} c: d - e']);
    expect(await titles('title : note')).toEqual([]);
    expect(await titles('note')).toEqual(['other note', 'plain note']);
  });

  it('is not taken for a table, and a table id never starts with an underscore', async () => {
    const res = await request(app).get('/api/data/_search').query({ q: 'x' });
    expect(res.body.code).toBeUndefined();
    expect((await request(app).get('/api/data/_search/stats')).body.code).toBe('unknown_table');
    expect((await request(app).get('/api/data/_other')).body.code).toBe('unknown_table');
  });

  it('passes the Studio preview proxy to the child like the other data routes', async () => {
    const seen = [];
    const child = http.createServer((req, res) => {
      seen.push(req.url);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { groups: [] } }));
    });
    await new Promise((resolve) => child.listen(0, '127.0.0.1', resolve));
    try {
      const proxy = express();
      proxy.use('/api/preview', createPreviewProxy({ getTarget: () => ({ port: child.address().port, cookie: 'c' }) }));
      const res = await request(proxy).get('/api/preview/data/_search?q=a%20%22b');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { groups: [] } });
      expect(seen).toEqual(['/api/data/_search?q=a%20%22b']);
    } finally {
      await new Promise((resolve) => child.close(resolve));
    }
  });
});

describe('speed on 10 000 rows', () => {
  it('answers a 4 letter term faster through the index than through LIKE (times are printed; only a generous bound is asserted)', () => {
    const rowsAt = 10_000;
    const insertStmt = db.prepare('INSERT INTO "tickets" ("id","title","body","status","score","created_at","updated_at") VALUES (?,?,?,?,?,?,?)');
    const syllables = ['ka', 'lo', 'mi', 'ra', 'te', 'su', 'vo', 'ne', 'di', 'pa', 'xu', 'bo'];
    let seed = 12345;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const word = () => Array.from({ length: 2 + rand(3) }, () => syllables[rand(syllables.length)]).join('');
    db.exec('BEGIN');
    for (let i = 0; i < rowsAt; i += 1) {
      const body = Array.from({ length: 12 }, word).join(' ');
      const title = `${word()} ${word()} ${i % 97 === 0 ? 'zorbit' : word()}`;
      insertStmt.run(`id-${i}`, title, body, 'open', i, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    }
    db.exec('COMMIT');
    integrity('tickets');
    const search = { term: 'zorb', columns: NOTE_COLUMNS };
    const order = [{ column: 'created_at', dir: 'desc' }, { column: 'id' }];
    const asLike = () => ({ rows: select('tickets', { search, orderBy: order, limit: 50, db }), total: count('tickets', { search, db }) });
    const asFts = () => ({ rows: selectSearch('tickets', { search, orderBy: order, limit: 50, db }), total: countSearch('tickets', { search, db }) });
    expect(asFts()).toEqual(asLike());
    expect(asFts().total).toBe(Math.ceil(rowsAt / 97));
    const time = (fn) => {
      const runs = [];
      for (let i = 0; i < 7; i += 1) {
        const t0 = performance.now();
        fn();
        runs.push(performance.now() - t0);
      }
      return runs.sort((a, b) => a - b)[3];
    };
    const likeMs = time(asLike);
    const ftsMs = time(asFts);
    process.stdout.write(`search speed, ${rowsAt} rows, term "zorb": LIKE ${likeMs.toFixed(2)} ms, FTS ${ftsMs.toFixed(2)} ms (median of 7, rows and total)\n`);
    expect(ftsMs).toBeLessThan(likeMs * 4 + 25);
  });
});
