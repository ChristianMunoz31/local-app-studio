// RFC 4180 CSV for the data export. The formula-injection guard applies to EVERY string
// cell (including bare strings in jsonb columns such as app_state.value), except plain
// numbers in numeric-typed columns, so -12.50 stays numeric.

// One or more quotes may come first: a cell that already starts with our own guard quote is guarded again, so a reader that
// strips one quote (packages/runtime/server/csvParse.js unguardCell) can never expose a formula on the next export.
const FORMULA_START_RE = /^(?:'*\s*[=+\-@]|'*[\t\r])/;
const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/;
const NUMERIC_TYPES = new Set(['numeric', 'integer', 'real']);
const NEEDS_QUOTES_RE = /[",\r\n]/;

export function cellText(value, type) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && FORMULA_START_RE.test(text)) {
    const plainNumber = NUMERIC_TYPES.has(type) && PLAIN_NUMBER_RE.test(text);
    if (!plainNumber) text = `'${text}`;
  }
  return NEEDS_QUOTES_RE.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param {ReadonlyArray<{ name: string, type: string }>} columns
 * @param {ReadonlyArray<Record<string, unknown>>} rows
 * @returns {string} CSV with CRLF row endings (header-only when there are no rows)
 */
export function toCsv(columns, rows) {
  return csvHeader(columns) + csvRows(columns, rows);
}

/** @returns {string} the header row, CRLF ended */
export function csvHeader(columns) {
  return `${columns.map((c) => cellText(c.name, 'header')).join(',')}\r\n`;
}

/** @returns {string} the rows only (no header), each CRLF ended; lets a stream write page by page */
export function csvRows(columns, rows) {
  let out = '';
  for (const row of rows) out += `${columns.map((c) => cellText(row?.[c.name], c.type)).join(',')}\r\n`;
  return out;
}
