// Export -> import round trip, dry run, orphan handling, and archive validation. Everything runs
// on real in-memory SQLite databases.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
vi.mock('../modules/studio.data.js', (importOriginal) => import('./helpers/probeTable.js').then((m) => m.withProbeTable(importOriginal)));
import { strToU8, zipSync } from 'fflate';
import { IMPORT_ORDER, TABLES, insertMany, openDb } from '../db/index.js';
import { buildExportZip } from '../exportRoutes.js';
import { ImportError, importZipBuffer, parseExportZip } from '../import/importExport.js';
import { PROBE_DDL } from './helpers/probeTable.js';
import { closeTestDb, createTestDb, resetDb, rowsOf, seedDb } from './helpers/testDb.js';

let src;
let dest;

beforeAll(() => {
  src = createTestDb();
  dest = openDb({ filename: ':memory:' });
  dest.exec(PROBE_DDL);
});
beforeEach(() => {
  resetDb(src);
  resetDb(dest);
});
afterAll(() => {
  closeTestDb(src);
  dest.close();
});

const byPk = (table) => (a, b) => String(a[TABLES[table].primaryKey]).localeCompare(String(b[TABLES[table].primaryKey]));
const sortedRows = (db, table) => rowsOf(db, table).sort(byPk(table));
const counts = (db) => Object.fromEntries(IMPORT_ORDER.map((t) => [t, rowsOf(db, t).length]));

/** Builds an archive with the given manifest fields and table contents. */
function makeZip({ manifest = {}, tables = {}, extra = {} } = {}) {
  const files = {
    'manifest.json': strToU8(
      JSON.stringify({
        format: 'local-app-studio-export',
        formatVersion: 1,
        exportedAt: '2026-05-01T00:00:00.000Z',
        tables: Object.keys(tables).map((id) => ({ id })),
        ...manifest,
      }),
    ),
    ...extra,
  };
  for (const [id, rows] of Object.entries(tables)) {
    files[`json/${id}.json`] = strToU8(typeof rows === 'string' ? rows : JSON.stringify(rows));
  }
  return zipSync(files);
}

function seedEverything(db) {
  const convId = randomUUID();
  return seedDb(db, {
    probe_items: [
      { name: 'Desk, "lamp"', category: 'office', quantity: 2, unit_cost: 12.5, status: 'active', notes: 'multi\nline', created_at: '2026-01-02T03:04:05.123Z' },
      { name: 'Kettle', category: 'kitchen', quantity: 1, unit_cost: 30, status: 'done', created_at: '2026-01-03T00:00:00.000Z' },
      { name: 'Plain' },
    ],
    app_state: [
      { key: 'theme', value: 'dark' },
      { key: 'sidebar', value: { collapsed: true, items: [1, 2] } },
      { key: 'openai_api_key', value: 'sk-abcdefghijklmnop' },
    ],
    assistant_conversations: [{ id: convId, title: 'Chat' }],
    assistant_messages: [
      { conversation_id: convId, role: 'user', content: 'hi' },
      { conversation_id: convId, role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'x', arguments: '{}' } }] },
    ],
  });
}

describe('export -> import round trip', () => {
  it('restores every table into a fresh database (minus redacted app_state rows)', async () => {
    seedEverything(src);
    const { zip } = await buildExportZip({ db: src });
    const result = importZipBuffer(zip, { db: dest });

    expect(result).toMatchObject({ format: 'local-app-studio-export', formatVersion: 1, dryRun: false });
    expect(result.ignoredTables).toEqual([]);
    expect(result.tables.map((t) => t.id)).toEqual(IMPORT_ORDER);

    for (const table of IMPORT_ORDER) {
      let expected = sortedRows(src, table);
      if (table === 'app_state') expected = expected.filter((r) => r.key !== 'openai_api_key');
      expect(sortedRows(dest, table), table).toEqual(expected);
    }
    const appState = result.tables.find((t) => t.id === 'app_state');
    expect(appState).toMatchObject({ received: 3, inserted: 2, skipped: 1 });
    expect(appState.skippedReasons.redacted).toBe(1);
    expect(result.totals.skipped).toBe(1);
    expect(result.totals.updated).toBe(0);
  });

  it('is idempotent: a second import updates every row and duplicates nothing', async () => {
    seedEverything(src);
    const { zip } = await buildExportZip({ db: src });
    const first = importZipBuffer(zip, { db: dest });
    const before = counts(dest);
    const second = importZipBuffer(zip, { db: dest });
    expect(counts(dest)).toEqual(before);
    expect(second.totals.inserted).toBe(0);
    expect(second.totals.updated).toBe(first.totals.inserted);
  });

  it('overwrites a local row with the same id and keeps local-only rows', async () => {
    seedDb(src, { probe_items: [{ id: 'same', name: 'from export' }] });
    const { zip } = await buildExportZip({ db: src });
    seedDb(dest, { probe_items: [{ id: 'same', name: 'edited locally' }, { id: 'local-only', name: 'mine' }] });
    const result = importZipBuffer(zip, { db: dest });
    expect(result.tables.find((t) => t.id === 'probe_items')).toMatchObject({ inserted: 0, updated: 1 });
    const rows = sortedRows(dest, 'probe_items');
    expect(rows.map((r) => [r.id, r.name])).toEqual([
      ['local-only', 'mine'],
      ['same', 'from export'],
    ]);
  });

  it('imports a per-table ZIP and touches only that table', async () => {
    seedEverything(src);
    const { zip } = await buildExportZip({ db: src, tables: ['probe_items'] });
    const result = importZipBuffer(zip, { db: dest });
    expect(result.tables.map((t) => t.id)).toEqual(['probe_items']);
    expect(counts(dest).probe_items).toBe(3);
    expect(counts(dest).assistant_conversations).toBe(0);
  });

  it('ignores markdown/ and csv/ entries, even malformed ones', async () => {
    seedEverything(src);
    const { zip } = await buildExportZip({ db: src, tables: ['probe_items'] });
    const result = importZipBuffer(zip, { db: dest });
    expect(result.totals.inserted).toBe(3);
    const garbage = makeZip({
      tables: { probe_items: [{ id: 'n1', name: 'x' }] },
      extra: {
        'markdown/probe_items/zzz.md': strToU8('not an import'),
        'csv/probe_items.csv': strToU8('id,name\r\nBOGUS,BOGUS'),
        '../escape.json': strToU8('[]'),
      },
    });
    expect(importZipBuffer(garbage, { db: dest }).totals.inserted).toBe(1);
    expect(rowsOf(dest, 'probe_items').some((r) => r.name === 'BOGUS')).toBe(false);
  });

  it('keeps types exact: integers, reals, text with newlines and timestamps survive unchanged', async () => {
    seedEverything(src);
    const { zip } = await buildExportZip({ db: src });
    importZipBuffer(zip, { db: dest });
    const lamp = rowsOf(dest, 'probe_items').find((r) => r.name === 'Desk, "lamp"');
    expect(lamp).toMatchObject({ quantity: 2, unit_cost: 12.5, notes: 'multi\nline', created_at: '2026-01-02T03:04:05.123Z' });
  });
});

describe('skips and orphans', () => {
  it('skips orphans and reports reasons', () => {
    const zip = makeZip({
      tables: {
        assistant_conversations: [{ id: 'conv1', title: 'x' }],
        assistant_messages: [
          { id: 'm1', conversation_id: 'conv1', role: 'user', content: 'hi' },
          { id: 'm2', conversation_id: 'ghost', role: 'user', content: 'lost' },
        ],
      },
    });
    const result = importZipBuffer(zip, { db: dest });
    const messages = result.tables.find((x) => x.id === 'assistant_messages');
    expect(messages).toMatchObject({ inserted: 1, skipped: 1 });
    expect(messages.skippedReasons.orphan).toBe(1);
  });

  it('accepts a child whose parent exists in the database but not in the archive', () => {
    seedDb(dest, { assistant_conversations: [{ id: 'conv-local', title: 'Local' }] });
    const zip = makeZip({ tables: { assistant_messages: [{ id: 'm1', conversation_id: 'conv-local', role: 'user', content: 'hi' }] } });
    expect(importZipBuffer(zip, { db: dest }).totals.inserted).toBe(1);
  });

  it('skips a row that breaks a table rule (a negative quantity, an unknown status) as invalid', () => {
    const zip = makeZip({
      tables: {
        probe_items: [
          { id: 'ok', name: 'fine', quantity: 2 },
          { id: 'neg', name: 'bad', quantity: -4 },
          { id: 'status', name: 'bad', status: 'later' },
          { id: 'noname' },
        ],
      },
    });
    const result = importZipBuffer(zip, { db: dest });
    expect(result.tables[0]).toMatchObject({ received: 4, inserted: 1, skipped: 3 });
    expect(result.tables[0].skippedReasons.invalid).toBe(3);
    expect(rowsOf(dest, 'probe_items').map((r) => r.id)).toEqual(['ok']);
  });

  it('nulls an unreadable nullable value but never overwrites a good local value with it', () => {
    seedDb(dest, { assistant_conversations: [{ id: 'conv1', title: 'keep me' }] });
    const zip = makeZip({ tables: { assistant_conversations: [{ id: 'conv1', title: { not: 'text' } }] } });
    const result = importZipBuffer(zip, { db: dest });
    expect(result.tables[0].invalidValues).toBe(1);
    expect(rowsOf(dest, 'assistant_conversations')[0].title).toBe('keep me');
  });

  it('skips rows without a primary key and non-object rows', () => {
    const zip = makeZip({ tables: { probe_items: [{ name: 'no id' }, { id: '', name: 'blank' }, { id: null, name: 'null' }, 5, { id: 'ok', name: 'fine' }] } });
    const result = importZipBuffer(zip, { db: dest });
    const items = result.tables[0];
    expect(items).toMatchObject({ received: 5, inserted: 1, skipped: 4 });
    expect(items.skippedReasons).toEqual({ invalid: 1, orphan: 0, redacted: 0, missing_id: 3, protected: 0 });
    expect(rowsOf(dest, 'probe_items').map((r) => r.id)).toEqual(['ok']);
  });

  it('skips app_state rows containing the redaction marker at any depth and keeps real ones', () => {
    seedDb(dest, { app_state: [{ key: 'theme', value: 'dark' }] });
    const zip = makeZip({
      tables: {
        app_state: [
          { key: 'theme', value: '[redacted]' },
          { key: 'a', value: { x: { y: ['ok', '[redacted]'] } } },
          { key: 'b', value: 'prefix [redacted] suffix' },
          { key: 'c', value: { fine: true } },
        ],
      },
    });
    const result = importZipBuffer(zip, { db: dest });
    expect(result.tables[0]).toMatchObject({ inserted: 1, skipped: 3 });
    expect(result.tables[0].skippedReasons.redacted).toBe(3);
    expect(rowsOf(dest, 'app_state').map((r) => [r.key, r.value])).toEqual([
      ['theme', 'dark'],
      ['c', { fine: true }],
    ]);
  });

  it('round-trips a studio.* app_state row (export then import restores it)', async () => {
    const layout = { id: 'root', type: 'Page', props: { width: 'wide' }, children: [{ id: 'h', type: 'Heading', props: { size: 'lg' }, children: 'Crews' }] };
    seedDb(src, { app_state: [{ key: 'studio.example', value: layout }] });
    const { zip } = await buildExportZip({ db: src });
    const result = importZipBuffer(zip, { db: dest });
    expect(result.tables.find((t) => t.id === 'app_state').skippedReasons.protected).toBe(0);
    expect(rowsOf(dest, 'app_state').find((r) => r.key === 'studio.example').value).toEqual(layout);
  });

  it('never imports app_secrets or audit_log and reports unknown or missing tables', () => {
    const secretRow = { name: 'AI_CLOUD_API_KEY', ciphertext: 'c', iv: 'i', auth_tag: 't', last4: '1234' };
    const files = {
      'manifest.json': strToU8(
        JSON.stringify({
          format: 'local-app-studio-export',
          formatVersion: 1,
          tables: [{ id: 'app_secrets' }, { id: 'audit_log' }, { id: 'nope' }, { id: '__proto__' }, { id: 'probe_items' }, 'junk'],
        }),
      ),
      'json/app_secrets.json': strToU8(JSON.stringify([secretRow])),
      'json/audit_log.json': strToU8(JSON.stringify([{ id: 'a', kind: 'llm', feature: 'x' }])),
    };
    const result = importZipBuffer(zipSync(files), { db: dest });
    expect(result.ignoredTables).toEqual([
      { id: 'app_secrets', reason: 'not_importable' },
      { id: 'audit_log', reason: 'not_importable' },
      { id: 'nope', reason: 'unknown_table' },
      { id: '__proto__', reason: 'unknown_table' },
      { id: 'probe_items', reason: 'missing_file' },
    ]);
    expect(rowsOf(dest, 'app_secrets')).toHaveLength(0);
    expect(rowsOf(dest, 'audit_log')).toHaveLength(0);
  });
});

describe('dry run', () => {
  it('reports the same counts as a real run but writes nothing', async () => {
    seedEverything(src);
    const { zip } = await buildExportZip({ db: src });
    seedDb(dest, { probe_items: [{ id: 'keep', name: 'keep me' }] });
    const before = counts(dest);
    const dry = importZipBuffer(zip, { db: dest, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(counts(dest)).toEqual(before);
    const real = importZipBuffer(zip, { db: dest });
    expect(real.dryRun).toBe(false);
    expect({ ...dry, dryRun: undefined }).toEqual({ ...real, dryRun: undefined });
    expect(dry.totals.inserted).toBeGreaterThan(0);
  });

  it('leaves no open transaction behind', () => {
    const zip = makeZip({ tables: { probe_items: [{ id: 'n1', name: 'x' }] } });
    importZipBuffer(zip, { db: dest, dryRun: true });
    insertMany('probe_items', [{ id: 'after', name: 'works' }], { db: dest });
    expect(rowsOf(dest, 'probe_items').map((r) => r.id)).toEqual(['after']);
  });
});

describe('archive validation', () => {
  const expectCode = (fn, code) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect(e.code).toBe(code);
      return e;
    }
    throw new Error(`expected ${code}`);
  };

  it('rejects bytes that are not a ZIP', () => {
    expectCode(() => importZipBuffer(strToU8('definitely not a zip'), { db: dest }), 'invalid_archive');
    expectCode(() => importZipBuffer(new Uint8Array(0), { db: dest }), 'invalid_archive');
  });

  it('rejects a ZIP without a readable manifest', () => {
    expectCode(() => parseExportZip(zipSync({ 'json/probe_items.json': strToU8('[]') })), 'invalid_archive');
    expectCode(() => parseExportZip(zipSync({ 'manifest.json': strToU8('{oops') })), 'invalid_archive');
    expectCode(() => parseExportZip(zipSync({ 'manifest.json': strToU8('[]') })), 'invalid_archive');
    expectCode(() => parseExportZip(zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'local-app-studio-export', formatVersion: 1 })) })), 'invalid_archive');
  });

  it('rejects an unsupported format or version with status 400', () => {
    const zip = makeZip({ manifest: { format: 'something-else', formatVersion: 1 }, tables: { probe_items: [] } });
    const e = expectCode(() => importZipBuffer(zip, { db: dest }), 'unsupported_format');
    expect(e.status).toBe(400);
    expectCode(() => parseExportZip(makeZip({ manifest: { formatVersion: 2 }, tables: { probe_items: [] } })), 'unsupported_format');
  });

  it('rejects a table file that is not a JSON array', () => {
    expectCode(() => parseExportZip(makeZip({ tables: { probe_items: '{"id":"n1"}' } })), 'invalid_table_file');
    expectCode(() => parseExportZip(makeZip({ tables: { probe_items: 'not json' } })), 'invalid_table_file');
  });

  it('rejects an entry over 64 MiB with status 413', () => {
    const big = new Uint8Array(65 * 1024 * 1024);
    const withBig = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'local-app-studio-export', formatVersion: 1, tables: [{ id: 'probe_items' }] })),
      'json/probe_items.json': big,
    });
    const e = expectCode(() => parseExportZip(withBig), 'import_too_large');
    expect(e.status).toBe(413);
  });

  it('rejects an archive with more than 500 entries', () => {
    const files = { 'manifest.json': strToU8(JSON.stringify({ format: 'local-app-studio-export', formatVersion: 1, tables: [] })) };
    for (let i = 0; i < 501; i += 1) files[`markdown/f${i}.md`] = strToU8('x');
    expectCode(() => parseExportZip(zipSync(files)), 'import_too_large');
  });
});
