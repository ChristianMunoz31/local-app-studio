// Export then import keeps 'set null' and 'restrict' foreign keys: an optional reference to a missing parent is
// cleared, a required one is skipped as an orphan.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const specFile = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const fixture = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
  const spec = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  spec.tables.push({
    id: 'jobs',
    label: 'Jobs',
    fields: [
      { id: 'title', label: 'Title', type: 'text', required: true },
      { id: 'crew_id', label: 'Crew', type: 'reference', table: 'crews', required: true },
    ],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-importfk-'));
  const file = path.join(dir, 'spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  return file;
});
afterAll(() => {
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
});

const { strToU8, zipSync } = await import('fflate');
const { insertMany, openDb } = await import('../../db/index.js');
const { buildExportZip } = await import('../../exportRoutes.js');
const { importZipBuffer } = await import('../../import/importExport.js');
const { closeTestDb, createTestDb, resetDb, rowsOf } = await import('../helpers/testDb.js');

const src = createTestDb();
const dest = openDb({ filename: ':memory:' });
afterAll(() => {
  closeTestDb(src);
  dest.close();
});
beforeEach(() => {
  resetDb(src);
  resetDb(dest);
});

const stamp = '2026-01-01T00:00:00.000Z';
function makeZip(tables) {
  const files = {
    'manifest.json': strToU8(
      JSON.stringify({
        format: 'local-app-studio-export',
        formatVersion: 1,
        exportedAt: stamp,
        tables: Object.keys(tables).map((id) => ({ id })),
      }),
    ),
  };
  for (const [id, rows] of Object.entries(tables)) files[`json/${id}.json`] = strToU8(JSON.stringify(rows));
  return zipSync(files);
}
const crewRow = (id, extra) => ({ id, name: id, size: 1, status: 'active', created_at: stamp, updated_at: stamp, ...extra });

describe('foreign keys through export and import', () => {
  it('a set null reference survives the round trip', async () => {
    insertMany('people', [{ id: 'p1', name: 'Ann' }], { db: src });
    insertMany('crews', [{ id: 'c1', name: 'Alpha', lead_id: 'p1' }, { id: 'c2', name: 'Beta' }], { db: src });
    const { zip } = await buildExportZip({ db: src });
    const result = importZipBuffer(zip, { db: dest });
    expect(result.tables.find((t) => t.id === 'crews')).toMatchObject({ inserted: 2, skipped: 0 });
    expect(rowsOf(dest, 'crews').map((r) => [r.id, r.lead_id])).toEqual([['c1', 'p1'], ['c2', null]]);
  });
});

describe('orphans', () => {
  it('an optional reference to a missing parent imports with the reference cleared', () => {
    const result = importZipBuffer(makeZip({ crews: [crewRow('c9', { lead_id: 'gone' })] }), { db: dest });
    expect(result.tables.find((t) => t.id === 'crews')).toMatchObject({ inserted: 1, skipped: 0 });
    expect(rowsOf(dest, 'crews')[0].lead_id).toBeNull();
  });

  it('a restrict reference to a missing parent is skipped as an orphan', () => {
    const job = { id: 'j1', title: 'Fix', crew_id: 'ghost', created_at: stamp, updated_at: stamp };
    const result = importZipBuffer(makeZip({ jobs: [job] }), { db: dest });
    const jobs = result.tables.find((t) => t.id === 'jobs');
    expect(jobs).toMatchObject({ inserted: 0, skipped: 1 });
    expect(jobs.skippedReasons.orphan).toBe(1);
    expect(specFile).toContain('spec.json');
  });

  it('a restrict reference to an existing parent round-trips', async () => {
    insertMany('crews', [{ id: 'c1', name: 'Alpha' }], { db: src });
    insertMany('jobs', [{ id: 'j1', title: 'Fix', crew_id: 'c1' }], { db: src });
    const { zip } = await buildExportZip({ db: src });
    importZipBuffer(zip, { db: dest });
    expect(rowsOf(dest, 'jobs').map((r) => r.crew_id)).toEqual(['c1']);
  });
});
