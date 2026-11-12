// Backup and restore error type. Messages are fixed, plain copy: never row data, paths or upstream text.
import { getAppMode } from '../appMode.js';

const STATUS = Object.freeze({
  backup_busy: 409,
  db_restoring: 503,
  disk_low: 507,
  disk_full: 507,
  backup_not_found: 404,
  backup_invalid: 422,
  backup_too_new: 409,
  upload_expired: 410,
  too_large: 413,
  unsupported_media_type: 415,
  invalid_request: 400,
  invalid_settings: 400,
  backup_failed: 500,
  restore_failed: 500,
  restore_recovery_failed: 500,
  stable_not_found: 404,
  stable_busy: 409,
  stable_too_new: 409,
  stable_same_folder: 409,
  stable_invalid: 422,
});

export const BACKUP_MESSAGES = Object.freeze({
  backup_busy: 'A backup or restore is already running. Try again in a moment.',
  db_restoring: 'Local App Studio is restoring a backup. This takes a few seconds.',
  disk_low: 'There is not enough free disk space to make a backup. Free up some space and try again.',
  disk_full: 'The disk filled up while making the backup. Free up some space and try again.',
  backup_not_found: 'That backup could not be found.',
  backup_invalid: 'That file is not a usable Local App Studio backup.',
  backup_too_new: 'This backup was made by a newer version of Local App Studio. Update Local App Studio, then try again.',
  upload_expired: 'That upload expired. Choose the file again.',
  too_large: 'That file is too large to restore here.',
  unsupported_media_type: 'Send the backup file as raw bytes.',
  invalid_request: 'That request was not valid.',
  invalid_settings: 'Those backup settings are not valid.',
  backup_failed: 'The backup could not be made.',
  restore_failed: 'The restore did not finish. Your current data was kept.',
  restore_recovery_failed: 'Local App Studio could not finish recovering an interrupted backup restore.',
  stable_not_found: 'No Local App Studio data was found on this computer to copy.',
  stable_busy: 'Local App Studio is busy with its data right now. Try again in a moment, or close Local App Studio first.',
  stable_too_new:
    'Your Local App Studio data comes from a newer version than this Local App Studio Dev build. Update Local App Studio Dev, then try again.',
  stable_same_folder: 'Local App Studio Dev is using the same data folder as Local App Studio, so there is nothing to copy.',
  stable_invalid: 'Your Local App Studio data could not be read, so nothing was copied. Local App Studio was not changed.',
});

/** The sentences that name the product, as a built app words them ("this app", never Local App Studio; phase 27 L-6). */
const BUILT_APP_MESSAGES = Object.freeze({
  db_restoring: 'This app is restoring a backup. This takes a few seconds.',
  backup_invalid: 'That file is not a usable backup of this app.',
  backup_too_new: 'This backup was made by a newer version of this app. Update this app, then try again.',
  restore_recovery_failed: 'This app could not finish recovering an interrupted backup restore.',
});

/**
 * The sentence of a backup error code in the words of the running product: a built app says "this app".
 * @param {string} code one of the keys of BACKUP_MESSAGES
 * @param {'studio' | 'runtime'} [mode] the app mode (default: this server's)
 * @returns {string | undefined}
 */
export function backupMessage(code, mode = getAppMode()) {
  return (mode === 'runtime' ? BUILT_APP_MESSAGES[code] : undefined) ?? BACKUP_MESSAGES[code];
}

export class BackupError extends Error {
  /**
   * @param {string} code one of the keys of BACKUP_MESSAGES
   * @param {{ message?: string, cause?: unknown }} [opts]
   */
  constructor(code, opts = {}) {
    super(opts.message ?? backupMessage(code) ?? 'Backup error');
    this.name = 'BackupError';
    this.code = code;
    this.status = STATUS[code] ?? 500;
    this.cause = opts.cause;
  }
}

export const isBackupError = (e) => e instanceof BackupError;

/** True for an out-of-space failure from the filesystem or SQLite. */
export function isNoSpaceError(e) {
  if (!e || typeof e !== 'object') return false;
  const { code, message } = /** @type {{ code?: unknown, message?: unknown }} */ (e);
  if (code === 'ENOSPC' || code === 'SQLITE_FULL') return true;
  return typeof message === 'string' && /ENOSPC|database or disk is full|no space left/i.test(message);
}
