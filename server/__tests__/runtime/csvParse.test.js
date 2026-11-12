// The CSV reader of the import route and the export guard it undoes (phase 28, section 4.2).
import { describe, expect, it } from 'vitest';
import { CSV_LIMITS, detectDelimiter, parseCsv, unguardCell } from '../../../packages/runtime/server/csvParse.js';
import { cellToValue, suggestMapping } from '../../../packages/runtime/server/importCsv.js';
import { cellText, toCsv } from '../../export/csv.js';

const ok = (text, opts) => {
  const r = parseCsv(text, opts);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r;
};

describe('parseCsv', () => {
  it('reads a header and rows with their spreadsheet row numbers', () => {
    const r = ok('a,b\n1,2\n3,4\n');
    expect(r.delimiter).toBe(',');
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows).toEqual([
      { row: 2, cells: ['1', '2'] },
      { row: 3, cells: ['3', '4'] },
    ]);
  });
  it('drops a BOM and accepts CRLF, LF and a lone CR', () => {
    for (const nl of ['\r\n', '\n', '\r']) {
      const r = ok(`${String.fromCharCode(0xfeff)}a,b${nl}1,2${nl}3,4`);
      expect(r.headers).toEqual(['a', 'b']);
      expect(r.rows.map((x) => x.cells)).toEqual([['1', '2'], ['3', '4']]);
    }
  });
  it('keeps a delimiter, a doubled quote and a line end inside quotes', () => {
    const r = ok('a,b\n"x,y","say ""hi"""\n"line1\nline2",z\n9,8');
    expect(r.rows[0].cells).toEqual(['x,y', 'say "hi"']);
    expect(r.rows[1].cells).toEqual(['line1\nline2', 'z']);
  });
  it('an embedded newline keeps the row numbers of the rows after it', () => {
    const r = ok('a,b\n"one\ntwo\r\nthree",1\nnext,2\n');
    expect(r.rows.map((x) => x.row)).toEqual([2, 3]);
  });
  it('a skipped empty record keeps its number', () => {
    const r = ok('a,b\n1,2\n\n,\n5,6\n');
    expect(r.rows.map((x) => x.row)).toEqual([2, 5]);
  });
  it('a quote inside an unquoted field is kept as text', () => {
    expect(ok('a\nsay "hi" now').rows[0].cells).toEqual(['say "hi" now']);
  });
  it('detects semicolon and tab, a tie is a comma, none is a comma', () => {
    expect(ok('a;b;c\n1;2;3').delimiter).toBe(';');
    expect(ok('a\tb\tc\n1\t2\t3').delimiter).toBe('\t');
    expect(detectDelimiter('a,b;c')).toBe(',');
    expect(detectDelimiter('a;b\tc')).toBe(',');
    expect(detectDelimiter('abc')).toBe(',');
    expect(detectDelimiter('"a;b;c";d,e,f,g')).toBe(',');
    expect(detectDelimiter('"a,b,c",d;e;f;g')).toBe(';');
  });
  it('trims header cells and pads short rows, ignoring extra cells', () => {
    const r = ok(' a , b ,c\n1\n1,2,3,4,5');
    expect(r.headers).toEqual(['a', 'b', 'c']);
    expect(r.rows[0].cells).toEqual(['1', '', '']);
    expect(r.rows[1].cells).toEqual(['1', '2', '3']);
  });
  it('refuses an empty file, an empty header name and a duplicate header', () => {
    expect(parseCsv('')).toEqual({ ok: false, reason: 'empty', line: 1 });
    expect(parseCsv(' \r\n\n')).toEqual({ ok: false, reason: 'empty', line: 1 });
    expect(parseCsv('a,,c\n1,2,3')).toEqual({ ok: false, reason: 'no_header', line: 1 });
    expect(parseCsv('a,b,a\n1,2,3')).toEqual({ ok: false, reason: 'duplicate_header', line: 1 });
  });
  it('names the line an unclosed quote opened on', () => {
    expect(parseCsv('a,b\n1,2\n3,"oops\n4,5\n')).toEqual({ ok: false, reason: 'unclosed_quote', line: 3 });
    expect(parseCsv('"a,b\n1,2')).toEqual({ ok: false, reason: 'unclosed_quote', line: 1 });
  });
  it('accepts 200 columns and refuses 201', () => {
    const cols = (n) => Array.from({ length: n }, (_, i) => `c${i}`).join(',');
    expect(ok(`${cols(CSV_LIMITS.maxColumns)}\n`).headers).toHaveLength(200);
    expect(parseCsv(`${cols(201)}\n`)).toEqual({ ok: false, reason: 'too_many_columns', line: 1 });
  });
  it('refuses more rows than the cap with the row it stopped on', () => {
    const body = Array.from({ length: 6 }, (_, i) => `${i}`).join('\n');
    expect(ok(`a\n${body}`, { maxRows: 6 }).rows).toHaveLength(6);
    expect(parseCsv(`a\n${body}\n7`, { maxRows: 6 })).toEqual({ ok: false, reason: 'too_many_rows', line: 8 });
  });
  it('treats a formula looking cell as plain text', () => {
    expect(ok('a\n=SUM(A1)\n+1\n@x\n-5').rows.map((r) => r.cells[0])).toEqual(['=SUM(A1)', '+1', '@x', '-5']);
  });
});

describe('unguardCell is the exact inverse of cellText', () => {
  const samples = ["'=x", "''+1", '=x', 'x', '', "'", "''", "'x", " =x", " +1", '@x', '-5', "\tx", "\rx", "' =x", "'\tx", "'''=x", "'-5", "it's", '=1,2', '"=x"', 'a\nb', "'=a\nb"];
  it('removes exactly one quote for every sample', () => {
    // A cell with a comma, quote or line end also gets CSV quoting; the round trip below covers those through the parser.
    const needsQuotes = (x) => /["\r\n]/.test(x) || x.includes(',');
    for (const s of samples.filter((x) => !needsQuotes(x))) expect(unguardCell(cellText(s, 'text')), JSON.stringify(s)).toBe(s);
  });
  it('round trips through toCsv, parseCsv and unguardCell', () => {
    for (const s of samples) {
      const r = ok(toCsv([{ name: 'v', type: 'text' }], [{ v: s }]).replace(/\r\n$/, '') + '\r\n');
      if (s === '') continue;
      expect(unguardCell(r.rows[0].cells[0]), JSON.stringify(s)).toBe(s);
    }
  });
  it('random strings survive', () => {
    const alphabet = ["'", '=', '+', '-', '@', ' ', '\t', '\r', '\n', ',', '"', ';', 'a', '1'];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 400; n += 1) {
      const len = 1 + Math.floor(rnd() * 6);
      let s = '';
      for (let i = 0; i < len; i += 1) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const r = parseCsv(toCsv([{ name: 'v', type: 'text' }], [{ v: s }]));
      if (!r.ok || r.rows.length === 0) continue; // an all blank row is skipped by design
      expect(unguardCell(r.rows[0].cells[0]), JSON.stringify(s)).toBe(s);
    }
  });
  it('a plain number in a numeric column is never quoted', () => {
    expect(cellText('-12.5', 'real')).toBe('-12.5');
    expect(cellText('-5', 'text')).toBe("'-5");
    expect(unguardCell("'-5")).toBe('-5');
  });
});

describe('cellToValue', () => {
  it('an empty or blank cell is absent', () => {
    for (const cell of ['', '   ']) expect(cellToValue({ type: 'text' }, cell, ',')).toBeUndefined();
  });
  it('reads booleans in any case', () => {
    for (const cell of ['true', 'YES', '1', ' Yes ']) expect(cellToValue({ type: 'boolean' }, cell, ',')).toBe(true);
    for (const cell of ['false', 'No', '0']) expect(cellToValue({ type: 'boolean' }, cell, ',')).toBe(false);
    expect(cellToValue({ type: 'boolean' }, 'maybe', ',')).toBe('maybe');
  });
  it('reads a comma decimal only in a semicolon file', () => {
    expect(cellToValue({ type: 'real' }, '12,5', ';')).toBe('12.5');
    expect(cellToValue({ type: 'real' }, '-3,25', ';')).toBe('-3.25');
    expect(cellToValue({ type: 'real' }, '12,5', ',')).toBe('12,5');
    expect(cellToValue({ type: 'text' }, '12,5', ';')).toBe('12,5');
  });
  it('unguards exactly one quote and keeps other text as written', () => {
    expect(cellToValue({ type: 'text' }, "'=SUM(A1)", ',')).toBe('=SUM(A1)');
    expect(cellToValue({ type: 'text' }, "''=x", ',')).toBe("'=x");
    expect(cellToValue({ type: 'text' }, "it's", ',')).toBe("it's");
    expect(cellToValue({ type: 'date' }, '31/01/2026', ',')).toBe('31/01/2026');
  });
});

describe('suggestMapping', () => {
  const table = {
    fields: [
      { id: 'number', label: 'Number', type: 'text', autoNumber: {} },
      { id: 'paid_on', label: 'Paid on', type: 'date' },
      { id: 'status', label: 'Status', type: 'select', options: ['a'] },
    ],
  };
  it('matches a label or id after trimming, lower case and folding spaces and underscores, and never the numbered field', () => {
    expect(suggestMapping(['Number', ' PAID_ON ', 'paid on', 'status', 'Other'], table)).toEqual({
      Number: null,
      ' PAID_ON ': 'paid_on',
      'paid on': null,
      status: 'status',
      Other: null,
    });
  });
});
