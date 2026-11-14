// Second backup location: an optional folder (another drive, a network share, a synced folder) that
// receives a copy of each finished, verified backup. The local backups folder stays the source of truth:
// this module only READS the local .db and .export.zip and the local meta, and never writes, renames or
// deletes anything in the local backups folder or the data folder (the one exception is its own record
// in backups/state.json, written through writeState). Disk access goes through the FsOps seam.
//
// Per file: stream to a private temp name in the destination, fsync, check the sha256 against the meta,
// then rename. The meta is copied last, so a destination backup exists only when its meta does. A
// failed copy never changes the local backup. Retention in the destination deletes only files of metas
// that carry this install's originId, by exact name, after lstat shows a regular file.
import crypto from 'node:crypto';
import path from 'node:path';
import { getState, setState } from '../dataAccess.js';
import { BackupError, isNoSpaceError } from './errors.js';
import { createFsOps, isMissing, readJsonOrNull, renameWithRetry, rmWithRetry, writeFileSynced } from './fsops.js';
import { listMetas, readState, writeState } from './manifest.js';
import { ID_RE, backupsDir, dataDirOf, ensureBackupsDir, resolveBackupFile } from './paths.js';
import { planRetention } from './retention.js';
import { getBackupSettings } from './settings.js';

export const COPY_TO_KEY = 'backup.copyTo';
/** One job (every file of one backup) may take this long. */
export const COPY_TIMEOUT_MS = 10 * 60 * 1000;
/** A leftover temp file of ours is removed only when older than this. */
export const TEMP_MIN_AGE_MS = 60 * 60 * 1000;
/** Saving a folder inspects it on the request path: this long, then the save is refused as `slow`. */
export const SAVE_INSPECT_TIMEOUT_MS = 15 * 1000;
export const COPY_ERROR_CODES = Object.freeze([
  'copy_folder_missing',
  'copy_not_writable',
  'copy_disk_full',
  'copy_locked',
  'copy_verify_failed',
  'copy_timeout',
  'copy_stuck',
  'copy_folder_inside_data',
  'copy_app_folder',
  'copy_failed',
]);

const CHUNK_BYTES = 1024 * 1024;
const MIN_PATH = 3;
const MAX_PATH = 1024;
// eslint-disable-next-line no-control-regex -- a control character in a path is rejected on purpose
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const TEMP_RE = new RegExp(
  `^\\.local-app-studio-(?:\\d{8}T\\d{6}Z-(?:auto|manual|safety)-[0-9a-f]{6}|probe)(?:\\.db|\\.export\\.zip|\\.meta\\.json)?\\.[0-9a-f]{8}\\.copy-tmp$`,
);

export const COPY_REASON_MESSAGES = Object.freeze({
  not_absolute: 'Type the full folder path, starting with a drive letter such as D:\\ or with \\\\server\\share.',
  missing: 'That folder was not found. Create it first, then try again.',
  not_a_folder: 'That path is not a folder.',
  not_writable: 'Files cannot be saved in that folder. Pick a folder you can write to.',
  inside_data_folder: 'Pick a folder outside the data folder. A copy kept in the data folder would be lost with it.',
  app_folder: "That folder belongs to an app's own data. Pick another folder.",
  slow: 'That folder did not answer in time. Check the drive or network, then try again.',
});

const reasonError = (reason) =>
  Object.assign(new BackupError('invalid_settings', { message: COPY_REASON_MESSAGES[reason] }), { reason });

const pathApi = (platform) => (platform === 'win32' ? path.win32 : path.posix);
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

/**
 * Pure: a trimmed, absolute, normalized folder string with no trailing separator (a drive or share root
 * keeps its own), or throws invalid_settings with reason `not_absolute`. On win32 only a drive path or a
 * UNC path is accepted; `\\?\` and `\\.\` device paths are refused.
 * @param {unknown} raw
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function normalizeFolder(raw, platform = process.platform) {
  if (typeof raw !== 'string') throw reasonError('not_absolute');
  const s = raw.trim();
  if (s.length < MIN_PATH || s.length > MAX_PATH || CONTROL_RE.test(s)) throw reasonError('not_absolute');
  if (platform === 'win32') {
    if (/^[\\/]{2}[?.][\\/]/.test(s)) throw reasonError('not_absolute');
    if (!/^[A-Za-z]:[\\/]/.test(s) && !/^\\\\[^\\/]+\\[^\\/]+/.test(s)) throw reasonError('not_absolute');
  } else if (!s.startsWith('/')) {
    throw reasonError('not_absolute');
  }
  const api = pathApi(platform);
  let out = api.resolve(s);
  const { root } = api.parse(out);
  while (out.length > root.length && /[\\/]$/.test(out)) out = out.slice(0, -1);
  return out;
}

/**
 * Pure: request body `{ folder: string | null }` and nothing else.
 * @param {unknown} input
 * @param {NodeJS.Platform} [platform]
 * @returns {{ folder: string | null }}
 */
export function validateCopyToInput(input, platform = process.platform) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new BackupError('invalid_settings');
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'folder') throw new BackupError('invalid_settings');
  const { folder } = /** @type {Record<string, unknown>} */ (input);
  if (folder === null) return { folder: null };
  if (typeof folder !== 'string') throw new BackupError('invalid_settings');
  return { folder: normalizeFolder(folder, platform) };
}

/** Identity of a folder for "same folder as before" (lowercase on win32). */
export const folderKeyOf = (folder, platform = process.platform) => (platform === 'win32' ? folder.toLowerCase() : folder);

/**
 * Pure: whether `child` is `parent` or lies inside it (case-insensitive on win32, by path.relative).
 * @param {string} child
 * @param {string} parent
 * @param {NodeJS.Platform} [platform]
 */
export function isSameOrInside(child, parent, platform = process.platform) {
  const api = pathApi(platform);
  const rel = api.relative(parent, child);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel);
}

/** A folder that cannot be used: `reason` is one of COPY_REASON_MESSAGES, `cause` the filesystem error. */
class FolderProblem extends Error {
  constructor(reason, cause) {
    super(reason);
    this.name = 'FolderProblem';
    this.reason = reason;
    this.cause = cause;
  }
}

const isMissingish = (e) => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';

const OWN_META_RE = /^local-app-studio-.+\.meta\.json$/;

/** `dev:ino` of a path (bigint stat), or null when it cannot be read or the filesystem reports no inode. */
async function identityOf(target, fsOps) {
  try {
    const st = await fsOps.stat(target, { bigint: true });
    if (String(st.ino) === '0') return null;
    return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
}

/**
 * Whether a folder is, or lies inside, the data folder or the local backups folder under another path
 * (a `\localhost\C$` share, a mapped drive, a junction): compares dev and ino of the folder and of
 * every ancestor up to its root with the two protected folders.
 */
async function isSameFileAsProtected(real, { fsOps, dataDir, localDir }) {
  const protectedIds = new Set();
  for (const root of [dataDir, localDir]) {
    const id = await identityOf(root, fsOps);
    if (id) protectedIds.add(id);
  }
  if (protectedIds.size === 0) return false;
  for (let p = real; ; p = path.dirname(p)) {
    const id = await identityOf(p, fsOps);
    if (id && protectedIds.has(id)) return true;
    if (path.dirname(p) === p) return false;
  }
}

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const STATE_MARKERS = ['lastRunAt', 'confirmedId', 'secondCopy'];

/** A backups state.json of this app: an object with formatVersion 1 and one of its own keys. */
async function isAppStateFile(file, fsOps) {
  const state = await readJsonOrNull(file, fsOps);
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return false;
  return state.formatVersion === 1 && STATE_MARKERS.some((key) => key in state);
}

/** Whether a file starts with the SQLite header (an unrelated app.db is not ours). */
async function isSqliteFile(file, fsOps) {
  let handle = null;
  try {
    handle = await fsOps.open(file, 'r');
    const buf = Buffer.alloc(SQLITE_MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return bytesRead === SQLITE_MAGIC.length && buf.equals(SQLITE_MAGIC);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Whether a folder looks like any install's own backups or data folder: it holds this app's state.json (a
 * parsed object with formatVersion 1 and lastRunAt, confirmedId or secondCopy) or a real SQLite app.db, or a
 * backup meta that is not a copy (no copiedFrom), or it is named `backups` beside an app.db.
 */
async function looksLikeAppFolder(real, fsOps) {
  let names;
  try {
    names = await fsOps.readdir(real);
  } catch (e) {
    throw new FolderProblem(isMissingish(e) ? 'missing' : 'not_writable', e);
  }
  if (names.includes('state.json') && (await isAppStateFile(path.join(real, 'state.json'), fsOps))) return true;
  if (names.includes('app.db') && (await isSqliteFile(path.join(real, 'app.db'), fsOps))) return true;
  for (const name of names) {
    if (!OWN_META_RE.test(name)) continue;
    const meta = await readJsonOrNull(path.join(real, name), fsOps);
    if (meta !== null && typeof meta === 'object' && !Array.isArray(meta) && meta.copiedFrom === undefined) return true;
  }
  if (path.basename(real).toLowerCase() === 'backups') {
    try {
      await fsOps.lstat(path.join(path.dirname(real), 'app.db'));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Looks at a destination folder: it must exist, be a folder (links are followed), lie outside the data
 * folder and the local backups folder (by real path and by file identity), not look like any install's
 * backups or data folder, and optionally accept a probe file.
 * @returns {Promise<string>} the real path of the folder
 */
async function inspectFolder(folder, { fsOps, dataDir, localDir, platform, probe }) {
  let real;
  try {
    real = await fsOps.realpath(folder);
  } catch (e) {
    throw new FolderProblem(isMissingish(e) ? 'missing' : 'not_writable', e);
  }
  let st;
  try {
    st = await fsOps.lstat(real);
  } catch (e) {
    throw new FolderProblem(isMissingish(e) ? 'missing' : 'not_writable', e);
  }
  if (!st.isDirectory()) throw new FolderProblem('not_a_folder');
  const protectedRoots = [];
  for (const root of [dataDir, localDir]) {
    protectedRoots.push(path.resolve(root));
    try {
      protectedRoots.push(await fsOps.realpath(root));
    } catch {
      // a folder that is not there cannot contain the destination
    }
  }
  for (const candidate of [path.resolve(folder), real]) {
    if (protectedRoots.some((root) => isSameOrInside(candidate, root, platform))) throw new FolderProblem('inside_data_folder');
  }
  if (await isSameFileAsProtected(real, { fsOps, dataDir, localDir })) throw new FolderProblem('inside_data_folder');
  if (await looksLikeAppFolder(real, fsOps)) throw new FolderProblem('app_folder');
  if (probe) {
    const file = path.join(real, `.local-app-studio-probe.${hex(4)}.copy-tmp`);
    try {
      const handle = await fsOps.open(file, 'wx', 0o600);
      await handle.close();
    } catch (e) {
      throw new FolderProblem('not_writable', e);
    }
    await rmWithRetry(file, { fsOps }).catch(() => {});
  }
  return real;
}

/** Stored value of backup.copyTo: `{ folder: string | null, changedAt: string | null }`; damaged means off. */
export async function getCopyTo({ platform = process.platform } = {}) {
  const stored = await getState(COPY_TO_KEY, null);
  const off = { folder: null, changedAt: null };
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored) || typeof stored.folder !== 'string') return off;
  let folder;
  try {
    folder = normalizeFolder(stored.folder, platform);
  } catch {
    return off;
  }
  const changedAt = typeof stored.changedAt === 'string' && Number.isFinite(Date.parse(stored.changedAt)) ? stored.changedAt : null;
  return { folder, changedAt };
}

/**
 * Validates, checks the folder on disk (exists, writable, outside the data folder) and saves. `folder:
 * null` turns the second copy off (the row stays, with folder null).
 * @param {unknown} input
 * A folder that does not answer within `inspectTimeoutMs` is refused as `slow`; while an earlier inspection
 * is still unsettled (a hung network path) a new save is refused the same way, so calls never pile up.
 * @param {{ fsOps?: import('./fsops.js').FsOps, dataDir?: string, dir?: string, platform?: NodeJS.Platform,
 *   now?: Date, inspectTimeoutMs?: number, timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout } }} [opts]
 * @returns {Promise<{ folder: string | null, changedAt: string }>}
 */
export async function saveCopyTo(input, opts = {}) {
  const {
    fsOps = createFsOps(),
    dataDir = dataDirOf(),
    dir = backupsDir(),
    platform = process.platform,
    now = new Date(),
    inspectTimeoutMs = SAVE_INSPECT_TIMEOUT_MS,
    timers = { setTimeout, clearTimeout },
  } = opts;
  const { folder } = validateCopyToInput(input, platform);
  if (folder !== null) {
    if (saveInspecting) throw reasonError('slow');
    let timer;
    try {
      saveInspecting = true;
      const inspection = inspectFolder(folder, { fsOps, dataDir, localDir: dir, platform, probe: true });
      const release = () => {
        saveInspecting = false;
      };
      inspection.then(release, release);
      const timeout = new Promise((_, reject) => {
        timer = timers.setTimeout(() => reject(new FolderProblem('slow')), inspectTimeoutMs);
        timer?.unref?.();
      });
      await Promise.race([inspection, timeout]);
    } catch (e) {
      if (e instanceof FolderProblem) throw reasonError(e.reason);
      throw e;
    } finally {
      timers.clearTimeout(timer);
    }
  }
  const value = { folder, changedAt: now.toISOString() };
  await setState(COPY_TO_KEY, value);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

const defaultSecondCopyState = () => ({
  originId: null,
  folderKey: null,
  lastCopiedId: null,
  lastAttemptAt: null,
  lastResult: null,
  lastError: null,
  lastSuccessAt: null,
  lastFailureAt: null,
});

const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isoOrNull = (v) => (isIso(v) ? v : null);

/** The secondCopy record of state.json, with defaults and only valid fields. */
export function readSecondCopyState(state) {
  const raw = state?.secondCopy;
  const base = defaultSecondCopyState();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base;
  return {
    originId: typeof raw.originId === 'string' && /^[0-9a-f]{16}$/.test(raw.originId) ? raw.originId : null,
    folderKey: typeof raw.folderKey === 'string' ? raw.folderKey : null,
    lastCopiedId: typeof raw.lastCopiedId === 'string' && ID_RE.test(raw.lastCopiedId) ? raw.lastCopiedId : null,
    lastAttemptAt: isoOrNull(raw.lastAttemptAt),
    lastResult: raw.lastResult === 'ok' || raw.lastResult === 'failed' ? raw.lastResult : null,
    lastError: COPY_ERROR_CODES.includes(raw.lastError) ? raw.lastError : null,
    lastSuccessAt: isoOrNull(raw.lastSuccessAt),
    lastFailureAt: isoOrNull(raw.lastFailureAt),
  };
}

/** The newest verified automatic or manual backup (the one the second copy mirrors). */
const copyCandidate = (metas) => metas.find((m) => m.status === 'verified' && (m.kind === 'auto' || m.kind === 'manual')) ?? null;

/**
 * Status for the API. health: off (no folder), failing (the last attempt failed after the last success),
 * pending (the newest verified backup is not in the folder yet), ok otherwise (also while there is no
 * backup to copy yet).
 * @param {{ dir?: string, fsOps?: import('./fsops.js').FsOps, state?: object, metas?: object[],
 *   platform?: NodeJS.Platform }} [opts] state and metas may be passed in when the caller has read them
 */
export async function getSecondCopyStatus({ dir = backupsDir(), fsOps = createFsOps(), state, metas, platform = process.platform } = {}) {
  let setting = { folder: null };
  try {
    setting = await getCopyTo({ platform });
  } catch {
    // unreadable during a restore: report off rather than guess
  }
  const sc = readSecondCopyState(state ?? (await readState(dir, fsOps)));
  const out = {
    enabled: setting.folder !== null,
    folder: setting.folder,
    health: 'off',
    lastSuccessAt: sc.lastSuccessAt,
    lastFailureAt: sc.lastFailureAt,
    lastError: sc.lastResult === 'failed' ? sc.lastError : null,
    lastCopiedId: sc.lastCopiedId,
  };
  if (setting.folder === null) return out;
  const sameFolder = sc.folderKey === folderKeyOf(setting.folder, platform);
  if (!sameFolder) {
    // A folder that was never copied to: no success or failure of an earlier folder counts for it.
    out.lastSuccessAt = null;
    out.lastFailureAt = null;
    out.lastError = null;
    out.lastCopiedId = null;
  } else if (
    sc.lastResult === 'failed' &&
    isIso(sc.lastFailureAt) &&
    (!isIso(sc.lastSuccessAt) || Date.parse(sc.lastFailureAt) > Date.parse(sc.lastSuccessAt))
  ) {
    out.health = 'failing';
    return out;
  }
  const newest = copyCandidate(metas ?? (await listMetas(dir, fsOps)));
  out.health = newest && newest.id !== out.lastCopiedId ? 'pending' : 'ok';
  return out;
}

// ---------------------------------------------------------------------------------------------
// The copy job
// ---------------------------------------------------------------------------------------------

/** An error that already carries its copy_* code. */
const copyError = (copyCode, cause) => Object.assign(new Error(copyCode), { copyCode, cause });

/**
 * Failure class of an error: a copy_* code it carries, else by the filesystem error code.
 * @param {unknown} e
 * @returns {string} one of COPY_ERROR_CODES
 */
export function classifyCopyError(e) {
  const code = /** @type {{ copyCode?: string, code?: string }} */ (e)?.copyCode;
  if (typeof code === 'string' && COPY_ERROR_CODES.includes(code)) return code;
  const errno = /** @type {{ code?: string }} */ (e)?.code;
  if (errno === 'ENOENT' || errno === 'ENOTDIR') return 'copy_folder_missing';
  if (errno === 'EACCES' || errno === 'EPERM' || errno === 'EROFS') return 'copy_not_writable';
  if (errno === 'ENOSPC' || errno === 'EDQUOT' || isNoSpaceError(e)) return 'copy_disk_full';
  if (errno === 'EBUSY') return 'copy_locked';
  return 'copy_failed';
}

function classifyProblem(problem) {
  if (problem.reason === 'inside_data_folder') return 'copy_folder_inside_data';
  if (problem.reason === 'app_folder') return 'copy_app_folder';
  if (problem.reason === 'missing' || problem.reason === 'not_a_folder') return 'copy_folder_missing';
  return problem.cause ? classifyCopyError(problem.cause) : 'copy_not_writable';
}

const tempNameOf = (id, ext) => `.local-app-studio-${id}${ext}.${hex(4)}.copy-tmp`;

/** Rejects with the signal's reason as soon as it aborts, even when a disk call never returns. */
function guarded(work, signal) {
  return Promise.race([
    work,
    new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

async function hashFile(file, fsOps, signal) {
  const hash = crypto.createHash('sha256');
  const handle = await fsOps.open(file, 'r');
  try {
    const buf = Buffer.alloc(CHUNK_BYTES);
    for (;;) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function writeAll(handle, buf, length) {
  let written = 0;
  while (written < length) {
    const { bytesWritten } = await handle.write(buf, written, length - written, null);
    written += bytesWritten;
  }
}

/** Opens the destination temp file; a busy file (EBUSY) is retried a few times. */
async function openTemp(file, fsOps) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fsOps.open(file, 'wx', 0o600);
    } catch (e) {
      if (e?.code !== 'EBUSY' || attempt >= 3) throw e;
      await fsOps.sleep(50 * 2 ** attempt);
    }
  }
}

/**
 * Copies one local backup file into the destination: temp name, fsync, optional sha256 check, rename.
 * Leaves no file under the final name unless every step succeeded.
 */
async function copyOneFile({ id, ext, source, destDir, expectSha, fsOps, signal }) {
  const tmp = path.join(destDir, tempNameOf(id, ext));
  const final = path.join(destDir, `local-app-studio-${id}${ext}`);
  let src = null;
  let out = null;
  let done = false;
  try {
    try {
      src = await fsOps.open(source, 'r');
    } catch (e) {
      throw copyError('copy_failed', e);
    }
    out = await openTemp(tmp, fsOps);
    const buf = Buffer.alloc(CHUNK_BYTES);
    for (;;) {
      signal.throwIfAborted();
      let bytesRead;
      try {
        ({ bytesRead } = await src.read(buf, 0, buf.length, null));
      } catch (e) {
        throw copyError('copy_failed', e);
      }
      if (bytesRead === 0) break;
      await writeAll(out, buf, bytesRead);
    }
    await out.sync();
    await out.close();
    out = null;
    signal.throwIfAborted();
    if (expectSha !== undefined) {
      const digest = await hashFile(tmp, fsOps, signal);
      if (digest !== expectSha) throw copyError('copy_verify_failed');
    }
    signal.throwIfAborted();
    await renameWithRetry(tmp, final, { fsOps });
    done = true;
  } finally {
    await src?.close().catch(() => {});
    await out?.close().catch(() => {});
    if (!done) await fsOps.rm(tmp, { force: true }).catch(() => {});
  }
}

/** Writes the destination meta (the local meta plus copiedFrom and copiedAt): temp name, then rename. */
async function copyMeta({ meta, originId, copiedAt, destDir, fsOps, signal }) {
  const tmp = path.join(destDir, tempNameOf(meta.id, '.meta.json'));
  const final = path.join(destDir, `local-app-studio-${meta.id}.meta.json`);
  let done = false;
  try {
    signal.throwIfAborted();
    await writeFileSynced(tmp, `${JSON.stringify({ ...meta, copiedFrom: originId, copiedAt }, null, 2)}\n`, fsOps);
    signal.throwIfAborted();
    await renameWithRetry(tmp, final, { fsOps });
    done = true;
  } finally {
    if (!done) await fsOps.rm(tmp, { force: true }).catch(() => {});
  }
}

/** Removes our own temp files older than an hour, matched by the exact pattern, regular files only. */
async function cleanupTemps({ destDir, nowMs, fsOps }) {
  let names;
  try {
    names = await fsOps.readdir(destDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!TEMP_RE.test(name)) continue;
    const file = path.join(destDir, name);
    try {
      const st = await fsOps.lstat(file);
      if (!st.isFile() || st.isSymbolicLink() || nowMs - st.mtimeMs < TEMP_MIN_AGE_MS) continue;
      await rmWithRetry(file, { fsOps });
    } catch {
      // gone already or locked: next run
    }
  }
}

/**
 * Destination retention: the same plan as the local folder, over the metas this install copied (copiedFrom
 * equals originId) only. Per backup it deletes the .db and the .export.zip first and the meta last, by exact
 * name from a valid id, and only a regular file (lstat). When a data file cannot be deleted the meta stays, so
 * a later run still recognizes the backup and retries. Anything else in the folder is never touched.
 */
async function applyDestRetention({ destDir, originId, settings, now, protectId, fsOps }) {
  const own = (await listMetas(destDir, fsOps, { includeCopied: true })).filter((m) => m.copiedFrom === originId && ID_RE.test(m.id));
  const { remove } = planRetention(own, settings, now, { protectIds: [protectId] });
  for (const meta of remove) {
    for (const ext of ['.db', '.export.zip', '.meta.json']) {
      const file = path.join(destDir, `local-app-studio-${meta.id}${ext}`);
      try {
        const st = await fsOps.lstat(file);
        if (!st.isFile() || st.isSymbolicLink()) continue;
        await rmWithRetry(file, { fsOps });
      } catch (e) {
        if (isMissing(e)) continue;
        // locked: keep the meta so the next run retries this backup
        break;
      }
    }
  }
}

const resolveNow = (now) => (typeof now === 'function' ? now() : now instanceof Date ? now : new Date());

/**
 * @typedef {object} CopyOptions
 * @property {string} [dir] local backups folder (default: the real one)
 * @property {string} [dataDir] data folder (default: the real one)
 * @property {import('./fsops.js').FsOps} [fsOps]
 * @property {Date | (() => Date)} [now]
 * @property {number} [timeoutMs]
 * @property {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} [timers] test seam
 * @property {NodeJS.Platform} [platform]
 * @property {{ keepDaily: number, keepWeekly: number, keepMonthly: number }} [settings]
 */

/**
 * One copy attempt. Never throws: the result says what happened and the outcome is recorded in
 * state.json (secondCopy). A shutdown abort records nothing, so the next start retries.
 * @param {CopyOptions} opts
 * @param {AbortController} controller
 * @returns {Promise<{ result: 'ok' | 'failed' | 'skipped' | 'aborted', code?: string, id?: string, skipped?: string }>}
 */
async function runCopyJob(opts, controller) {
  const {
    dir = backupsDir(),
    fsOps = createFsOps(),
    platform = process.platform,
    timeoutMs = COPY_TIMEOUT_MS,
    timers = { setTimeout, clearTimeout },
  } = opts;
  let setting;
  let state;
  let metas;
  let dataDir;
  try {
    setting = await getCopyTo({ platform });
    if (setting.folder === null) return { result: 'skipped', skipped: 'off' };
    ensureBackupsDir(dir);
    dataDir = opts.dataDir ?? dataDirOf();
    [state, metas] = await Promise.all([readState(dir, fsOps), listMetas(dir, fsOps)]);
  } catch {
    // the database or the local folder is not readable right now (a restore): the next tick retries
    return { result: 'skipped', skipped: 'unavailable' };
  }
  const folder = setting.folder;
  const folderKey = folderKeyOf(folder, platform);
  let sc = readSecondCopyState(state);
  const sameFolder = sc.folderKey === folderKey;
  const newest = copyCandidate(metas);
  if (!newest) return { result: 'skipped', skipped: 'nothing_to_copy' };
  if (sameFolder && sc.lastCopiedId === newest.id) return { result: 'skipped', skipped: 'current' };
  if (innerBusy) {
    // An earlier job timed out but its disk call has not come back: starting another would pile up stuck
    // calls. Say so for this folder (a fresh failure time, copy_stuck) so the status stops promising a retry.
    const stuckAt = resolveNow(opts.now).toISOString();
    await writeState(
      {
        secondCopy: {
          ...sc,
          folderKey,
          lastCopiedId: sameFolder ? sc.lastCopiedId : null,
          lastAttemptAt: stuckAt,
          lastResult: 'failed',
          lastError: 'copy_stuck',
          lastSuccessAt: sameFolder ? sc.lastSuccessAt : null,
          lastFailureAt: stuckAt,
        },
      },
      { dir, fsOps },
    ).catch(() => {});
    return { result: 'skipped', skipped: 'busy' };
  }

  const { signal } = controller;
  const timer = timers.setTimeout(() => controller.abort(copyError('copy_timeout')), timeoutMs);
  timer?.unref?.();
  const at = () => resolveNow(opts.now);
  const record = (patch) =>
    writeState({ secondCopy: { ...sc, ...patch, originId: sc.originId, folderKey } }, { dir, fsOps });
  try {
    if (!sc.originId) {
      sc = { ...sc, originId: hex(8) };
      await writeState({ secondCopy: sc }, { dir, fsOps });
    }
    const originId = sc.originId;
    innerBusy = true;
    const work = (async () => {
      let destDir;
      try {
        destDir = await inspectFolder(folder, { fsOps, dataDir, localDir: dir, platform, probe: false });
      } catch (e) {
        if (e instanceof FolderProblem) throw copyError(classifyProblem(e), e.cause);
        throw e;
      }
      await cleanupTemps({ destDir, nowMs: at().getTime(), fsOps });
      const { id } = newest;
      await copyOneFile({
        id,
        ext: '.db',
        source: resolveBackupFile(id, '.db', dir),
        destDir,
        expectSha: newest.db?.sha256 ?? null,
        fsOps,
        signal,
      });
      if (newest.export?.file) {
        await copyOneFile({
          id,
          ext: '.export.zip',
          source: resolveBackupFile(id, '.export.zip', dir),
          destDir,
          expectSha: newest.export.sha256 ?? null,
          fsOps,
          signal,
        });
      }
      const copiedAt = at().toISOString();
      await copyMeta({ meta: newest, originId, copiedAt, destDir, fsOps, signal });
      const lastSettings = opts.settings ?? (await getBackupSettings().catch(() => null));
      if (lastSettings) {
        await applyDestRetention({
          destDir,
          originId,
          settings: lastSettings,
          now: at(),
          protectId: newest.id,
          fsOps,
        }).catch(() => {});
      }
      return { destDir, copiedAt };
    })();
    // The slot stays busy until the inner work has really settled, even after a timeout.
    const release = () => {
      innerBusy = false;
    };
    work.then(release, release);
    const outcome = await guarded(work, signal);
    await record({
      lastCopiedId: newest.id,
      lastAttemptAt: outcome.copiedAt,
      lastResult: 'ok',
      lastError: null,
      lastSuccessAt: outcome.copiedAt,
      lastFailureAt: sameFolder ? sc.lastFailureAt : null,
    });
    return { result: 'ok', id: newest.id };
  } catch (e) {
    // The server is exiting: record nothing, the next start retries.
    if (e?.copyCode === 'copy_aborted') return { result: 'aborted' };
    const code = classifyCopyError(e);
    const failedAt = at().toISOString();
    await record({
      lastCopiedId: sameFolder ? sc.lastCopiedId : null,
      lastAttemptAt: failedAt,
      lastResult: 'failed',
      lastError: code,
      lastSuccessAt: sameFolder ? sc.lastSuccessAt : null,
      lastFailureAt: failedAt,
    }).catch(() => {});
    return { result: 'failed', code };
  } finally {
    timers.clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// One job at a time, fire and forget
// ---------------------------------------------------------------------------------------------

/** @type {{ controller: AbortController, promise: Promise<object> } | null} */
let current = null;
/** True while the inner destination work of a job is unsettled (it may outlive a timeout). */
let innerBusy = false;
/** True while the inspection of an earlier saved folder is unsettled (a hung path). */
let saveInspecting = false;
/** @type {CopyOptions | null} */
let again = null;
let shuttingDown = false;

/**
 * Asks for a copy of the newest verified backup. Returns at once with a promise that never rejects; the
 * caller does not wait for it. A request while a copy runs makes it run once more afterwards. Never
 * takes the backup lock and never blocks a backup, a restore or exit.
 * @param {CopyOptions} [opts]
 * @returns {Promise<object>}
 */
export function requestSecondCopy(opts = {}) {
  if (shuttingDown) return Promise.resolve({ result: 'skipped', skipped: 'shutting_down' });
  if (current) {
    again = opts;
    return current.promise;
  }
  const slot = { controller: new AbortController(), promise: Promise.resolve({}) };
  current = slot;
  slot.promise = (async () => {
    let next = opts;
    let last;
    try {
      for (;;) {
        again = null;
        slot.controller = new AbortController();
        try {
          last = await runCopyJob(next, slot.controller);
        } catch {
          last = { result: 'failed', code: 'copy_failed' };
        }
        if (!again || shuttingDown) break;
        next = again;
      }
    } finally {
      again = null;
      if (current === slot) current = null;
    }
    return last;
  })();
  return slot.promise;
}

/** Resolves when no copy is running (for tests and for callers that must not overlap). */
export const whenSecondCopyIdle = async () => {
  while (current) await current.promise;
};

/**
 * Stops a running copy (the server is exiting) and refuses new ones until resumeSecondCopy(). The unfinished
 * copy leaves only temp files and is retried on the next start. Never waits.
 */
export function abortSecondCopy() {
  shuttingDown = true;
  again = null;
  current?.controller.abort(copyError('copy_aborted'));
}

/** Allows copies again (the server starts). */
export function resumeSecondCopy() {
  shuttingDown = false;
}

/** Test seam: forget any running job and re-allow requests. */
export function __resetSecondCopyForTests() {
  current?.controller.abort(copyError('copy_aborted'));
  current = null;
  again = null;
  innerBusy = false;
  saveInspecting = false;
  shuttingDown = false;
}
