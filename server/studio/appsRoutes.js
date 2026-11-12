// Routes 1 to 7: the app list and the single-app operations (docs: DESIGN-phase3 section 3).
import http from 'node:http';
import { StudioError, appExists, createApp, deleteApp, duplicateApp, getApp, importApp, listApps, saveSpec, withDesignEntry } from './apps.js';
import { sendError } from '../errors.js';
import { log } from '../log.js';
import { compileSpec } from '../spec/compile.js';
import { UUID_RE, appNotFound, badRequest, sendStudioError } from './http.js';
import { getBuildService } from './build/service.js';
import { getPreviewManager } from './preview/manager.js';
import { copyPreviewData } from './preview/scratch.js';
import { loadLibrary } from './features/store.js';
import { checkSample } from '../../src/studio/lib/sampleData.ts';
import { expandAndCheck } from './specCheck.js';
import { clearWaiting, getFirstPrompt, getWaiting } from './waiting.js';
import { readSample } from './sample.js';

/** The record with the first prompt Use this kept (studio.prompt.<id>), for a window whose browser storage has none. */
const withFirstPrompt = (record) => {
  const firstPrompt = getFirstPrompt(record.id);
  return firstPrompt === null ? record : { ...record, firstPrompt };
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Wraps a handler so a throw becomes its fixed error body */
const safe = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendStudioError(res, err);
  }
};

const invalidSpec = (res, issues) =>
  sendError(res, 'invalid_spec', { message: issues[0]?.message ?? 'The app is not valid.', extra: { issues } });

const EXPORT_MAX_BYTES = 48 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 60000;
const FORBIDDEN_IN_FILE_NAME = /[<>:"/\\|?*\p{Cc}]/gu;

/** "<name> app.zip", safe on Windows (the Studio's exportFileName rule; that file's extensionless import cannot load here). */
const exportZipName = (appName) => {
  const clean = appName.replace(FORBIDDEN_IN_FILE_NAME, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return `${clean === '' ? 'My' : clean} app.zip`;
};

/**
 * Asks the Preview child for the kit export ZIP of the given tables over loopback with its cookie (the seed.js call pattern).
 * Resolves { status, complete, body }; rejects on a socket error, the time limit or a body over the cap.
 */
function childExport({ port, cookie, tables, request = http.request }) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({ tables }));
    const headers = { host: `127.0.0.1:${port}`, cookie: `app_desktop=${cookie}`, 'content-type': 'application/json', 'content-length': String(data.length) };
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/export', headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > EXPORT_MAX_BYTES) req.destroy(new Error('too_large'));
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, complete: res.headers['x-export-complete'] !== '0', body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(EXPORT_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

/** Validates `:id`; answers 404 itself for a malformed one. */
function withId(req, res, next) {
  if (!UUID_RE.test(req.params.id)) return appNotFound(res);
  return next();
}

/** @param {import('express').Express} app */
export function registerAppsRoutes(app) {
  app.get('/api/studio/apps', safe((req, res) => res.json({ data: listApps() })));

  app.post(
    '/api/studio/apps',
    safe((req, res) => {
      const name = isObject(req.body) && typeof req.body.name === 'string' ? req.body.name.trim() : null;
      if (name === null) return badRequest(res, 'Send the app name as text.');
      return res.status(201).json({ data: createApp({ name }) });
    }),
  );

  app.post(
    '/api/studio/apps/import',
    safe((req, res) => {
      if (!isObject(req.body) || req.body.spec === undefined) return badRequest(res, 'Send the app design as "spec".');
      const checked = expandAndCheck(req.body.spec, loadLibrary);
      if (!checked.ok) return invalidSpec(res, checked.issues);
      let sample = null;
      if (req.body.sample !== undefined) {
        const fit = checkSample(req.body.sample, checked.spec);
        if (!fit.ok) return badRequest(res, 'The sample records do not fit this app.');
        sample = fit.value;
      }
      return res.status(201).json({ data: importApp(checked.spec, { sample }) });
    }),
  );

  app.get(
    '/api/studio/apps/:id',
    withId,
    safe((req, res) => {
      const record = getApp(req.params.id);
      return record ? res.json({ data: withFirstPrompt(record) }) : appNotFound(res);
    }),
  );

  // The stored example records, read only (the canvas lays pages out against them). An app without any answers an empty sample.
  app.get(
    '/api/studio/apps/:id/sample',
    // Set first, so the 404 for a missing or malformed id carries it too and a proxy never keeps the answer.
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    withId,
    safe((req, res) => {
      if (!appExists(req.params.id)) return appNotFound(res);
      return res.json({ data: readSample(req.params.id) ?? { v: 1, tables: {} } });
    }),
  );

  app.put(
    '/api/studio/apps/:id',
    withId,
    safe((req, res) => {
      const body = isObject(req.body) ? req.body : {};
      if (body.clearWaiting !== undefined && typeof body.clearWaiting !== 'boolean') return badRequest(res, 'Send "clearWaiting" as true or false.');
      if (body.waitingAt !== undefined && typeof body.waitingAt !== 'string') return badRequest(res, 'Send "waitingAt" as text.');
      if (body.spec === undefined) return badRequest(res, 'Send the app design as "spec".');
      if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 1) return badRequest(res, 'Send the revision you started from as "baseRevision".');
      const checked = expandAndCheck(body.spec, loadLibrary);
      if (!checked.ok) return invalidSpec(res, checked.issues);
      const record = saveSpec(req.params.id, checked.spec, body.baseRevision, { clearWaiting: body.clearWaiting === true, waitingAt: body.waitingAt ?? null });
      getPreviewManager().specSaved({ id: record.id, spec: record.spec, revision: record.revision });
      return res.json({ data: withFirstPrompt(record) });
    }),
  );

  app.delete(
    '/api/studio/apps/:id',
    withId,
    safe(async (req, res) => {
      if (getBuildService().isBuilding(req.params.id)) {
        throw new StudioError('build_running', 409, 'This app is being built. Wait for the build to finish or cancel it first.');
      }
      const guard = req.query.ifRevision;
      let ifRevision;
      if (guard !== undefined) {
        ifRevision = typeof guard === 'string' && /^[0-9]+$/.test(guard) ? Number(guard) : NaN;
        if (!Number.isSafeInteger(ifRevision) || ifRevision < 1) return badRequest(res, 'Send "ifRevision" as a whole number.');
      }
      if (!deleteApp(req.params.id, ifRevision)) return appNotFound(res);
      await getPreviewManager().appDeleted(req.params.id);
      return res.json({ data: { id: req.params.id } });
    }),
  );

  app.post(
    '/api/studio/apps/:id/duplicate',
    withId,
    safe((req, res) => {
      const body = isObject(req.body) ? req.body : {};
      if (body.name !== undefined && typeof body.name !== 'string') return badRequest(res, 'Send the copy name as text.');
      if (body.withRecords !== undefined && typeof body.withRecords !== 'boolean') return badRequest(res, 'Send "withRecords" as true or false.');
      const record = duplicateApp(req.params.id, { name: body.name });
      if (!record) return appNotFound(res);
      let recordsCopied = false;
      if (body.withRecords === true) {
        // The copy already exists; a failure here leaves it with no records and says so instead of undoing it.
        try {
          recordsCopied = copyPreviewData(req.params.id, record.id);
        } catch (err) {
          log('warn', 'studio.duplicate_records_failed', { code: typeof err?.code === 'string' ? err.code : 'unknown' });
        }
      }
      return res.status(201).json({ data: { ...record, recordsCopied } });
    }),
  );

  // Export with records: the kit export ZIP of the app's Preview records plus the saved design as app.json. Its records live in
  // the running Preview, so the Preview of this app must be running.
  app.post(
    '/api/studio/apps/:id/export',
    withId,
    safe(async (req, res) => {
      const body = isObject(req.body) ? req.body : {};
      if (body.records !== true) return badRequest(res, 'Send "records" as true. The design alone is exported in the browser.');
      const record = getApp(req.params.id);
      if (!record) return appNotFound(res);
      if (!record.spec) {
        return sendError(res, 'spec_invalid', { message: 'This app has a problem that must be fixed first.', extra: { issues: record.issues } });
      }
      const manager = getPreviewManager();
      const running = manager.status();
      const target = running.state === 'running' && running.appId === record.id ? manager.target() : null;
      if (!target) return sendError(res, 'preview_not_running', { message: 'Start the preview of this app first. Its records live there.' });
      const tables = compileSpec(record.spec).importOrder;
      let answer;
      try {
        answer = tables.length === 0 ? null : await childExport({ ...target, tables });
      } catch (err) {
        log('warn', 'studio.export_records_failed', { code: typeof err?.message === 'string' ? err.message.slice(0, 40) : 'unknown' });
        return sendError(res, 'preview_failed', { status: 502, message: 'The records could not be read from the preview.' });
      }
      if (answer === null) return badRequest(res, 'This app has no tables, so it has no records to export.');
      if (answer.status === 413 || !answer.complete) return sendError(res, 'export_too_large', { status: 413, message: 'The records are too many to export in one file.' });
      if (answer.status !== 200) return sendError(res, 'preview_failed', { status: 502, message: 'The records could not be read from the preview.' });
      const out = Buffer.from(withDesignEntry(new Uint8Array(answer.body), record.spec));
      res.set('Cache-Control', 'no-store');
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="${exportZipName(record.name)}"`);
      res.set('Content-Length', String(out.length));
      return res.send(out);
    }),
  );

  app.get(
    '/api/studio/apps/:id/waiting',
    withId,
    safe((req, res) => (appExists(req.params.id) ? res.json({ data: getWaiting(req.params.id) }) : appNotFound(res))),
  );

  app.delete(
    '/api/studio/apps/:id/waiting',
    withId,
    safe((req, res) => {
      if (!appExists(req.params.id)) return appNotFound(res);
      const at = req.query.at;
      if (at !== undefined && typeof at !== 'string') return badRequest(res, 'Send "at" as text.');
      // With `at` the entry only goes while it still has that version; a newer one stays and the call still succeeds.
      clearWaiting(req.params.id, at ?? null);
      return res.json({ data: { id: req.params.id } });
    }),
  );
}
