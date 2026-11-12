// The CSV reader of the import route (docs/phase28 design, section 4.2). Pure, no imports. Nothing in a cell is ever evaluated:
// a cell that looks like a formula is text, and unguardCell only removes the single quote our own export puts in front of it.

export const CSV_LIMITS = Object.freeze({ maxRows: 200_000, maxColumns: 200, maxCellChars: 20_000 });

const DELIMITERS = [',', ';', '\t'];
const FORMULA_START_RE = /^(?:'*\s*[=+\-@]|'*[\t\r])/;

/**
 * The delimiter of the header line: the most frequent of comma, semicolon and tab outside double quotes. A tie or none is a comma.
 * @param {string} headerLine
 * @returns {',' | ';' | '\t'}
 */
export function detectDelimiter(headerLine) {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of String(headerLine)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  const best = Math.max(...counts.values());
  if (best === 0) return ',';
  const top = DELIMITERS.filter((d) => counts.get(d) === best);
  return top.length === 1 ? top[0] : ',';
}

/**
 * Removes the one quote our export puts in front of a cell that would read as a formula: the exact inverse of server/export/csv.js cellText.
 * @param {string} cell
 * @returns {string}
 */
export function unguardCell(cell) {
  return typeof cell === 'string' && cell.startsWith("'") && FORMULA_START_RE.test(cell.slice(1)) ? cell.slice(1) : cell;
}

/** The raw text of the first record (a quoted line end does not end it). */
function firstRecord(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) return text.slice(0, i);
  }
  return text;
}

/**
 * Splits the text into records of cells. `onRecord(cells, record)` returns false to stop. A record is numbered from 1 and
 * counts every record, empty ones too. Returns null, or the line a quote was left open on.
 */
function scan(text, delimiter, onRecord) {
  const n = text.length;
  let i = 0;
  let record = 0;
  let line = 1;
  while (i < n) {
    const cells = [];
    let cell = '';
    for (;;) {
      if (text[i] === '"') {
        const openedAt = line;
        i += 1;
        for (;;) {
          if (i >= n) return openedAt;
          const ch = text[i];
          if (ch === '"') {
            if (text[i + 1] === '"') {
              cell += '"';
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line += 1;
          cell += ch;
          i += 1;
        }
      }
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') {
        cell += text[i];
        i += 1;
      }
      cells.push(cell);
      cell = '';
      if (i < n && text[i] === delimiter) {
        i += 1;
        continue;
      }
      break;
    }
    if (i < n) {
      if (text[i] === '\r' && text[i + 1] === '\n') i += 1;
      i += 1;
      line += 1;
    }
    record += 1;
    if (onRecord(cells, record) === false) return null;
  }
  return null;
}

/**
 * @param {string} text the file text
 * @param {{ maxRows?: number }} [opts]
 * @returns {{ ok: true, delimiter: ',' | ';' | '\t', headers: string[], rows: Array<{ row: number, cells: string[] }> }
 *  | { ok: false, reason: 'empty' | 'no_header' | 'duplicate_header' | 'unclosed_quote' | 'too_many_rows' | 'too_many_columns', line: number }}
 */
export function parseCsv(text, { maxRows = CSV_LIMITS.maxRows } = {}) {
  const raw = String(text ?? '');
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (source.trim() === '') return { ok: false, reason: 'empty', line: 1 };
  const delimiter = detectDelimiter(firstRecord(source));
  let headers = null;
  const rows = [];
  let failure = null;
  const unclosed = scan(source, delimiter, (cells, record) => {
    if (headers === null) {
      const names = cells.map((c) => c.trim());
      if (names.length > CSV_LIMITS.maxColumns) failure = { ok: false, reason: 'too_many_columns', line: 1 };
      else if (names.some((h) => h === '')) failure = { ok: false, reason: 'no_header', line: 1 };
      else if (new Set(names).size !== names.length) failure = { ok: false, reason: 'duplicate_header', line: 1 };
      else headers = names;
      return failure === null;
    }
    if (cells.every((c) => c === '')) return true;
    if (rows.length >= maxRows) {
      failure = { ok: false, reason: 'too_many_rows', line: record };
      return false;
    }
    const width = headers.length;
    const padded = cells.length >= width ? cells.slice(0, width) : cells.concat(new Array(width - cells.length).fill(''));
    rows.push({ row: record, cells: padded });
    return true;
  });
  if (failure !== null) return failure;
  if (unclosed !== null) return { ok: false, reason: 'unclosed_quote', line: unclosed };
  return { ok: true, delimiter, headers, rows };
}
