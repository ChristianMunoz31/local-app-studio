// The generic data API of a built app (ADR-004): /api/data/:table. The table set is the compiled spec's tables only,
// so kit tables (app_state, app_secrets, audit_log, ...) are unreachable here. All database access goes through
// server/db/query.js with identifiers from the compiled spec.
//
//   GET    /api/data                  app info, data folder, tables with row counts
//   GET    /api/data/:table           { rows, total, limit, offset }
//   GET    /api/data/:table/stats     code-computed counts and totals of the numeric fields; with groupBy, per group
//   GET    /api/data/:table/:id       one row
//   POST   /api/data/:table           201 one row (a numbered field is filled in; `applied` lists what the rules set)
//   POST   /api/data/:table/import    CSV import, dry run by default (importCsv.js)
//   PATCH  /api/data/:table/:id       one row (updated_at is set; `applied` as above)
//   DELETE /api/data/:table/:id       { id, deleted: true }
//
// Errors: 404 unknown_table, 400 invalid_query { field }, 400 invalid_record { field }, 404 not_found,
// 409 record_in_use { table }, 503 db_unavailable, 500 server_error. Only error codes are logged.
import path from 'node:path';
import { count, pingDb, remove, resolveDbPath, select, selectOne, toDbError } from '../../../server/db/index.js';
import { sendError } from '../../../server/errors.js';
import { getAppSpec, getCompiledSpec } from '../../../server/spec/source.js';
import { parseDataQuery, parseGroupQuery } from './params.js';
import { computeGroups, computeStats } from './stats.js';
import { registerImportRoute } from './importCsv.js';
import { createRecord, updateRecord } from './write.js';

const sendUnavailable = (res) => sendError(res, 'db_unavailable', { message: 'Local database is unavailable.' });
const MAX_ID_CHARS = 200;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Table id to label, from the spec. */
const tableLabels = (spec) => Object.fromEntries((spec?.tables ?? []).map((t) => [t.id, t.label]));

function fail(res, e) {
  const d = toDbError(e);
  if (d.status === 503) return sendUnavailable(res);
  if (d.code === 'invalid_query' && res.req.method === 'GET') {
    return sendError(res, 'invalid_query', { message: 'That request could not be understood.' });
  }
  if (d.code === 'invalid_value' || d.code === 'constraint' || d.code === 'invalid_query') {
    return sendError(res, 'invalid_record', { message: 'That request could not be understood.' });
  }
  console.error('Data route error:', d.code);
  return sendError(res, 'server_error', { message: 'Something went wrong. Try again.' });
}

const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (e) {
    fail(res, e);
  }
};

const notFound = (res) => sendError(res, 'not_found', { message: 'That record no longer exists.' });

/**
 * Registers the generic data routes. Safe to call in any mode: without a compiled spec every table is unknown.
 * @param {import('express').Express} app
 */
export function registerRuntimeRoutes(app) {
  // Resolved per request: the compiled spec is cached by source.js, tests reset it.
  const context = () => {
    const compiled = getCompiledSpec();
    return { compiled, spec: getAppSpec(), tables: compiled?.tables ?? {} };
  };

  // The table is checked against the compiled spec's own tables, never against TABLES.
  const withTable = (handler) =>
    route(async (req, res) => {
      const ctx = context();
      const table = req.params.table;
      if (typeof table !== 'string' || !Object.hasOwn(ctx.tables, table)) {
        return sendError(res, 'unknown_table', { message: 'That table does not exist.' });
      }
      return handler(req, res, { ...ctx, table });
    });

  const idOf = (req) => {
    const id = req.params.id;
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS ? id : null;
  };

  const recordBody = (req, res) => {
    const body = req.body ?? {};
    if (!isPlainObject(body)) {
      sendError(res, 'invalid_record', { message: 'Send the record as a JSON object.', extra: { field: 'body' } });
      return null;
    }
    return body;
  };

  const invalidRecord = (res, v) => sendError(res, 'invalid_record', { message: v.message, extra: { field: v.field } });

  app.use('/api/data', (req, res, next) => {
    if (!pingDb()) return sendUnavailable(res);
    next();
  });

  app.get(
    '/api/data',
    route(async (_req, res) => {
      const { compiled, spec } = context();
      const labels = tableLabels(spec);
      const dbFile = resolveDbPath();
      res.json({
        data: {
          app: spec?.app ? { name: spec.app.name, version: spec.app.version } : null,
          dataDir: path.dirname(dbFile),
          dbFile,
          tables: (compiled?.importOrder ?? []).map((id) => ({ id, label: labels[id] ?? id, rowCount: count(id) })),
        },
      });
    }),
  );

  // Registered before /:id so "stats" is not taken for an id.
  app.get(
    '/api/data/:table/stats',
    withTable(async (req, res, { compiled, spec, table }) => {
      const q = parseDataQuery(compiled, spec, table, req.query, { stats: true });
      if (!q.ok) return sendError(res, 'invalid_query', { message: q.message, extra: { field: q.field } });
      if (req.query.groupBy === undefined) return res.json({ data: computeStats(compiled, table, { where: q.where, search: q.search }) });
      const group = parseGroupQuery(compiled, table, req.query);
      if (!group.ok) return sendError(res, 'invalid_query', { message: group.message, extra: { field: group.field } });
      return res.json({ data: computeGroups(compiled, table, { where: q.where, search: q.search, group }) });
    }),
  );

  app.get(
    '/api/data/:table',
    withTable(async (req, res, { compiled, spec, table }) => {
      const q = parseDataQuery(compiled, spec, table, req.query);
      if (!q.ok) return sendError(res, 'invalid_query', { message: q.message, extra: { field: q.field } });
      const rows = select(table, { where: q.where, search: q.search, orderBy: q.orderBy, limit: q.limit, offset: q.offset });
      const total = count(table, { where: q.where, search: q.search });
      res.json({ data: { rows, total, limit: q.limit, offset: q.offset } });
    }),
  );

  app.get(
    '/api/data/:table/:id',
    withTable(async (req, res, { table }) => {
      const id = idOf(req);
      const row = id === null ? null : selectOne(table, { where: { id } });
      if (!row) return notFound(res);
      res.json({ data: row });
    }),
  );

  registerImportRoute(app, { withTable });

  app.post(
    '/api/data/:table',
    withTable(async (req, res, { compiled, spec, table }) => {
      const body = recordBody(req, res);
      if (!body) return undefined;
      const w = createRecord({ compiled, spec, table, body });
      if (!w.ok) return invalidRecord(res, w);
      return res.status(201).json({ data: w.row, ...(w.applied.length > 0 ? { applied: w.applied } : {}) });
    }),
  );

  app.patch(
    '/api/data/:table/:id',
    withTable(async (req, res, { compiled, spec, table }) => {
      const id = idOf(req);
      if (id === null || !selectOne(table, { columns: ['id'], where: { id } })) return notFound(res);
      const body = recordBody(req, res);
      if (!body) return undefined;
      const w = updateRecord({ compiled, spec, table, id, body });
      if (w.notFound) return notFound(res);
      if (!w.ok) return invalidRecord(res, w);
      return res.json({ data: w.row, ...(w.applied.length > 0 ? { applied: w.applied } : {}) });
    }),
  );

  app.delete(
    '/api/data/:table/:id',
    withTable(async (req, res, { compiled, table }) => {
      const id = idOf(req);
      if (id === null || !selectOne(table, { columns: ['id'], where: { id } })) return notFound(res);
      const restricting = (compiled.foreignKeys ?? []).filter((fk) => fk.references.table === table && fk.onDelete === 'restrict');
      for (const fk of restricting) {
        if (count(fk.table, { where: { [fk.column]: id } }) > 0) return inUse(res, fk.table);
      }
      try {
        remove(table, { where: { id } });
      } catch (e) {
        if (toDbError(e).code === 'constraint') return inUse(res, restricting[0]?.table);
        throw e;
      }
      return res.json({ data: { id, deleted: true } });
    }),
  );
}

function inUse(res, childTable) {
  return sendError(res, 'record_in_use', {
    message: 'Other records still use this one. Remove or change them first.',
    ...(childTable ? { extra: { table: childTable } } : {}),
  });
}
