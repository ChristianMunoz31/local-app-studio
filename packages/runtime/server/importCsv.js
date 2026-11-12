// CSV import of one table: POST /api/data/:table/import (docs/phase28 design, section 4). A dry run (the default) runs the very
// batches a real run does inside a transaction that is rolled back, so it sees exactly what the real run would. Every row goes
// through createRecord (write.js): validation, links, numbers, rules when asked, and the same checks as the form.
// Identifiers come from the compiled spec only; a header is only ever a key of the mapping and a cell is only ever a value.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { DbError, getDb, op, select, withTransaction, yieldToLoop } from '../../../server/db/index.js';
import { currentOp } from '../../../server/backup/lock.js';
import { limiterHandler, sendError } from '../../../server/errors.js';
import { logger } from '../../../server/log.js';
import { IMPORT_MAX_ROWS_PER_TABLE } from '../../../server/import/importExport.js';
import { readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber.ts';
import { createNumberer } from './autoNumberStore.js';
import { CSV_LIMITS, parseCsv, unguardCell } from './csvParse.js';
import { ambiguousLinkMessage, dryRunLines, missingLinkMessage, resultLines, rowLine } from './importWords.js';
import { createRecord } from './write.js';

export const IMPORT_BATCH_ROWS = 500;
export const IMPORT_PREVIEW_MAX_ROWS = 5000;
const BODY_LIMIT = '16mb';
const MAX_ERRORS_SHOWN = 20;
const LINK_ID_CHUNK = 500;
const LINK_PAGE = 5000;
const ECHO_CHARS = 64;
const TOO_LARGE_ACTION = 'Split the file into smaller files, then import each one.';

/** A request the import refuses before any write: the route answers it with the error envelope. */
class ImportRefusal extends Error {
  /** @param {string} code @param {string} message @param {string} [field] @param {string} [action] a next step for a CSV, instead of the code's row */
  constructor(code, message, field, action) {
    super(message);
    this.name = 'ImportRefusal';
    this.code = code;
    this.field = field;
    this.action = action;
  }
}

/** The dry run's own exit: thrown inside the batch transaction so everything the batch did is rolled back. */
class ImportDryRunRollback extends Error {}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const fold = (text) => String(text).trim().toLowerCase().replace(/[\s_]+/g, ' ');

/**
 * A header to a field of the table whose label or id equals it (trimmed, lower case, spaces and underscores alike). Never the numbered field.
 * @param {string[]} headers
 * @param {{ fields?: Array<{ id: string, label?: string }> }} table the spec table
 * @returns {Record<string, string | null>}
 */
export function suggestMapping(headers, table) {
  const numbered = readAutoNumber(table)?.field ?? null;
  const taken = new Set();
  return Object.fromEntries(
    headers.map((header) => {
      const key = fold(header);
      const field = (table?.fields ?? []).find((f) => f.id !== numbered && !taken.has(f.id) && (fold(f.id) === key || fold(f.label ?? '') === key));
      if (field) taken.add(field.id);
      return [header, field ? field.id : null];
    }),
  );
}

const BOOLEAN_TRUE = new Set(['true', 'yes', '1']);
const BOOLEAN_FALSE = new Set(['false', 'no', '0']);
const COMMA_DECIMAL_RE = /^\s*-?\d+,\d+\s*$/;

/**
 * One cell to the value validateRecord reads. An empty cell is absent (undefined), so defaults and the required rule apply.
 * A cell our export guarded with a quote is unguarded first. A bad value is passed on as text for validateRecord to refuse.
 * @param {{ type: string }} field
 * @param {string} cell
 * @param {string} delimiter
 * @returns {unknown}
 */
export function cellToValue(field, cell, delimiter) {
  const text = unguardCell(cell);
  if (text.trim() === '') return undefined;
  if (field.type === 'boolean') {
    const word = text.trim().toLowerCase();
    if (BOOLEAN_TRUE.has(word)) return true;
    if (BOOLEAN_FALSE.has(word)) return false;
    return text;
  }
  if (field.type === 'real' && delimiter === ';' && COMMA_DECIMAL_RE.test(text)) return text.trim().replace(',', '.');
  return text;
}

/** A given mapping checked against the headers and the table, or the first bad field id or header. */
function checkMapping(given, headers, fields, numbered) {
  if (!isPlainObject(given)) return { ok: false, field: 'mapping' };
  const clip = (v) => String(v).slice(0, ECHO_CHARS);
  const known = new Set(headers);
  const used = new Set();
  const entries = [];
  for (const [header, target] of Object.entries(given)) {
    if (!known.has(header)) return { ok: false, field: clip(header) };
    if (target === null) {
      entries.push([header, null]);
      continue;
    }
    if (typeof target !== 'string' || !Object.hasOwn(fields, target) || target === numbered || used.has(target)) {
      return { ok: false, field: typeof target === 'string' ? clip(target) : clip(header) };
    }
    used.add(target);
    entries.push([header, target]);
  }
  if (used.size === 0) return { ok: false, field: 'mapping' };
  const mapping = Object.fromEntries(headers.map((h) => [h, null]));
  for (const [header, target] of entries) mapping[header] = target;
  return { ok: true, mapping };
}

/**
 * Finds the record a link cell means (M5, as the Assistant does): an existing id is kept, else the title, trimmed and compared
 * case-insensitively. One read of ids and one paged read of the titles per linked table, before the first batch.
 */
function buildLinkResolver({ compiled, linked, label, cells, db }) {
  const distinct = [...new Set(cells.filter((c) => c.trim() !== ''))];
  const idHits = new Set();
  for (let i = 0; i < distinct.length; i += LINK_ID_CHUNK) {
    const chunk = distinct.slice(i, i + LINK_ID_CHUNK);
    for (const r of select(linked, { columns: ['id'], where: { id: op.in(chunk) }, db })) idHits.add(r.id);
  }
  const titleField = compiled.titleFields?.[linked];
  const wanted = new Set(distinct.filter((c) => !idHits.has(c)).map((c) => c.trim().toLowerCase()));
  const byTitle = new Map();
  if (wanted.size > 0 && titleField && titleField !== 'id') {
    for (let offset = 0; ; offset += LINK_PAGE) {
      const page = select(linked, { columns: ['id', titleField], orderBy: [{ column: 'id' }], limit: LINK_PAGE, offset, db });
      for (const r of page) {
        const title = typeof r[titleField] === 'string' ? r[titleField].trim().toLowerCase() : null;
        if (title !== null && wanted.has(title)) {
          const ids = byTitle.get(title);
          if (ids) ids.push(r.id);
          else byTitle.set(title, [r.id]);
        }
      }
      if (page.length < LINK_PAGE) break;
    }
  }
  return (cell) => {
    if (idHits.has(cell)) return { ok: true, id: cell };
    const ids = byTitle.get(cell.trim().toLowerCase()) ?? [];
    if (ids.length === 1) return { ok: true, id: ids[0] };
    return { ok: false, message: ids.length === 0 ? missingLinkMessage(label, cell) : ambiguousLinkMessage(label, cell, ids.length) };
  };
}

const CSV_PROBLEMS = Object.freeze({
  empty: 'the file has no rows.',
  no_header: 'the first row must name every column.',
  duplicate_header: 'two columns have the same name.',
  unclosed_quote: 'a quote is opened and never closed.',
  too_many_columns: `the file has more than ${CSV_LIMITS.maxColumns} columns.`,
});

/**
 * Runs an import. A refusal before any write throws an ImportRefusal; a database failure before the first batch throws too.
 * A batch that fails later stops the import with `complete: false` and `stoppedAt`.
 * @param {{ compiled: object, spec: object, table: string, request: { csv: string, mapping?: unknown, dryRun?: boolean,
 *   applyAutomations?: boolean, startAt?: unknown }, now?: Date, db?: import('node:sqlite').DatabaseSync, isPreviewChild?: boolean }} opts
 * @returns {Promise<object>} an ImportDryRun or an ImportResult
 */
export async function runImport({ compiled, spec, table, request, now = new Date(), db = getDb(), isPreviewChild = false }) {
  const dryRun = request.dryRun !== false;
  const applyAutomations = request.applyAutomations === true;
  const st = (spec?.tables ?? []).find((t) => t.id === table);
  const rules = compiled.validators[table] ?? {};
  const cfg = st ? readAutoNumber(st) : null;
  const numbered = cfg?.field ?? null;
  const rowCap = isPreviewChild ? IMPORT_PREVIEW_MAX_ROWS : IMPORT_MAX_ROWS_PER_TABLE;

  const parsed = parseCsv(request.csv, { maxRows: rowCap });
  if (!parsed.ok) {
    if (parsed.reason === 'too_many_rows') {
      throw new ImportRefusal(
        'import_too_large',
        isPreviewChild
          ? `In Preview a file can have up to ${IMPORT_PREVIEW_MAX_ROWS} rows. Split it, or import it in the built app.`
          : `This file has more than ${IMPORT_MAX_ROWS_PER_TABLE} rows. Split it, then import each part.`,
        undefined,
        TOO_LARGE_ACTION,
      );
    }
    throw new ImportRefusal('import_csv_invalid', `Line ${parsed.line}: ${CSV_PROBLEMS[parsed.reason]}`);
  }
  const { delimiter, headers, rows } = parsed;

  const lastRow = rows.length > 0 ? rows[rows.length - 1].row : 1;
  const startAt = request.startAt;
  if (startAt !== undefined && (!Number.isInteger(startAt) || startAt < 2 || startAt > lastRow + 1)) {
    throw new ImportRefusal('invalid_request', `Start row must be a whole number from 2 to ${lastRow + 1}.`);
  }
  const todo = rows.filter((r) => r.row >= (startAt ?? 2));

  let mapping;
  if (request.mapping === undefined || request.mapping === null) {
    mapping = suggestMapping(headers, st);
    if (!dryRun && !Object.values(mapping).some((v) => v !== null)) {
      throw new ImportRefusal('import_mapping_invalid', 'No column matches a field of this table.', 'mapping');
    }
  } else {
    const checked = checkMapping(request.mapping, headers, rules, numbered);
    if (!checked.ok) throw new ImportRefusal('import_mapping_invalid', 'Some columns are matched to fields that cannot take them.', checked.field);
    mapping = checked.mapping;
  }
  const mapped = headers.flatMap((header, idx) => (mapping[header] !== null ? [{ idx, field: mapping[header], rule: rules[mapping[header]] }] : []));
  const leftOut = headers.filter((h) => mapping[h] === null);
  const labels = Object.fromEntries((spec?.tables ?? []).map((t) => [t.id, t.label]));
  const fields = (st?.fields ?? []).map((f) => ({ id: f.id, label: f.label, type: f.type, required: f.required === true, numbered: f.id === numbered }));

  const resolvers = new Map();
  for (const m of mapped) {
    if (m.rule.type !== 'reference') continue;
    const cells = todo.map((r) => unguardCell(r.cells[m.idx] ?? ''));
    resolvers.set(m.field, buildLinkResolver({ compiled, linked: m.rule.table, label: labels[m.rule.table] ?? m.rule.table, cells, db }));
  }

  const bodyOf = (row) => {
    const body = {};
    for (const m of mapped) {
      const raw = row.cells[m.idx] ?? '';
      if (raw.length > CSV_LIMITS.maxCellChars) return { ok: false, field: m.field, message: `${m.rule.label} is longer than ${CSV_LIMITS.maxCellChars} characters.` };
      if (raw.trim() === '') continue;
      if (m.rule.type === 'reference') {
        const r = resolvers.get(m.field)(unguardCell(raw));
        if (!r.ok) return { ok: false, field: m.field, message: r.message };
        body[m.field] = r.id;
        continue;
      }
      const value = cellToValue(m.rule, raw, delimiter);
      if (value !== undefined) body[m.field] = value;
    }
    return { ok: true, body };
  };

  const totals = { valid: 0, invalid: 0, applied: 0 };
  const errors = [];
  let stoppedAt = null;
  let committed = 0;
  const noteError = (row, field, message) => {
    totals.invalid += 1;
    if (errors.length < MAX_ERRORS_SHOWN) errors.push({ row, field, message: rowLine(row, message) });
  };

  for (let from = 0; mapped.length > 0 && from < todo.length; from += IMPORT_BATCH_ROWS) {
    const batch = todo.slice(from, from + IMPORT_BATCH_ROWS);
    if (currentOp() === 'restore') {
      stoppedAt = batch[0].row;
      break;
    }
    const local = { valid: 0, invalid: [], applied: 0 };
    try {
      withTransaction(() => {
        const numberer = cfg ? createNumberer({ db, table, cfg }) : null;
        for (const row of batch) {
          const built = bodyOf(row);
          if (!built.ok) {
            local.invalid.push([row.row, built.field, built.message]);
            continue;
          }
          let w;
          try {
            w = createRecord({ compiled, spec, table, body: built.body, applyAutomations, now, db, numberer: numberer ?? undefined });
          } catch (e) {
            if (e instanceof DbError && (e.code === 'constraint' || e.code === 'invalid_value')) {
              local.invalid.push([row.row, null, 'this row could not be saved.']);
              continue;
            }
            throw e;
          }
          if (!w.ok) {
            local.invalid.push([row.row, w.field ?? null, w.message]);
            continue;
          }
          local.valid += 1;
          if (w.applied.length > 0) local.applied += 1;
        }
        numberer?.commit();
        if (dryRun) throw new ImportDryRunRollback('dry run');
      }, db);
    } catch (e) {
      if (!(e instanceof ImportDryRunRollback)) {
        // The whole batch rolled back; the batches before it stay. Before any batch committed the failure is the answer.
        if (committed === 0) throw e;
        // Code and batch number only: never a cell, a header, the message or a body (CLAUDE.md, log rules).
        logger.error('runtime.import_batch_failed', {
          code: typeof e?.code === 'string' ? e.code : typeof e?.name === 'string' ? e.name : 'unknown',
          batch: Math.floor(from / IMPORT_BATCH_ROWS),
          committed,
        });
        stoppedAt = batch[0].row;
        break;
      }
    }
    committed += 1;
    totals.valid += local.valid;
    totals.applied += local.applied;
    for (const [row, field, message] of local.invalid) noteError(row, field, message);
    await yieldToLoop();
  }

  const complete = stoppedAt === null;
  if (dryRun) {
    return {
      dryRun: true,
      delimiter,
      headers,
      mapping,
      fields,
      rows: todo.length,
      valid: totals.valid,
      invalid: totals.invalid,
      errors,
      complete,
      stoppedAt,
      lines: dryRunLines({ valid: totals.valid, invalid: totals.invalid, leftOut, noMatch: mapped.length === 0 }),
    };
  }
  return {
    dryRun: false,
    rows: todo.length,
    added: totals.valid,
    skipped: totals.invalid,
    errors,
    applied: totals.applied,
    complete,
    stoppedAt,
    lines: resultLines({ added: totals.valid, stoppedAt }),
  };
}

/**
 * Registers POST /api/data/:table/import: a budget of 30 imports per 15 minutes, its own 16 MB JSON parser (the module lists the path in `ownBody`,
 * so the global 2 MB parser skips it), then the table check.
 * @param {import('express').Express} app
 * @param {{ withTable: (handler: Function) => import('express').RequestHandler }} deps
 */
export function registerImportRoute(app, { withTable }) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: limiterHandler({ message: 'Too many imports. Wait a few minutes, then try again.' }),
  });
  // The limiter runs first: a refused call must not make the server read and parse up to 16 MB (phase 28 L1).
  app.post(
    '/api/data/:table/import',
    limiter,
    express.json({ limit: BODY_LIMIT }),
    withTable(async (req, res, { compiled, spec, table }) => {
      const body = req.body;
      if (!isPlainObject(body) || typeof body.csv !== 'string') {
        return sendError(res, 'invalid_request', { message: 'Send the file text as "csv".' });
      }
      try {
        const data = await runImport({
          compiled,
          spec,
          table,
          request: body,
          now: new Date(),
          db: getDb(),
          isPreviewChild: process.env.APP_PREVIEW_CHILD === '1',
        });
        return res.json({ data });
      } catch (e) {
        if (!(e instanceof ImportRefusal)) throw e;
        return sendError(res, e.code, { message: e.message, ...(e.action ? { action: e.action } : {}), ...(e.field ? { extra: { field: e.field } } : {}) });
      }
    }),
  );
}
