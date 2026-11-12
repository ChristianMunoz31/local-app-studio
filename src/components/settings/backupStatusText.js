import { daysAgo, formatBackupDate, plural } from '../../utils/backupFormat';
import { PRODUCT_NAME, PRODUCT_NAME_START } from '../../hooks/useHiddenNetworkFeatures';

const DISK_ERRORS = new Set(['disk_low', 'disk_full']);
const FREE_SPACE = 'Free up some disk space.';
const DISK_LOW = `Disk space is low. ${FREE_SPACE}`;
const RECOVERY_REQUIRED = `${PRODUCT_NAME_START} could not finish undoing the restore. Your data is safe. Restart ${PRODUCT_NAME} to finish recovering it.`;

// Older or partial status objects may not say; only an explicit false means automatic backups are off.
const isAuto = (status) => status?.autoEnabled !== false;
const PAUSED = 'Automatic backups are paused on this computer right now.';

/** True when the user turned automatic backups off (an older status without the field says nothing). */
const switchedOff = (status) => status?.autoSwitch === false;

/** Plain-language sentence for a BackupStatus. Exported for the Settings line and tests. */
export function statusSentence(status, now = new Date()) {
  if (!status) return '';
  if (status.recoveryRequired === true) return RECOVERY_REQUIRED;
  const parts = [];
  const auto = isAuto(status);
  if (status.health === 'ok') {
    const when = formatBackupDate(status.lastSuccessAt, now);
    parts.push(when ? `Last backup: ${when}, verified.` : 'Your last backup was verified.');
  } else if (status.health === 'stale') {
    const days = daysAgo(status.lastSuccessAt, now);
    parts.push(days === null ? "It's been a while since your last backup." : `Last backup was ${plural(days, 'day', 'days')} ago.`);
    if (!auto) parts.push(switchedOff(status) ? 'Automatic backups are off.' : PAUSED);
  } else if (status.health === 'failing') {
    parts.push(
      auto
        ? `The last backup did not finish. ${PRODUCT_NAME_START} will try again.`
        : 'The last backup did not finish. Try backing up again.',
    );
    if (DISK_ERRORS.has(status.lastError) && !status.diskWarning) parts.push(FREE_SPACE);
  } else {
    parts.push('No backups yet.');
  }
  if (status.diskWarning) parts.push(DISK_LOW);
  return parts.join(' ');
}

/**
 * The gentle weekly reminder for a user who turned automatic backups off, or '' when the server says
 * it is not due (it applies the 7 day rules and the dismissal, see shouldShowAutoOffReminder).
 */
export function autoOffSentence(status, now = new Date()) {
  if (!status || !switchedOff(status) || status.autoOffReminder !== true) return '';
  const days = status.health === 'none' ? null : daysAgo(status.lastSuccessAt, now);
  return `Automatic backups are off. ${days === null ? 'No backups yet.' : `Last backup: ${plural(days, 'day', 'days')} ago.`}`;
}

/**
 * Sentence for the Home reminder, or '' when there is nothing to say. A healthy status only
 * speaks up for low disk space; "no backups yet" gets gentler wording than the Settings line. When
 * the user switched automatic backups off, "stale" and "none" are left to the weekly reminder
 * (autoOffSentence); failures, recovery and low disk space still speak up.
 */
export function noticeSentence(status, now = new Date()) {
  if (!status || status.restoring === true) return '';
  if (status.recoveryRequired === true) return RECOVERY_REQUIRED;
  if (status.health === 'ok') return status.diskWarning ? DISK_LOW : '';
  if (switchedOff(status) && (status.health === 'stale' || status.health === 'none')) {
    return status.diskWarning ? DISK_LOW : '';
  }
  if (status.health === 'stale' || status.health === 'failing') return statusSentence(status, now);
  const first = isAuto(status)
    ? `${PRODUCT_NAME_START} hasn't made a backup yet. It will make one soon.`
    : `${PRODUCT_NAME_START} hasn't made a backup yet. You can make one in Settings.`;
  return status.diskWarning ? `${first} ${DISK_LOW}` : first;
}
