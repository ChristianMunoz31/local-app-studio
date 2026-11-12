// The CSV round trip (phase 28, section 9): the records of every example, written by the export and read back by the importer's
// parser, equal the stored values; random text with quotes, delimiters, line ends and formula starts survives export, parse and unguard.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { parseCsv, unguardCell } from '../../../packages/runtime/server/csvParse.js';
import { toCsv } from '../../export/csv.js';
import { compileSpec } from '../../spec/compile.js';
import { formatAutoNumber, readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber.ts';
import { resolveRow, seedOrder } from '../../../src/studio/lib/sampleData.ts';

const EXAMPLES = path.join(process.cwd(), 'public', 'examples');
const names = fs
  .readdirSync(EXAMPLES)
  .filter((f) => f.endsWith('.spec.json'))
  .map((f) => f.replace('.spec.json', ''));
const bind = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

describe('examples through toCsv and parseCsv', () => {
  it('finds the eight examples', () => {
    expect(names).toHaveLength(8);
  });
  for (const name of names) {
    it(`${name}: every cell equals the stored value text`, () => {
      const spec = JSON.parse(fs.readFileSync(path.join(EXAMPLES, `${name}.spec.json`), 'utf8'));
      const records = JSON.parse(fs.readFileSync(path.join(EXAMPLES, `${name}.records.json`), 'utf8'));
      const compiled = compileSpec(spec);
      const db = new DatabaseSync(':memory:');
      try {
        db.exec(compiled.createSql);
        const made = new Map();
        const idOf = (table, key) => made.get(`${table}:${key}`);
        for (const tableId of seedOrder(spec)) {
          const table = spec.tables.find((t) => t.id === tableId);
          // A numbered field is filled by the runtime when a record is added; here the numbers are made as the runtime would.
          const cfg = readAutoNumber(table);
          let counter = cfg?.start ?? 1;
          for (const row of records.tables[tableId] ?? []) {
            const numbered = cfg ? { [cfg.field]: formatAutoNumber(cfg, counter++) } : {};
            const values = { id: crypto.randomUUID(), ...resolveRow(table, row, new Date(), idOf), ...numbered, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            const cols = Object.keys(values);
            db.prepare(`INSERT INTO "${tableId}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => bind(values[c])));
            if (typeof row._id === 'string') made.set(`${tableId}:${row._id}`, values.id);
          }
        }
        for (const def of compiled.dataTables) {
          const stored = db.prepare(`SELECT * FROM "${def.id}"`).all();
          const parsed = parseCsv(toCsv(def.columns, stored));
          expect(parsed.ok, def.id).toBe(true);
          expect(parsed.headers).toEqual(def.columns.map((c) => c.name));
          expect(parsed.rows).toHaveLength(stored.length);
          parsed.rows.forEach((r, i) => {
            def.columns.forEach((c, j) => {
              const raw = stored[i][c.name];
              expect(unguardCell(r.cells[j]), `${def.id}.${c.name} row ${r.row}`).toBe(raw === null || raw === undefined ? '' : String(raw));
            });
          });
        }
      } finally {
        db.close();
      }
    });
  }
});

describe('random text', () => {
  it('survives toCsv, parseCsv and unguardCell unchanged', () => {
    const alphabet = ["'", '=', '+', '-', '@', ' ', '\t', '\r', '\n', ',', '"', ';', 'a', 'b', '1', 'x'];
    let seed = 777;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const columns = [
      { name: 'a', type: 'text' },
      { name: 'b', type: 'text' },
    ];
    for (let n = 0; n < 500; n += 1) {
      const make = () => {
        let s = 'k';
        for (let i = 0, len = Math.floor(rnd() * 7); i < len; i += 1) s += alphabet[Math.floor(rnd() * alphabet.length)];
        return alphabet[Math.floor(rnd() * alphabet.length)] + s.slice(1);
      };
      const row = { a: make(), b: make() };
      const parsed = parseCsv(toCsv(columns, [row]));
      if (!parsed.ok || parsed.rows.length === 0) continue; // a row of blank text is skipped by design
      expect(unguardCell(parsed.rows[0].cells[0]), JSON.stringify(row)).toBe(row.a);
      expect(unguardCell(parsed.rows[0].cells[1]), JSON.stringify(row)).toBe(row.b);
    }
  });
});
