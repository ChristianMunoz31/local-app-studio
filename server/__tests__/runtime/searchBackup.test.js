// The full text index through a backup and a restore (ADR-016). The index is an external content table that points at the
// rowids of its table, and VACUUM INTO (the backup) is not promised to keep rowids, so this test pins that a backup with
// gaps in its rowids comes back with an index that passes FTS5's own integrity check and answers like the LIKE path.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Set before any import (a module reads the app mode and spec when it loads), so it must run synchronously: no dynamic import here.
vi.hoisted(() => {
  const path = process.getBuiltinModule('node:path');
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json');
});

import { countSearch, getDb, insertMany, remove, select, selectSearch, update } from '../../db/index.js';
import { createBackup } from '../../backup/service.js';
import { backupFile, cleanupBackupEnv, day, resetBackupEnv, runBackupsOnMainThread } from '../helpers/backupEnv.js';
import { restoreBackup } from '../../backup/restore.js';
import { inspectDbFile } from '../../backup/snapshot.js';

runBackupsOnMainThread();
beforeEach(() => {
  resetBackupEnv();
});
afterAll(() => {
  cleanupBackupEnv();
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
});

const COLUMNS = ['name'];
const BY_ROWID = [{ column: 'rowid' }];
const integrity = () => getDb().exec('INSERT INTO "fts:crews"("fts:crews", rank) VALUES(\'integrity-check\', 1)');
const answers = (term) => {
  const search = { term, columns: COLUMNS };
  return {
    fts: selectSearch('crews', { search, orderBy: BY_ROWID }).map((r) => r.name),
    like: select('crews', { search, orderBy: BY_ROWID }).map((r) => r.name),
    total: countSearch('crews', { search }),
  };
};

function seed() {
  insertMany(
    'crews',
    Array.from({ length: 80 }, (_, i) => ({ name: `Crew ${String(i).padStart(2, '0')} ${i % 5 === 0 ? 'roofing' : 'plumbing'}` })),
  );
  // Gaps in the rowids: the first and every third row go, then some are edited.
  for (let i = 0; i < 80; i += 3) remove('crews', { where: { name: `Crew ${String(i).padStart(2, '0')} ${i % 5 === 0 ? 'roofing' : 'plumbing'}` } });
  update('crews', { name: 'Crew 01 renamed hangar' }, { where: { name: 'Crew 01 plumbing' } });
}

describe('backup and restore keep the index consistent', () => {
  it('the live index passes the integrity check before the backup', () => {
    seed();
    integrity();
    expect(answers('roofing').fts).toEqual(answers('roofing').like);
  });

  it('a restored backup has an index that passes the integrity check and answers like the LIKE path', async () => {
    seed();
    const terms = ['roofing', 'plumbing', 'crew 1', 'renamed', 'hangar', 'crew 5', 'zzz'];
    const before = Object.fromEntries(terms.map((t) => [t, answers(t)]));
    expect(before.roofing.fts.length).toBeGreaterThan(5);
    const backup = (await createBackup({ kind: 'manual', now: day(1) })).meta;
    expect(inspectDbFile(backupFile(backup.id, '.db'))).toMatchObject({ integrityOk: true, shapeOk: true });

    // Change everything, then bring the backup back.
    remove('crews', { where: { name: 'Crew 02 plumbing' } });
    insertMany('crews', Array.from({ length: 30 }, (_, i) => ({ name: `Later ${i} roofing` })));
    const result = await restoreBackup({ id: backup.id, now: day(2) });
    expect(result.restoredFrom).toBe(backup.id);

    integrity();
    for (const t of terms) {
      const now = answers(t);
      expect(now.fts, t).toEqual(now.like);
      expect(now, t).toEqual(before[t]);
    }
    // The triggers are still in the restored file.
    insertMany('crews', [{ name: 'After restore roofing' }]);
    expect(answers('after restore').fts).toEqual(['After restore roofing']);
    remove('crews', { where: { name: 'After restore roofing' } });
    expect(answers('after restore').fts).toEqual([]);
    integrity();
  });

  // restore.js runs migrate() with PRAGMA trusted_schema = OFF; SQLite then refuses a trigger that uses a virtual table that is
  // not innocuous ("unsafe use of virtual table"). FTS5 is innocuous, and this pins that the three triggers keep working that way.
  it('the index triggers work with trusted_schema OFF: insert, update and delete raise no unsafe virtual table error', () => {
    const db = getDb();
    db.exec('PRAGMA trusted_schema = OFF');
    try {
      expect(Object.values(db.prepare('PRAGMA trusted_schema').get())[0]).toBe(0);
      expect(() => insertMany('crews', [{ name: 'Untrusted roofing' }, { name: 'Untrusted plumbing' }])).not.toThrow();
      expect(answers('untrusted roof').fts).toEqual(['Untrusted roofing']);
      expect(() => update('crews', { name: 'Untrusted hangar' }, { where: { name: 'Untrusted roofing' } })).not.toThrow();
      expect(answers('untrusted roof').fts).toEqual([]);
      expect(answers('untrusted hang').fts).toEqual(['Untrusted hangar']);
      expect(() => remove('crews', { where: { name: 'Untrusted hangar' } })).not.toThrow();
      expect(answers('untrusted hang').fts).toEqual([]);
      integrity();
    } finally {
      db.exec('PRAGMA trusted_schema = ON');
    }
  });
});
