// A small RFC 4180 reader for the export tests, so the tests need no CSV library. It reads what
// server/export/csv.js writes: comma separated, CRLF row ends, cells with a comma, quote or line
// break wrapped in double quotes with "" for a quote.

/**
 * @param {string} text
 * @returns {string[][]} rows of cells; an empty trailing row is dropped
 */
export function parseRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Parses CSV with a header row into objects, skipping empty lines.
 * @param {string} text
 * @returns {{ data: Array<Record<string, string>>, fields: string[] }}
 */
export function parseCsv(text) {
  const rows = parseRows(text).filter((r) => !(r.length === 1 && r[0] === ''));
  const [header = [], ...body] = rows;
  const data = body.map((r) => Object.fromEntries(header.map((name, i) => [name, r[i] ?? ''])));
  return { data, fields: header };
}
