// Words and names around exporting and duplicating an app (phase 17, P17-15 and P17-16). Pure.
import { NAME_MAX } from './appName';

/** Characters Windows does not allow in a file name, plus control characters. */
const FORBIDDEN_IN_FILE_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;

/** The file an export is saved as: the app's name and "app.json" ("Job Green app.json"), or "app.zip" with records, safe on Windows. */
export function exportFileName(appName: string, extension: 'json' | 'zip' = 'json'): string {
  const clean = appName.replace(FORBIDDEN_IN_FILE_NAME, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return `${clean === '' ? 'My' : clean} app.${extension}`;
}

/** The status line after an export. */
export const exportedNotice = (appName: string, file: string): string =>
  `Exported "${appName}" as ${file}. It holds the design. Records added in Preview stay on this computer.`;

/** The status line after an export with records. */
export const exportedWithRecordsNotice = (appName: string, file: string): string =>
  `Exported "${appName}" as ${file}. It holds the design and the records in Preview. Bring the records back with Settings, Import in the built app.`;

export const EXPORT_RECORDS_FAILED = 'Could not export the app with its records. Nothing was changed. Try again.';

/** The name the server gives a copy when none is sent (server/studio/specCheck.js copyName). */
export function defaultCopyName(name: string): string {
  const full = `${name} Copy`;
  return full.length <= NAME_MAX ? full : `${name.slice(0, NAME_MAX - 5).trimEnd()} Copy`;
}

export const DUPLICATE_TITLE_PREFIX = 'Duplicate';
export const DUPLICATE_NAME_LABEL = 'Name';
export const DUPLICATE_NO_RECORDS = 'The copy starts with no records.';
export const DUPLICATE_WITH_SAMPLE = 'The copy starts with the sample records.';
export const DUPLICATE_KEEP_RECORDS = 'Keep the records from Preview';
export const DUPLICATE_COPIED_RECORDS = 'The copy has the records from Preview.';
export const DUPLICATE_NONE_IN_PREVIEW = 'The copy starts with no records. This app had none in Preview.';
export const DUPLICATE_CONFIRM = 'Duplicate';
export const DUPLICATE_BUSY = 'Duplicating...';
export const DUPLICATE_FAILED = 'Could not duplicate the app. Nothing was changed. Try again.';
export const EXPORT_FAILED = 'Could not export the app. Nothing was changed. Try again.';

/** The status line after a duplicate. */
export const duplicatedNotice = (from: string, to: string, withSample = false, recordsAsked?: boolean, recordsCopied?: boolean): string => {
  const words =
    recordsAsked === true
      ? recordsCopied === true
        ? DUPLICATE_COPIED_RECORDS
        : DUPLICATE_NONE_IN_PREVIEW
      : withSample
        ? DUPLICATE_WITH_SAMPLE
        : DUPLICATE_NO_RECORDS;
  return `Duplicated "${from}" as "${to}". ${words}`;
};

/** The line on an app card when a helper design waits for it ("A design is waiting: 1 table, 2 pages."). */
export function waitingLine(waiting: { tableCount: number; pageCount: number }): string {
  const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
  return `A design is waiting: ${plural(waiting.tableCount, 'table')}, ${plural(waiting.pageCount, 'page')}.`;
}
