// The words of the CSV import, built on the server so the panel only shows `lines` and `errors[].message` as given (F2).
// Pure, no imports. Cell text in a line is clipped to 60 characters; nothing here echoes a whole cell or file name.

const CLIP = 60;

/** A cell or header as shown in a line: clipped to 60 characters. */
export function clipText(text, max = CLIP) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/** "Row 58: Due must be a date like 2025-01-31." */
export function rowLine(row, message) {
  return `Row ${row}: ${message}`;
}

/** "Row 201: there is no Clients record named "Acme Ltd"." */
export function missingLinkMessage(tableLabel, title) {
  return `there is no ${tableLabel} record named "${clipText(title)}".`;
}

/** Two or more records with one title: refused with the count, never guessed. */
export function ambiguousLinkMessage(tableLabel, title, count) {
  return `${count} ${tableLabel} records are named "${clipText(title)}". Give one of them another name, then import again.`;
}

/** "1 row", "2 rows": the count with its noun. */
const rowCount = (n) => `${n} ${n === 1 ? 'row' : 'rows'}`;

/**
 * The lines of a dry run: how many rows can be added and left out, then the columns that are not imported.
 * When no column matches a field the count line would read "0 rows can be added", which hides the cause, so it says that instead.
 * @param {{ valid: number, invalid: number, leftOut: string[], noMatch?: boolean }} r
 * @returns {string[]}
 */
export function dryRunLines({ valid, invalid, leftOut, noMatch = false }) {
  const lines = [noMatch ? 'No column matches a field of this table.' : `${rowCount(valid)} can be added. ${rowCount(invalid)} will be left out.`];
  if (leftOut.length > 0) lines.push(`Left out: ${leftOut.map((h) => clipText(h)).join(', ')}.`);
  return lines;
}

/**
 * The lines of a real run, and the way to carry on when it stopped.
 * @param {{ added: number, stoppedAt: number | null }} r
 * @returns {string[]}
 */
export function resultLines({ added, stoppedAt }) {
  const lines = [`Added ${rowCount(added)}.`];
  if (stoppedAt !== null) lines.push(`Nothing from row ${stoppedAt} on was added. Import again from row ${stoppedAt}.`);
  return lines;
}
