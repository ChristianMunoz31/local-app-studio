// The second backup location (server/backup/secondCopy.js): setting validation, the copy step after a
// verified backup, atomic temp-then-rename, failure classes through injected FsOps errors, retention that
// deletes only this install's files, folders inside the data folder, abort and timeout without waiting,
// the routes, the key across a restore and an import, and a restore from a file taken from the folder.
// Destinations are temp folders only; the local backups folder is checked byte for byte after every copy.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { strToU8, zipSync } from 'fflate';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../db/index.js';
import { getState, setState } from '../dataAccess.js';
import { importZipBuffer } from '../import/importExport.js';
import { createFsOps } from '../backup/fsops.js';
import { restoreGateMiddleware } from '../backup/lock.js';
import { listMetas, readMeta, readState } from '../backup/manifest.js';
import { HIDDEN_APP_STATE_KEYS } from '../redact.js';
import { backupsDir } from '../backup/paths.js';
import { registerBackupRoutes } from '../backup/routes.js';
import { RESTORE_CARRY_KEYS, inspectUpload, restoreBackup } from '../backup/restore.js';
import {
  applyRetention,
  createBackup,
  getBackupStatus,
  isBackupDue,
  listBackupSummaries,
  runScheduledBackup,
  startBackupScheduler,
  stopBackupScheduler,
} from '../backup/service.js';
import { saveAutoBackup } from '../backup/settings.js';
import {
  COPY_ERROR_CODES,
  COPY_TIMEOUT_MS,
  COPY_TO_KEY,
  SAVE_INSPECT_TIMEOUT_MS,
  TEMP_MIN_AGE_MS,
  __resetSecondCopyForTests,
  abortSecondCopy,
  classifyCopyError,
  folderKeyOf,
  getCopyTo,
  getSecondCopyStatus,
  isSameOrInside,
  normalizeFolder,
  requestSecondCopy,
  resumeSecondCopy,
  saveCopyTo,
  validateCopyToInput,
  whenSecondCopyIdle,
} from '../backup/secondCopy.js';
import { PROTECTED_APP_STATE_KEYS } from '../import/importExport.js';
import { backupFile, cleanupBackupEnv, dataDir, day, fakeUploadReq, names, noSleep, resetBackupEnv, runBackupsOnMainThread } from './helpers/backupEnv.js';

const temps = [];
/** A fresh empty folder outside the data folder (real path, so path comparisons are exact). */
function makeDest(label = 'dest') {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `las-copyto-${label}-`)));
  temps.push(dir);
  return dir;
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** name -> sha256 of every local backup file except the state file (which the copy step may write). */
function localSnapshot() {
  const dir = backupsDir();
  return Object.fromEntries(names(dir).filter((n) => n !== 'state.json').map((n) => [n, sha(path.join(dir, n))]));
}

/** FsOps whose `op` fails with `code` for paths inside `dest` (when `match` agrees). */
function failOn(dest, op, code, match = () => true) {
  const base = createFsOps({ sleep: noSleep });
  return {
    ...base,
    [op]: async (...args) => {
      if (String(args[0]).startsWith(dest) && match(args)) throw Object.assign(new Error(code), { code });
      return base[op](...args);
    },
  };
}

const gate = () => {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

/** FsOps whose first temp-file open in `dest` waits for the gate; `reached` resolves when it got there. */
function holdingOps(dest, g) {
  const base = createFsOps({ sleep: noSleep });
  const reached = gate();
  const cleaned = gate();
  let held = false;
  return {
    reached: reached.promise,
    cleaned: cleaned.promise,
    ops: {
      ...base,
      open: async (p, flags, mode) => {
        if (!held && String(p).startsWith(dest) && flags === 'wx') {
          held = true;
          reached.open();
          await g.promise;
        }
        return base.open(p, flags, mode);
      },
      rm: async (...args) => {
        const r = await base.rm(...args);
        if (String(args[0]).startsWith(dest)) cleaned.open();
        return r;
      },
    },
  };
}

const destNames = (dest) => fs.readdirSync(dest).sort();
const manual = (n) => createBackup({ kind: 'manual', now: day(n) });

runBackupsOnMainThread();
beforeEach(() => {
  __resetSecondCopyForTests();
  resetBackupEnv();
});
afterEach(async () => {
  await whenSecondCopyIdle();
  __resetSecondCopyForTests();
  vi.restoreAllMocks();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
afterAll(() => {
  cleanupBackupEnv();
});

describe('normalizeFolder and validateCopyToInput (pure)', () => {
  it('accepts drive and UNC shapes and drops trailing separators, keeping a root', () => {
    expect(normalizeFolder('D:\\Backups\\', 'win32')).toBe('D:\\Backups');
    expect(normalizeFolder('  D:/Backups//  ', 'win32')).toBe('D:\\Backups');
    expect(normalizeFolder('D:\\', 'win32')).toBe('D:\\');
    expect(normalizeFolder('\\\\server\\share\\sub\\', 'win32')).toBe('\\\\server\\share\\sub');
    expect(normalizeFolder('\\\\server\\share', 'win32')).toBe('\\\\server\\share\\');
    expect(normalizeFolder('D:\\a\\..\\b', 'win32')).toBe('D:\\b');
    expect(normalizeFolder('/mnt/backup/', 'linux')).toBe('/mnt/backup');
  });

  it.each([
    ['relative', 'Backups\\x', 'win32'],
    ['drive relative', 'D:Backups', 'win32'],
    ['rooted without a drive', '\\Backups', 'win32'],
    ['device path ?', '\\\\?\\C:\\x', 'win32'],
    ['device path .', '\\\\.\\pipe\\x', 'win32'],
    ['device path with slashes', '//?/C:/x', 'win32'],
    ['UNC with no share', '\\\\server', 'win32'],
    ['too short', 'D:', 'win32'],
    ['control character', 'D:\\a\u0000b', 'win32'],
    ['newline', 'D:\\a\nb', 'win32'],
    ['too long', `D:\\${'a'.repeat(1030)}`, 'win32'],
    ['empty', '   ', 'win32'],
    ['posix relative', 'backup/x', 'linux'],
  ])('refuses %s with reason not_absolute', (_label, input, platform) => {
    expect(() => normalizeFolder(input, platform)).toThrowError(expect.objectContaining({ code: 'invalid_settings', reason: 'not_absolute' }));
  });

  it('takes exactly { folder: string | null }', () => {
    expect(validateCopyToInput({ folder: null })).toEqual({ folder: null });
    expect(validateCopyToInput({ folder: 'D:\\x' }, 'win32')).toEqual({ folder: 'D:\\x' });
    for (const bad of [null, [], 'x', 1, {}, { folder: 5 }, { folder: 'D:\\x', extra: 1 }, { path: 'D:\\x' }, { folder: undefined }]) {
      expect(() => validateCopyToInput(bad, 'win32')).toThrowError(expect.objectContaining({ code: 'invalid_settings' }));
    }
  });

  it('compares folders case-insensitively on win32 and not elsewhere', () => {
    expect(isSameOrInside('C:\\Data\\Backups', 'c:\\data', 'win32')).toBe(true);
    expect(isSameOrInside('C:\\DATA', 'c:\\data\\', 'win32')).toBe(true);
    expect(isSameOrInside('C:\\Data2', 'C:\\Data', 'win32')).toBe(false);
    expect(isSameOrInside('D:\\Data', 'C:\\Data', 'win32')).toBe(false);
    expect(isSameOrInside('C:\\', 'C:\\Data', 'win32')).toBe(false);
    expect(isSameOrInside('/a/B', '/a/b', 'linux')).toBe(false);
    expect(isSameOrInside('/a/b/c', '/a/b', 'linux')).toBe(true);
    expect(folderKeyOf('D:\\Mixed', 'win32')).toBe('d:\\mixed');
    expect(folderKeyOf('/Mixed', 'linux')).toBe('/Mixed');
  });

  it('classifies filesystem errors into the copy codes', () => {
    const code = (c) => classifyCopyError({ code: c });
    expect(code('ENOENT')).toBe('copy_folder_missing');
    expect(code('ENOTDIR')).toBe('copy_folder_missing');
    for (const c of ['EACCES', 'EPERM', 'EROFS']) expect(code(c)).toBe('copy_not_writable');
    for (const c of ['ENOSPC', 'EDQUOT']) expect(code(c)).toBe('copy_disk_full');
    expect(code('EBUSY')).toBe('copy_locked');
    expect(code('EIO')).toBe('copy_failed');
    expect(classifyCopyError(new Error('boom'))).toBe('copy_failed');
    expect(classifyCopyError({ copyCode: 'copy_verify_failed' })).toBe('copy_verify_failed');
    expect(classifyCopyError({ copyCode: 'made_up' })).toBe('copy_failed');
  });
});

describe('saving the setting', () => {
  it('is protected: carried across a restore, refused by import and by the state route', () => {
    expect(COPY_TO_KEY).toBe('backup.copyTo');
    expect(PROTECTED_APP_STATE_KEYS.has(COPY_TO_KEY)).toBe(true);
    expect(RESTORE_CARRY_KEYS).toContain(COPY_TO_KEY);
  });

  it('is off with no row or a damaged value', async () => {
    expect(await getCopyTo()).toEqual({ folder: null, changedAt: null });
    for (const bad of ['junk', 5, [], { folder: 5 }, { folder: 'relative/path' }, { folder: null }]) {
      await setState(COPY_TO_KEY, bad);
      expect((await getCopyTo()).folder).toBeNull();
    }
  });

  it('saves a folder that exists and is writable, removes the probe file, and turns off with folder null', async () => {
    const dest = makeDest();
    const saved = await saveCopyTo({ folder: `${dest}${path.sep}` }, { now: day(3) });
    expect(saved).toEqual({ folder: dest, changedAt: day(3).toISOString() });
    expect(await getState(COPY_TO_KEY)).toEqual(saved);
    expect(destNames(dest)).toEqual([]);
    expect(await getCopyTo()).toEqual(saved);
    const off = await saveCopyTo({ folder: null }, { now: day(4) });
    expect(off).toEqual({ folder: null, changedAt: day(4).toISOString() });
    expect((await getCopyTo()).folder).toBeNull();
  });

  it('refuses a missing folder, a file, and a folder that cannot be written, each with its reason', async () => {
    const dest = makeDest();
    const file = path.join(dest, 'plain.txt');
    fs.writeFileSync(file, 'x');
    await expect(saveCopyTo({ folder: path.join(dest, 'nope') })).rejects.toMatchObject({ code: 'invalid_settings', reason: 'missing', status: 400 });
    await expect(saveCopyTo({ folder: file })).rejects.toMatchObject({ reason: 'not_a_folder' });
    await expect(saveCopyTo({ folder: 'relative' })).rejects.toMatchObject({ reason: 'not_absolute' });
    for (const code of ['EACCES', 'EROFS', 'EPERM']) {
      await expect(saveCopyTo({ folder: dest }, { fsOps: failOn(dest, 'open', code) })).rejects.toMatchObject({ reason: 'not_writable' });
    }
    expect(await getState(COPY_TO_KEY, null)).toBeNull();
  });

  it('refuses the data folder, a folder inside it and the backups folder (also by another spelling)', async () => {
    const inside = path.join(dataDir(), 'inner');
    fs.mkdirSync(inside, { recursive: true });
    fs.mkdirSync(backupsDir(), { recursive: true });
    const spellings = [dataDir(), inside, backupsDir(), `${backupsDir()}${path.sep}`];
    // Windows paths compare without case; elsewhere another case is simply another folder.
    if (process.platform === 'win32') spellings.push(dataDir().toUpperCase(), inside.toLowerCase());
    for (const folder of spellings) {
      await expect(saveCopyTo({ folder })).rejects.toMatchObject({ code: 'invalid_settings', reason: 'inside_data_folder' });
    }
    expect(await getState(COPY_TO_KEY, null)).toBeNull();
  });

  it('refuses a junction that points into the data folder', async (ctx) => {
    const target = path.join(dataDir(), 'target');
    fs.mkdirSync(target, { recursive: true });
    const link = path.join(makeDest('junction'), 'link');
    try {
      fs.symlinkSync(target, link, 'junction');
    } catch {
      ctx.skip('this OS or account cannot create a junction or symlink here');
      return;
    }
    await expect(saveCopyTo({ folder: link })).rejects.toMatchObject({ reason: 'inside_data_folder' });
  });
});

describe('the copy step', () => {
  async function setup(extra = {}) {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const { meta } = await manual(1);
    return { dest, meta, ...extra };
  }

  it('copies the .db, the export zip and the meta of a verified backup, byte for byte, leaving the local folder alone', async () => {
    const { dest, meta } = await setup();
    const before = localSnapshot();
    const result = await requestSecondCopy({ now: day(1) });
    expect(result).toEqual({ result: 'ok', id: meta.id });
    expect(destNames(dest)).toEqual([
      `local-app-studio-${meta.id}.db`,
      `local-app-studio-${meta.id}.export.zip`,
      `local-app-studio-${meta.id}.meta.json`,
    ]);
    expect(sha(path.join(dest, `local-app-studio-${meta.id}.db`))).toBe(meta.db.sha256);
    expect(sha(path.join(dest, `local-app-studio-${meta.id}.export.zip`))).toBe(meta.export.sha256);
    const state = await readState(backupsDir());
    expect(state.secondCopy).toMatchObject({ lastCopiedId: meta.id, lastResult: 'ok', lastError: null, lastSuccessAt: day(1).toISOString() });
    expect(state.secondCopy.originId).toMatch(/^[0-9a-f]{16}$/);
    const copiedMeta = JSON.parse(fs.readFileSync(path.join(dest, `local-app-studio-${meta.id}.meta.json`), 'utf8'));
    expect(copiedMeta).toMatchObject({ ...meta, copiedFrom: state.secondCopy.originId, copiedAt: day(1).toISOString() });
    expect((await listMetas(dest, undefined, { includeCopied: true })).map((m) => m.id)).toEqual([meta.id]);
    expect(localSnapshot()).toEqual(before);
    // The backup folder still holds exactly the files it had, plus the state file.
    expect(names(backupsDir())).toEqual(Object.keys(before).concat('state.json').sort());
  });

  it('copies nothing when off, when there is no backup, for a safety copy and for a failed backup', async () => {
    expect(await requestSecondCopy()).toMatchObject({ result: 'skipped', skipped: 'off' });
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    expect(await requestSecondCopy()).toMatchObject({ result: 'skipped', skipped: 'nothing_to_copy' });
    await createBackup({ kind: 'safety', now: day(1) });
    expect(await requestSecondCopy()).toMatchObject({ result: 'skipped', skipped: 'nothing_to_copy' });
    await expect(
      createBackup({
        kind: 'manual',
        now: day(2),
        snapshotFn: () => {
          throw new Error('snapshot broke');
        },
      }),
    ).rejects.toMatchObject({ code: 'backup_failed' });
    expect(await requestSecondCopy()).toMatchObject({ result: 'skipped', skipped: 'nothing_to_copy' });
    expect(destNames(dest)).toEqual([]);
  });

  it('skips when the newest backup is already there, and copies a newer one next time', async () => {
    const { dest, meta } = await setup();
    expect((await requestSecondCopy({ now: day(1) })).result).toBe('ok');
    expect(await requestSecondCopy({ now: day(1) })).toMatchObject({ result: 'skipped', skipped: 'current' });
    const { meta: newer } = await manual(2);
    expect(await requestSecondCopy({ now: day(2) })).toEqual({ result: 'ok', id: newer.id });
    expect((await listMetas(dest, undefined, { includeCopied: true })).map((m) => m.id)).toEqual([newer.id, meta.id]);
  });

  it('first enable copies the newest existing backup only, and a new folder is copied to again', async () => {
    await manual(1);
    const { meta: newest } = await manual(2);
    const first = makeDest('first');
    await saveCopyTo({ folder: first });
    expect(await requestSecondCopy({ now: day(3) })).toEqual({ result: 'ok', id: newest.id });
    expect((await listMetas(first, undefined, { includeCopied: true })).map((m) => m.id)).toEqual([newest.id]);
    const second = makeDest('second');
    await saveCopyTo({ folder: second });
    expect((await getSecondCopyStatus()).lastCopiedId).toBeNull();
    expect(await requestSecondCopy({ now: day(3) })).toEqual({ result: 'ok', id: newest.id });
    expect((await listMetas(second, undefined, { includeCopied: true })).map((m) => m.id)).toEqual([newest.id]);
  });

  it('keeps the same originId across copies', async () => {
    await setup();
    await requestSecondCopy({ now: day(1) });
    const { originId } = (await readState(backupsDir())).secondCopy;
    await manual(2);
    await requestSecondCopy({ now: day(2) });
    expect((await readState(backupsDir())).secondCopy.originId).toBe(originId);
  });

  it.each([
    ['ENOENT', 'copy_folder_missing'],
    ['EACCES', 'copy_not_writable'],
    ['EROFS', 'copy_not_writable'],
    ['EBUSY', 'copy_locked'],
    ['ENOSPC', 'copy_disk_full'],
  ])('a %s on the destination is %s: its own status and time, the local backup untouched', async (errno, code) => {
    const { dest, meta } = await setup();
    const before = localSnapshot();
    const result = await requestSecondCopy({ now: day(5), fsOps: failOn(dest, 'open', errno, ([, flags]) => flags === 'wx') });
    expect(result).toEqual({ result: 'failed', code });
    expect(destNames(dest)).toEqual([]);
    const state = await readState(backupsDir());
    expect(state.secondCopy).toMatchObject({ lastResult: 'failed', lastError: code, lastFailureAt: day(5).toISOString(), lastCopiedId: null, lastSuccessAt: null });
    const status = await getSecondCopyStatus();
    expect(status).toMatchObject({ enabled: true, folder: dest, health: 'failing', lastError: code, lastFailureAt: day(5).toISOString() });
    expect(localSnapshot()).toEqual(before);
    expect((await listMetas(backupsDir()))[0]).toMatchObject({ id: meta.id, status: 'verified' });
    // The local backup health is not touched by the failed copy.
    expect((await getBackupStatus({ now: day(2) })).health).toBe('ok');
  });

  it('a folder that is gone is copy_folder_missing, then ok once it is back (the next tick retries)', async () => {
    const { dest, meta } = await setup();
    fs.rmSync(dest, { recursive: true });
    expect(await requestSecondCopy({ now: day(2) })).toEqual({ result: 'failed', code: 'copy_folder_missing' });
    fs.mkdirSync(dest);
    expect(await requestSecondCopy({ now: day(3) })).toEqual({ result: 'ok', id: meta.id });
    const status = await getSecondCopyStatus();
    expect(status).toMatchObject({ health: 'ok', lastError: null, lastSuccessAt: day(3).toISOString(), lastFailureAt: day(2).toISOString() });
  });

  it('a failure in the middle of a file leaves no final name and no temp file', async () => {
    const { dest } = await setup();
    const base = createFsOps({ sleep: noSleep });
    const fsOps = {
      ...base,
      open: async (p, flags, mode) => {
        const handle = await base.open(p, flags, mode);
        if (!String(p).startsWith(dest) || flags !== 'wx') return handle;
        return new Proxy(handle, {
          get(target, key) {
            if (key === 'write') {
              return async () => {
                throw Object.assign(new Error('full'), { code: 'ENOSPC' });
              };
            }
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    };
    expect(await requestSecondCopy({ fsOps, now: day(2) })).toEqual({ result: 'failed', code: 'copy_disk_full' });
    expect(destNames(dest)).toEqual([]);
  });

  it('a failed rename of the export zip leaves a .db but no meta, which is not a backup', async () => {
    const { dest } = await setup();
    const fsOps = failOn(dest, 'rename', 'EACCES', ([from]) => String(from).includes('.export.zip.'));
    expect(await requestSecondCopy({ fsOps, now: day(2) })).toEqual({ result: 'failed', code: 'copy_not_writable' });
    expect(destNames(dest).some((n) => n.endsWith('.db'))).toBe(true);
    expect(destNames(dest).some((n) => n.endsWith('.meta.json') || n.endsWith('.copy-tmp'))).toBe(false);
    expect(await listMetas(dest, undefined, { includeCopied: true })).toEqual([]);
  });

  it('a copy that does not match the meta hash is copy_verify_failed and leaves nothing behind', async () => {
    const { dest, meta } = await setup();
    const metaFile = backupFile(meta.id, '.meta.json');
    const wrong = { ...JSON.parse(fs.readFileSync(metaFile, 'utf8')) };
    wrong.db.sha256 = '0'.repeat(64);
    fs.writeFileSync(metaFile, JSON.stringify(wrong));
    expect(await requestSecondCopy({ now: day(2) })).toEqual({ result: 'failed', code: 'copy_verify_failed' });
    expect(destNames(dest)).toEqual([]);
  });

  it('a backup with no export zip copies the .db and the meta', async () => {
    const { dest } = await setup();
    const { meta } = await createBackup({
      kind: 'manual',
      now: day(2),
      exportFn: () => {
        throw new Error('export broke');
      },
    });
    expect(meta.export.file).toBeNull();
    expect(await requestSecondCopy({ now: day(2) })).toEqual({ result: 'ok', id: meta.id });
    expect(destNames(dest).filter((n) => n.includes(meta.id))).toEqual([`local-app-studio-${meta.id}.db`, `local-app-studio-${meta.id}.meta.json`]);
  });

  it('ignores a leftover temp file, removes only old temp files of our exact pattern', async () => {
    const { dest, meta } = await setup();
    const id = meta.id;
    const oldOurs = path.join(dest, `.local-app-studio-${id}.db.deadbeef.copy-tmp`);
    const freshOurs = path.join(dest, `.local-app-studio-${id}.export.zip.cafebabe.copy-tmp`);
    const lookalike = path.join(dest, `.local-app-studio-${id}.db.deadbeef.copy-tmp.keep`);
    const unrelated = path.join(dest, 'notes.copy-tmp');
    for (const f of [oldOurs, freshOurs, lookalike, unrelated]) fs.writeFileSync(f, 'half');
    const old = new Date(day(1).getTime() - 2 * TEMP_MIN_AGE_MS);
    for (const f of [oldOurs, lookalike, unrelated]) fs.utimesSync(f, old, old);
    // The temp files do not make a backup in the folder.
    expect(await listMetas(dest, undefined, { includeCopied: true })).toEqual([]);
    const now = new Date(day(1).getTime() + 1000);
    fs.utimesSync(freshOurs, now, now);
    expect(await requestSecondCopy({ now: () => now })).toEqual({ result: 'ok', id });
    expect(fs.existsSync(oldOurs)).toBe(false);
    expect(fs.existsSync(freshOurs)).toBe(true);
    expect(fs.existsSync(lookalike)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
    expect((await listMetas(dest, undefined, { includeCopied: true })).map((m) => m.id)).toEqual([id]);
  });

  it('refuses at copy time a folder that is now inside the data folder or is the backups folder, and writes nothing', async () => {
    const { meta } = await setup();
    const inner = path.join(dataDir(), 'later');
    fs.mkdirSync(inner, { recursive: true });
    const before = localSnapshot();
    for (const folder of [inner, backupsDir(), dataDir()]) {
      await setState(COPY_TO_KEY, { folder, changedAt: day(1).toISOString() });
      const result = await requestSecondCopy({ now: day(2) });
      expect(result).toEqual({ result: 'failed', code: 'copy_folder_inside_data' });
      expect(names(folder).filter((n) => n.endsWith('.copy-tmp'))).toEqual([]);
    }
    expect(names(inner)).toEqual([]);
    expect(localSnapshot()).toEqual(before);
    expect((await listMetas(backupsDir()))[0].id).toBe(meta.id);
  });

  it('refuses at copy time a destination that became a junction into the data folder', async (ctx) => {
    await setup();
    const target = path.join(dataDir(), 'target');
    fs.mkdirSync(target, { recursive: true });
    const holder = makeDest('junction');
    const link = path.join(holder, 'link');
    try {
      fs.symlinkSync(target, link, 'junction');
    } catch {
      ctx.skip('this OS or account cannot create a junction or symlink here');
      return;
    }
    await setState(COPY_TO_KEY, { folder: link, changedAt: day(1).toISOString() });
    expect(await requestSecondCopy({ now: day(2) })).toEqual({ result: 'failed', code: 'copy_folder_inside_data' });
    expect(names(target)).toEqual([]);
  });
});

describe('retention in the destination', () => {
  const FOREIGN = 'f'.repeat(16);
  const stamp = (id, createdAt, extra = {}) => ({
    format: 'local-app-studio-backup',
    formatVersion: 1,
    id,
    kind: 'manual',
    createdAt,
    status: 'verified',
    db: { file: `local-app-studio-${id}.db`, bytes: 1, sha256: 'a'.repeat(64) },
    export: { file: null, bytes: 0, sha256: null, status: 'failed' },
    ...extra,
  });

  it('deletes only files of metas this install copied, by exact name', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const settings = { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 };

    // Things that look old and removable but are not ours.
    const foreignId = '20260101T000000Z-manual-aaaaaa';
    const noMetaId = '20260102T000000Z-manual-bbbbbb';
    const plainId = '20260103T000000Z-manual-cccccc';
    fs.writeFileSync(path.join(dest, `local-app-studio-${foreignId}.db`), 'foreign');
    fs.writeFileSync(path.join(dest, `local-app-studio-${foreignId}.meta.json`), JSON.stringify(stamp(foreignId, '2026-01-01T00:00:00.000Z', { copiedFrom: FOREIGN })));
    fs.writeFileSync(path.join(dest, `local-app-studio-${noMetaId}.db`), 'same name, no meta');
    fs.writeFileSync(path.join(dest, `local-app-studio-${plainId}.db`), 'a plain copy');
    fs.writeFileSync(path.join(dest, 'notes.txt'), 'mine');
    fs.mkdirSync(path.join(dest, 'local-app-studio-folder'));
    const untouched = destNames(dest);

    const ids = [];
    for (const n of [1, 2, 3]) {
      ids.push((await manual(n)).meta.id);
      expect((await requestSecondCopy({ now: day(n), settings })).result).toBe('ok');
    }
    // Only the newest copy of ours is left; every other file is as it was.
    expect((await listMetas(dest, undefined, { includeCopied: true })).filter((m) => m.copiedFrom !== undefined && m.copiedFrom !== FOREIGN).map((m) => m.id)).toEqual([ids[2]]);
    for (const name of untouched) expect(fs.existsSync(path.join(dest, name))).toBe(true);
    expect(fs.readFileSync(path.join(dest, `local-app-studio-${noMetaId}.db`), 'utf8')).toBe('same name, no meta');
    for (const old of ids.slice(0, 2)) {
      for (const ext of ['.db', '.export.zip', '.meta.json']) expect(fs.existsSync(path.join(dest, `local-app-studio-${old}${ext}`))).toBe(false);
    }
    // The local folder kept all three (its own retention is separate).
    expect((await listMetas(backupsDir())).map((m) => m.id).sort()).toEqual([...ids].sort());
  });

  it('never removes the backup just copied and never deletes a link that has our name', async (ctx) => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const settings = { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 };
    const first = (await manual(1)).meta.id;
    await requestSecondCopy({ now: day(1), settings });
    const outside = makeDest('outside');
    const secret = path.join(outside, 'precious.db');
    fs.writeFileSync(secret, 'precious');
    const dbName = path.join(dest, `local-app-studio-${first}.db`);
    fs.rmSync(dbName);
    try {
      fs.symlinkSync(outside, dbName, 'junction');
    } catch {
      ctx.skip('this OS or account cannot create a junction or symlink here');
      return;
    }
    await manual(2);
    expect((await requestSecondCopy({ now: day(2), settings })).result).toBe('ok');
    expect(fs.readFileSync(secret, 'utf8')).toBe('precious');
    expect(fs.lstatSync(dbName).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(dest, `local-app-studio-${first}.meta.json`))).toBe(false);
  });
});

describe('status', () => {
  it('goes off, pending, ok and failing', async () => {
    expect(await getSecondCopyStatus()).toEqual({
      enabled: false,
      folder: null,
      health: 'off',
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      lastCopiedId: null,
    });
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    expect((await getSecondCopyStatus()).health).toBe('ok');
    const { meta } = await manual(1);
    expect(await getSecondCopyStatus()).toMatchObject({ enabled: true, folder: dest, health: 'pending' });
    await requestSecondCopy({ now: day(1) });
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'ok', lastCopiedId: meta.id, lastSuccessAt: day(1).toISOString() });
    await manual(2);
    expect((await getSecondCopyStatus()).health).toBe('pending');
    await requestSecondCopy({ now: day(2), fsOps: failOn(dest, 'open', 'EROFS', ([, flags]) => flags === 'wx') });
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'failing', lastError: 'copy_not_writable', lastFailureAt: day(2).toISOString() });
    await requestSecondCopy({ now: day(3) });
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'ok', lastError: null });
  });

  it('is part of the backup status and turning it off reports off', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    expect((await getBackupStatus()).secondCopy).toMatchObject({ enabled: true, folder: dest });
    await saveCopyTo({ folder: null });
    expect((await getBackupStatus()).secondCopy).toMatchObject({ enabled: false, health: 'off' });
  });
});

describe('abort, timeout and one job at a time', () => {
  it('an abort (the server is exiting) records nothing, leaves no final file and refuses new work until resumed', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const { meta } = await manual(1);
    const g = gate();
    const held = holdingOps(dest, g);
    const job = requestSecondCopy({ fsOps: held.ops, now: day(1) });
    await held.reached;
    abortSecondCopy();
    expect(await job).toEqual({ result: 'aborted' });
    g.open();
    await held.cleaned;
    expect(destNames(dest)).toEqual([]);
    expect((await readState(backupsDir())).secondCopy).toMatchObject({ lastResult: null, lastCopiedId: null, lastFailureAt: null });
    expect(await requestSecondCopy({ now: day(1) })).toMatchObject({ skipped: 'shutting_down' });
    resumeSecondCopy();
    expect(await requestSecondCopy({ now: day(1) })).toEqual({ result: 'ok', id: meta.id });
  });

  it('the timeout is injectable: firing it fails the job as copy_timeout even when the disk call never returns', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    await manual(1);
    let fire = null;
    const timers = {
      setTimeout: (cb, ms) => {
        fire = { cb, ms };
        return { unref() {} };
      },
      clearTimeout: () => {},
    };
    const g = gate();
    const held = holdingOps(dest, g);
    const job = requestSecondCopy({ fsOps: held.ops, now: day(1), timers });
    await held.reached;
    expect(fire.ms).toBe(COPY_TIMEOUT_MS);
    fire.cb();
    expect(await job).toEqual({ result: 'failed', code: 'copy_timeout' });
    g.open();
    await held.cleaned;
    expect(destNames(dest)).toEqual([]);
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'failing', lastError: 'copy_timeout' });
  });

  it('a request while a copy runs makes it run once more afterwards', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const first = (await manual(1)).meta.id;
    const g = gate();
    const held = holdingOps(dest, g);
    const job = requestSecondCopy({ fsOps: held.ops, now: day(1) });
    await held.reached;
    const second = (await manual(2)).meta.id;
    const again = requestSecondCopy({ now: day(2) });
    g.open();
    expect(await job).toEqual({ result: 'ok', id: second });
    expect(await again).toEqual({ result: 'ok', id: second });
    expect((await listMetas(dest, undefined, { includeCopied: true })).map((m) => m.id)).toEqual([second, first]);
  });

  it('never takes the backup lock: a backup and a copy overlap without blocking each other', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    await manual(1);
    const g = gate();
    const held = holdingOps(dest, g);
    const job = requestSecondCopy({ fsOps: held.ops, now: day(1) });
    await held.reached;
    await expect(manual(2)).resolves.toMatchObject({ created: true });
    g.open();
    await job;
  });
});

describe('triggers', () => {
  afterEach(() => {
    stopBackupScheduler();
    vi.useRealTimers();
  });

  it('the scheduler tick retries the copy before the auto switch return, even with automatic backups off', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    await saveAutoBackup({ enabled: false });
    const { meta } = await manual(1);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = vi.fn(async () => ({ ok: true }));
    startBackupScheduler({ now: () => day(2), run, startupDelayMs: 1_000, tickMs: 10_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(fs.existsSync(path.join(dest, `local-app-studio-${meta.id}.meta.json`))).toBe(true));
    expect(run).not.toHaveBeenCalled();
  });

  it('an automatic backup that was created is copied after the run returns; an unchanged day is not copied again', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    expect(await runScheduledBackup({ now: day(2) })).toEqual({ ok: true, created: true });
    await whenSecondCopyIdle();
    const [meta] = await listMetas(backupsDir());
    expect(meta.kind).toBe('auto');
    expect((await listMetas(dest, undefined, { includeCopied: true })).map((m) => m.id)).toEqual([meta.id]);
    expect(await runScheduledBackup({ now: day(2) })).toEqual({ ok: true, created: false });
    await whenSecondCopyIdle();
    expect((await getSecondCopyStatus()).health).toBe('ok');
  });
});

describe('routes', () => {
  let app;
  beforeEach(() => {
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api', restoreGateMiddleware);
    registerBackupRoutes(app);
  });
  const put = (body) => request(app).put('/api/backups/copy-to').set('Content-Type', 'application/json').send(body);

  it('PUT /api/backups/copy-to saves, answers the status and copies the newest backup after the answer', async () => {
    const dest = makeDest();
    const { meta } = await manual(1);
    const res = await put({ folder: dest });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.data).toMatchObject({ enabled: true, folder: dest, health: 'pending', lastError: null });
    expect(Object.keys(res.body.data).sort()).toEqual(['enabled', 'folder', 'health', 'lastCopiedId', 'lastError', 'lastFailureAt', 'lastSuccessAt']);
    await whenSecondCopyIdle();
    expect(fs.existsSync(path.join(dest, `local-app-studio-${meta.id}.meta.json`))).toBe(true);
    const status = await request(app).get('/api/backups/status');
    expect(status.body.data.secondCopy).toMatchObject({ enabled: true, health: 'ok', lastCopiedId: meta.id });
    const list = await request(app).get('/api/backups');
    expect(list.body.data.secondCopy).toEqual(status.body.data.secondCopy);
    expect(list.body.data.status.secondCopy).toEqual(status.body.data.secondCopy);
    const off = await put({ folder: null });
    expect(off.body.data).toMatchObject({ enabled: false, folder: null, health: 'off' });
  });

  it('answers 400 invalid_settings with a top level reason and a plain sentence', async () => {
    const dest = makeDest();
    const cases = [
      [{ folder: path.join(dest, 'nope') }, 'missing'],
      [{ folder: 'relative' }, 'not_absolute'],
      [{ folder: dataDir() }, 'inside_data_folder'],
    ];
    for (const [body, reason] of cases) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'invalid_settings', reason, error: expect.any(String), action: expect.any(String), requestId: expect.any(String) });
      expect(res.body.error).toBe(res.body.message);
      expect(res.body.error).not.toContain(dest);
      expect(res.headers['cache-control']).toMatch(/no-store/);
    }
    for (const body of [{}, { folder: 5 }, { folder: 'D:\\x', extra: 1 }, []]) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_settings');
      expect(res.body.reason).toBeUndefined();
    }
    const plain = await request(app).put('/api/backups/copy-to').set('Content-Type', 'text/plain').send('folder=x');
    expect(plain.status).toBe(415);
    expect(plain.body.code).toBe('unsupported_media_type');
  });

  it('POST /api/backups answers first; the copy happens afterwards and a failed copy does not fail the backup', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const res = await request(app).post('/api/backups').set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(201);
    await whenSecondCopyIdle();
    expect(destNames(dest).filter((n) => n.endsWith('.meta.json'))).toEqual([`local-app-studio-${res.body.data.backup.id}.meta.json`]);
    fs.rmSync(dest, { recursive: true });
    const again = await request(app).post('/api/backups').set('Content-Type', 'application/json').send({});
    expect(again.status).toBe(201);
    expect(again.body.data.backup.status).toBe('verified');
    await whenSecondCopyIdle();
    const status = await request(app).get('/api/backups/status');
    expect(status.body.data.secondCopy).toMatchObject({ health: 'failing', lastError: 'copy_folder_missing' });
    expect(status.body.data.health).toBe('ok');
  });
});

describe('restore and import', () => {
  const putState = (db, value) =>
    db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(COPY_TO_KEY, JSON.stringify(value));

  it('a restore keeps the live folder, whatever the restored backup held, and a restore with none keeps it off', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest }, { now: day(1) });
    const live = await getState(COPY_TO_KEY);
    const { meta } = await manual(1);
    // A copy of the backup that claims another folder.
    const edited = path.join(makeDest('edit'), 'edited.db');
    fs.copyFileSync(backupFile(meta.id, '.db'), edited);
    const handle = new DatabaseSync(edited);
    handle.exec('PRAGMA journal_mode = DELETE');
    putState(handle, { folder: makeDest('other'), changedAt: day(0).toISOString() });
    handle.close();
    const upload = await inspectUpload(fakeUploadReq(fs.readFileSync(edited)), { now: day(2) });
    await restoreBackup({ uploadToken: upload.uploadToken, now: day(2), hooks: { sleep: noSleep } });
    expect(await getState(COPY_TO_KEY)).toEqual(live);

    // Off live: a backup that had it on must not switch it on.
    await saveCopyTo({ folder: null }, { now: day(3) });
    const off = await getState(COPY_TO_KEY);
    const upload2 = await inspectUpload(fakeUploadReq(fs.readFileSync(edited)), { now: day(3) });
    await restoreBackup({ uploadToken: upload2.uploadToken, now: day(3), hooks: { sleep: noSleep } });
    expect(await getState(COPY_TO_KEY)).toEqual(off);
    expect((await getCopyTo()).folder).toBeNull();
  });

  it('an import never writes the key', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest }, { now: day(1) });
    const before = await getState(COPY_TO_KEY);
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'local-app-studio-export', formatVersion: 1, exportedAt: '2026-05-01T00:00:00.000Z', tables: [{ id: 'app_state' }] })),
      'json/app_state.json': strToU8(JSON.stringify([{ key: COPY_TO_KEY, value: { folder: 'D:\\evil', changedAt: '2026-05-01T00:00:00.000Z' } }])),
    });
    const result = importZipBuffer(zip, { db: getDb() });
    expect(result.tables.find((t) => t.id === 'app_state').skippedReasons.protected).toBe(1);
    expect(await getState(COPY_TO_KEY)).toEqual(before);
  });

  it('a .db taken from the second folder restores through the upload flow', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    await setState('test.marker', { n: 1 });
    const { meta } = await manual(1);
    await requestSecondCopy({ now: day(1) });
    await setState('test.marker', { n: 2 });
    const bytes = fs.readFileSync(path.join(dest, `local-app-studio-${meta.id}.db`));
    const upload = await inspectUpload(fakeUploadReq(bytes), { now: day(2) });
    expect(upload.schemaVersion).toBeGreaterThan(0);
    await restoreBackup({ uploadToken: upload.uploadToken, now: day(2), hooks: { sleep: noSleep } });
    expect(await getState('test.marker')).toEqual({ n: 1 });
    expect((await getCopyTo()).folder).toBe(dest);
  });
});

// ---------------------------------------------------------------------------------------------
// Review fixes: another install's folders, copies listed as local, hangs, identity, retention order
// ---------------------------------------------------------------------------------------------

const OTHER_ID = '20260101T000000Z-manual-aaaaaa';
const metaBody = (id, extra = {}) => ({
  format: 'local-app-studio-backup',
  formatVersion: 1,
  id,
  kind: 'manual',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'verified',
  db: { file: `local-app-studio-${id}.db`, bytes: 5, sha256: 'a'.repeat(64) },
  export: { file: null, bytes: 0, sha256: null, status: 'failed' },
  ...extra,
});

/** The first bytes of a real SQLite database file. */
const SQLITE_HEADER = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(84)]);
const appState = () => JSON.stringify({ formatVersion: 1, lastRunAt: '2026-01-01T00:00:00.000Z', confirmedId: null });

/** A second temp install: <root>/app.db and <root>/backups holding one local backup and a state.json. */
function makeOtherInstall() {
  const root = makeDest('install');
  fs.writeFileSync(path.join(root, 'app.db'), SQLITE_HEADER);
  const backups = path.join(root, 'backups');
  fs.mkdirSync(backups);
  fs.writeFileSync(path.join(backups, `local-app-studio-${OTHER_ID}.db`), 'other backup');
  fs.writeFileSync(path.join(backups, `local-app-studio-${OTHER_ID}.meta.json`), JSON.stringify(metaBody(OTHER_ID)));
  fs.writeFileSync(path.join(backups, 'state.json'), appState());
  return { root, backups };
}
const snapshotOf = (dir) => Object.fromEntries(names(dir).map((n) => [n, sha(path.join(dir, n))]));

describe('a destination that belongs to another install (H1b)', () => {
  it('refuses another install backups folder and its data folder at save, writing nothing', async () => {
    const { root, backups } = makeOtherInstall();
    const before = snapshotOf(backups);
    for (const folder of [backups, root]) {
      await expect(saveCopyTo({ folder })).rejects.toMatchObject({ code: 'invalid_settings', reason: 'app_folder' });
    }
    expect(snapshotOf(backups)).toEqual(before);
    expect(names(root).filter((n) => n.endsWith('.copy-tmp'))).toEqual([]);
    expect(await getState(COPY_TO_KEY, null)).toBeNull();
  });

  it.each([
    ['this app state.json', (dir) => fs.writeFileSync(path.join(dir, 'state.json'), appState())],
    ['a state.json with a secondCopy record', (dir) => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ formatVersion: 1, secondCopy: {} }))],
    ['a local meta without copiedFrom', (dir) => fs.writeFileSync(path.join(dir, `local-app-studio-${OTHER_ID}.meta.json`), JSON.stringify(metaBody(OTHER_ID)))],
    ['a real SQLite app.db', (dir) => fs.writeFileSync(path.join(dir, 'app.db'), SQLITE_HEADER)],
  ])('refuses a folder holding %s with a plain sentence', async (_label, plant) => {
    const dest = makeDest();
    plant(dest);
    const error = await saveCopyTo({ folder: dest }).catch((e) => e);
    expect(error).toMatchObject({ code: 'invalid_settings', reason: 'app_folder' });
    expect(error.message).toBe("That folder belongs to an app's own data. Pick another folder.");
  });

  it.each([
    ['an unrelated state.json', (dir) => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ theme: 'dark', items: [1, 2] }))],
    ['an empty object state.json', (dir) => fs.writeFileSync(path.join(dir, 'state.json'), '{}')],
    ['a state.json of the right version without our keys', (dir) => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ formatVersion: 1, other: true }))],
    ['a state.json with our keys and another version', (dir) => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ formatVersion: 2, lastRunAt: null }))],
    ['a state.json that is not JSON', (dir) => fs.writeFileSync(path.join(dir, 'state.json'), 'not json')],
    ['a state.json that is an array', (dir) => fs.writeFileSync(path.join(dir, 'state.json'), '[1]')],
    ['an app.db that is not SQLite', (dir) => fs.writeFileSync(path.join(dir, 'app.db'), 'just some text, not a database')],
    ['an empty app.db', (dir) => fs.writeFileSync(path.join(dir, 'app.db'), '')],
    ['an app.db with a near miss header', (dir) => fs.writeFileSync(path.join(dir, 'app.db'), Buffer.concat([Buffer.from('SQLite format 4\0', 'latin1'), Buffer.alloc(40)]))],
  ])('accepts a folder holding %s that is not this app data', async (_label, plant) => {
    const dest = makeDest();
    plant(dest);
    await expect(saveCopyTo({ folder: dest })).resolves.toMatchObject({ folder: dest });
  });

  it('refuses an empty folder named backups beside an app.db, and accepts one that holds only copies', async () => {
    const root = makeDest('beside');
    fs.writeFileSync(path.join(root, 'app.db'), 'x');
    const backups = path.join(root, 'backups');
    fs.mkdirSync(backups);
    await expect(saveCopyTo({ folder: backups })).rejects.toMatchObject({ reason: 'app_folder' });
    const plain = makeDest('copies');
    fs.writeFileSync(path.join(plain, `local-app-studio-${OTHER_ID}.meta.json`), JSON.stringify(metaBody(OTHER_ID, { copiedFrom: 'f'.repeat(16) })));
    await expect(saveCopyTo({ folder: plain })).resolves.toMatchObject({ folder: plain });
  });

  it('refuses at every copy a folder that turned into another install backups folder, leaving both sides alone', async () => {
    const { backups } = makeOtherInstall();
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const { meta } = await manual(1);
    const localBefore = localSnapshot();
    const otherBefore = snapshotOf(backups);
    await setState(COPY_TO_KEY, { folder: backups, changedAt: day(1).toISOString() });
    expect(await requestSecondCopy({ now: day(2), settings: { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 } })).toEqual({
      result: 'failed',
      code: 'copy_app_folder',
    });
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'failing', lastError: 'copy_app_folder' });
    expect(snapshotOf(backups)).toEqual(otherBefore);
    expect(localSnapshot()).toEqual(localBefore);
    expect((await listMetas(backupsDir()))[0].id).toBe(meta.id);
  });
});

describe('copies in a folder are never local backups (H1a)', () => {
  const FOREIGN = 'e'.repeat(16);
  const copiedId = '20260301T000000Z-manual-cccccc';

  function plantCopy() {
    fs.mkdirSync(backupsDir(), { recursive: true });
    fs.writeFileSync(backupFile(copiedId, '.db'), 'a copy made for another install');
    fs.writeFileSync(backupFile(copiedId, '.meta.json'), JSON.stringify(metaBody(copiedId, { createdAt: day(30).toISOString(), copiedFrom: FOREIGN })));
  }

  it('local retention keeps its own backups and the copy, and the copy is not listed, restorable or a candidate', async () => {
    const ids = [];
    for (const n of [1, 2, 3]) ids.push((await manual(n)).meta.id);
    plantCopy();
    const settings = { keepDaily: 3, keepWeekly: 0, keepMonthly: 0 };
    const { removed } = await applyRetention({ settings, now: day(31) });
    expect(removed).toEqual([]);
    expect(fs.existsSync(backupFile(copiedId, '.meta.json'))).toBe(true);
    expect(fs.existsSync(backupFile(copiedId, '.db'))).toBe(true);
    expect((await listBackupSummaries()).map((s) => s.id).sort()).toEqual([...ids].sort());
    expect((await listMetas(backupsDir())).map((m) => m.id)).not.toContain(copiedId);
    expect((await listMetas(backupsDir(), undefined, { includeCopied: true })).map((m) => m.id)).toContain(copiedId);
    expect(await readMeta(copiedId, backupsDir())).toBeNull();
    await expect(restoreBackup({ id: copiedId })).rejects.toBeTruthy();
    // The newest verified backup for health and for the second copy is still our own.
    const status = await getBackupStatus({ now: day(4) });
    expect(status.lastBackupId).toBe(ids[2]);
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    expect(await requestSecondCopy({ now: day(4) })).toEqual({ result: 'ok', id: ids[2] });
  });

  it('retention removes only its own old backups and never the copy', async () => {
    const ids = [];
    for (const n of [1, 2]) ids.push((await manual(n)).meta.id);
    plantCopy();
    const { removed } = await applyRetention({ settings: { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 }, now: day(31) });
    expect(removed).toEqual([ids[0]]);
    expect(fs.existsSync(backupFile(copiedId, '.meta.json'))).toBe(true);
  });

  it('the due check ignores a copy dated after our own backups', async () => {
    plantCopy();
    const metas = await listMetas(backupsDir());
    expect(metas).toEqual([]);
    expect(isBackupDue({ state: await readState(), metas, now: day(30) })).toBe(true);
  });

  it('two installs pointing at each other cannot rewrite or prune each other', async () => {
    const { backups } = makeOtherInstall();
    const otherBefore = snapshotOf(backups);
    await manual(1);
    await setState(COPY_TO_KEY, { folder: backups, changedAt: day(1).toISOString() });
    await requestSecondCopy({ now: day(2) });
    expect(snapshotOf(backups)).toEqual(otherBefore);
    // What the other install would write into ours is never ours to prune or overwrite.
    plantCopy();
    const planted = snapshotOf(backupsDir());
    await applyRetention({ settings: { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 }, now: day(40) });
    for (const [name, digest] of Object.entries(planted)) {
      if (name.includes(copiedId)) expect(sha(path.join(backupsDir(), name))).toBe(digest);
    }
  });
});

describe('the same folder under another path (M2)', () => {
  /** FsOps whose stat answers with the identity of `as` for every path in `paths`. */
  function aliasStat(paths, as) {
    const base = createFsOps({ sleep: noSleep });
    return {
      ...base,
      stat: async (p, o) => base.stat(paths.includes(String(p)) ? as : p, o),
    };
  }

  it.each([
    ['the data folder', () => dataDir()],
    ['the backups folder', () => backupsDir()],
  ])('refuses at save a folder that is %s by identity (a share or mapped drive)', async (_label, target) => {
    fs.mkdirSync(backupsDir(), { recursive: true });
    const dest = makeDest();
    const fsOps = aliasStat([dest], target());
    await expect(saveCopyTo({ folder: dest }, { fsOps })).rejects.toMatchObject({ reason: 'inside_data_folder' });
    expect(destNames(dest)).toEqual([]);
  });

  it('refuses a folder whose ancestor is the data folder by identity', async () => {
    const parent = makeDest('parent');
    const dest = path.join(parent, 'inner');
    fs.mkdirSync(dest);
    const fsOps = aliasStat([parent], dataDir());
    await expect(saveCopyTo({ folder: dest }, { fsOps })).rejects.toMatchObject({ reason: 'inside_data_folder' });
  });

  it('refuses at copy time and writes nothing; an unrelated folder is not mistaken', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const { meta } = await manual(1);
    const localBefore = localSnapshot();
    expect(await requestSecondCopy({ now: day(1), fsOps: aliasStat([dest], backupsDir()) })).toEqual({ result: 'failed', code: 'copy_folder_inside_data' });
    expect(destNames(dest)).toEqual([]);
    expect(localSnapshot()).toEqual(localBefore);
    expect(await requestSecondCopy({ now: day(2) })).toEqual({ result: 'ok', id: meta.id });
  });

  it('an inode of 0 (not reported by the filesystem) never matches', async () => {
    const dest = makeDest();
    const base = createFsOps({ sleep: noSleep });
    const fsOps = { ...base, stat: async () => ({ dev: 1n, ino: 0n }) };
    await expect(saveCopyTo({ folder: dest }, { fsOps })).resolves.toMatchObject({ folder: dest });
  });
});

describe('a disk call that never returns (M1)', () => {
  const hang = () => new Promise(() => {});
  const fakeTimers = () => {
    const armed = [];
    return {
      armed,
      timers: {
        setTimeout: (cb, ms) => {
          armed.push({ cb, ms });
          return { unref() {} };
        },
        clearTimeout: () => {},
      },
    };
  };

  it('keeps the slot busy after a timeout: one outstanding call however often the timeout fires or a tick asks', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    await manual(1);
    const reached = gate();
    const realpath = vi.fn(() => {
      reached.open();
      return hang();
    });
    const fsOps = { ...createFsOps({ sleep: noSleep }), realpath };
    const { armed, timers } = fakeTimers();
    const job = requestSecondCopy({ fsOps, timers, now: day(1) });
    await reached.promise;
    armed[0].cb();
    expect(await job).toEqual({ result: 'failed', code: 'copy_timeout' });
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'failing', lastError: 'copy_timeout' });
    const recorded = (await readState(backupsDir())).secondCopy;
    armed[0].cb();
    for (let i = 0; i < 4; i += 1) {
      expect(await requestSecondCopy({ fsOps, timers, now: day(2 + i) })).toEqual({ result: 'skipped', skipped: 'busy' });
    }
    expect(realpath).toHaveBeenCalledTimes(1);
    expect(armed).toHaveLength(1);
    // A refused tick no longer records nothing: it says the copy is stuck, with a fresh failure time.
    expect(recorded).toMatchObject({ lastError: 'copy_timeout', lastFailureAt: day(1).toISOString() });
    const after = (await readState(backupsDir())).secondCopy;
    expect(after).toEqual({ ...recorded, lastError: 'copy_stuck', lastAttemptAt: day(5).toISOString(), lastFailureAt: day(5).toISOString() });
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'failing', lastError: 'copy_stuck', lastFailureAt: day(5).toISOString() });
  });

  it('a stuck tick counts for the current folder only and never claims a success it did not have', async () => {
    const first = makeDest('first');
    await saveCopyTo({ folder: first });
    await manual(1);
    const reached = gate();
    const fsOps = { ...createFsOps({ sleep: noSleep }), realpath: () => { reached.open(); return hang(); } };
    const { armed, timers } = fakeTimers();
    const job = requestSecondCopy({ fsOps, timers, now: day(1) });
    await reached.promise;
    armed[0].cb();
    await job;
    const second = makeDest('second');
    await saveCopyTo({ folder: second });
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'pending', lastError: null, lastFailureAt: null });
    expect(await requestSecondCopy({ fsOps, timers, now: day(2) })).toEqual({ result: 'skipped', skipped: 'busy' });
    expect(await getSecondCopyStatus()).toMatchObject({
      folder: second,
      health: 'failing',
      lastError: 'copy_stuck',
      lastFailureAt: day(2).toISOString(),
      lastSuccessAt: null,
      lastCopiedId: null,
    });
    expect(destNames(second)).toEqual([]);
  });

  it('a tick with the copy turned off answers off and records nothing, even while a call is stuck', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    await manual(1);
    const reached = gate();
    const fsOps = { ...createFsOps({ sleep: noSleep }), realpath: () => { reached.open(); return hang(); } };
    const { armed, timers } = fakeTimers();
    const job = requestSecondCopy({ fsOps, timers, now: day(1) });
    await reached.promise;
    armed[0].cb();
    await job;
    const recorded = (await readState(backupsDir())).secondCopy;
    await saveCopyTo({ folder: null });
    expect(await requestSecondCopy({ now: day(3) })).toMatchObject({ skipped: 'off' });
    expect((await readState(backupsDir())).secondCopy).toEqual(recorded);
  });

  it('serves a new job once the stuck call has really settled', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const { meta } = await manual(1);
    const reached = gate();
    const release = gate();
    const base = createFsOps({ sleep: noSleep });
    const fsOps = {
      ...base,
      realpath: async (p) => {
        reached.open();
        await release.promise;
        return base.realpath(p);
      },
    };
    const { armed, timers } = fakeTimers();
    const job = requestSecondCopy({ fsOps, timers, now: day(1) });
    await reached.promise;
    armed[0].cb();
    expect((await job).code).toBe('copy_timeout');
    expect(await requestSecondCopy({ now: day(2) })).toEqual({ result: 'skipped', skipped: 'busy' });
    release.open();
    await vi.waitFor(async () => expect(await requestSecondCopy({ now: day(3) })).toEqual({ result: 'ok', id: meta.id }));
  });

  it('a hang in destination retention ends the job as failed by timeout', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const { meta } = await manual(1);
    const reached = gate();
    const base = createFsOps({ sleep: noSleep });
    const fsOps = {
      ...base,
      // Only retention reads the destination after the meta is in place.
      readdir: async (p, ...rest) => {
        if (String(p) === dest && fs.existsSync(path.join(dest, `local-app-studio-${meta.id}.meta.json`))) {
          reached.open();
          return hang();
        }
        return base.readdir(p, ...rest);
      },
    };
    const { armed, timers } = fakeTimers();
    const job = requestSecondCopy({ fsOps, timers, now: day(1), settings: { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 } });
    await reached.promise;
    armed[0].cb();
    expect(await job).toEqual({ result: 'failed', code: 'copy_timeout' });
    expect(await getSecondCopyStatus()).toMatchObject({ health: 'failing', lastError: 'copy_timeout' });
  });

  it('a hang in the temp cleanup ends the job as failed by timeout', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    await manual(1);
    const reached = gate();
    const base = createFsOps({ sleep: noSleep });
    let reads = 0;
    const fsOps = {
      ...base,
      readdir: async (p, ...rest) => {
        if (String(p) === dest) {
          reads += 1;
          // The first read is the folder check; the second is the temp cleanup.
          if (reads === 2) {
            reached.open();
            return hang();
          }
        }
        return base.readdir(p, ...rest);
      },
    };
    const { armed, timers } = fakeTimers();
    const job = requestSecondCopy({ fsOps, timers, now: day(1) });
    await reached.promise;
    armed[0].cb();
    expect(await job).toEqual({ result: 'failed', code: 'copy_timeout' });
  });
});

describe('saving a folder that does not answer (M2)', () => {
  const hang = () => new Promise(() => {});
  const SLOW = 'That folder did not answer in time. Check the drive or network, then try again.';
  const fakeTimers = () => {
    const armed = [];
    let cleared = 0;
    return {
      armed,
      cleared: () => cleared,
      timers: {
        setTimeout: (cb, ms) => {
          armed.push({ cb, ms });
          return { unref() {} };
        },
        clearTimeout: () => {
          cleared += 1;
        },
      },
    };
  };

  it('refuses as slow when the inspection passes the injected timeout, saving nothing', async () => {
    const dest = makeDest();
    const reached = gate();
    const fsOps = { ...createFsOps({ sleep: noSleep }), realpath: () => { reached.open(); return hang(); } };
    const { armed, timers } = fakeTimers();
    const saving = saveCopyTo({ folder: dest }, { fsOps, timers });
    const refused = saving.catch((e) => e);
    await reached.promise;
    expect(armed).toHaveLength(1);
    expect(armed[0].ms).toBe(SAVE_INSPECT_TIMEOUT_MS);
    expect(SAVE_INSPECT_TIMEOUT_MS).toBe(15000);
    armed[0].cb();
    const error = await refused;
    expect(error).toMatchObject({ code: 'invalid_settings', reason: 'slow', status: 400 });
    expect(error.message).toBe(SLOW);
    expect(await getState(COPY_TO_KEY, null)).toBeNull();
  });

  it('refuses a new save while the earlier inspection is unsettled, and works again once it settled', async () => {
    const dest = makeDest();
    const reached = gate();
    const release = gate();
    const base = createFsOps({ sleep: noSleep });
    const slowOps = {
      ...base,
      realpath: async (p) => {
        reached.open();
        await release.promise;
        return base.realpath(p);
      },
    };
    const { armed, timers } = fakeTimers();
    const first = saveCopyTo({ folder: dest }, { fsOps: slowOps, timers }).catch((e) => e);
    await reached.promise;
    armed[0].cb();
    expect(await first).toMatchObject({ reason: 'slow' });
    // The first inspection is still running: a second save does not start another one.
    const realpath = vi.fn(base.realpath);
    const second = await saveCopyTo({ folder: dest }, { fsOps: { ...base, realpath }, timers }).catch((e) => e);
    expect(second).toMatchObject({ code: 'invalid_settings', reason: 'slow' });
    expect(second.message).toBe(SLOW);
    expect(realpath).not.toHaveBeenCalled();
    // Turning it off is not an inspection and is never refused.
    await expect(saveCopyTo({ folder: null })).resolves.toMatchObject({ folder: null });
    release.open();
    await vi.waitFor(async () => expect(await saveCopyTo({ folder: dest })).toMatchObject({ folder: dest }));
  });

  it('a fast answer clears the timer and a failed inspection frees the slot', async () => {
    const dest = makeDest();
    const { armed, cleared, timers } = fakeTimers();
    await expect(saveCopyTo({ folder: path.join(dest, 'nope') }, { timers })).rejects.toMatchObject({ reason: 'missing' });
    expect(cleared()).toBe(1);
    await expect(saveCopyTo({ folder: dest }, { timers })).resolves.toMatchObject({ folder: dest });
    expect(armed).toHaveLength(2);
    expect(cleared()).toBe(2);
  });
});

describe('the new copy codes', () => {
  it('are known to the server and survive in the stored record', async () => {
    for (const code of ['copy_stuck', 'copy_app_folder']) {
      expect(COPY_ERROR_CODES).toContain(code);
      expect(classifyCopyError({ copyCode: code })).toBe(code);
    }
  });
});

describe('destination retention order (L3)', () => {
  it('keeps the meta when the .db cannot be deleted, so a later run retries and finishes', async () => {
    const dest = makeDest();
    await saveCopyTo({ folder: dest });
    const settings = { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 };
    const first = (await manual(1)).meta.id;
    expect((await requestSecondCopy({ now: day(1), settings })).result).toBe('ok');
    const second = (await manual(2)).meta.id;
    const base = createFsOps({ sleep: noSleep });
    const busy = {
      ...base,
      rm: async (p, ...rest) => {
        if (String(p) === path.join(dest, `local-app-studio-${first}.db`)) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
        return base.rm(p, ...rest);
      },
    };
    expect((await requestSecondCopy({ now: day(2), settings, fsOps: busy })).result).toBe('ok');
    expect(fs.existsSync(path.join(dest, `local-app-studio-${first}.meta.json`))).toBe(true);
    expect(fs.existsSync(path.join(dest, `local-app-studio-${first}.db`))).toBe(true);
    const third = (await manual(3)).meta.id;
    expect((await requestSecondCopy({ now: day(3), settings })).result).toBe('ok');
    for (const old of [first, second]) {
      for (const ext of ['.db', '.export.zip', '.meta.json']) expect(fs.existsSync(path.join(dest, `local-app-studio-${old}${ext}`))).toBe(false);
    }
    expect(fs.existsSync(path.join(dest, `local-app-studio-${third}.meta.json`))).toBe(true);
  });
});

describe('the folder path stays out of exports (L5)', () => {
  it('is hidden like the license activation and still carried across a restore', () => {
    expect(HIDDEN_APP_STATE_KEYS.has(COPY_TO_KEY)).toBe(true);
    expect(HIDDEN_APP_STATE_KEYS.has('license.activation')).toBe(true);
    expect(RESTORE_CARRY_KEYS).toContain(COPY_TO_KEY);
    expect(PROTECTED_APP_STATE_KEYS.has(COPY_TO_KEY)).toBe(true);
  });
});
