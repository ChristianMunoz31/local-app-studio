// Diagnostics routes (phase 15, section 8.3), registered by server/studio/routes.js after the Studio guard. The Studio
// limiter (/api/studio) already covers the paths. Every body is `{ data }`; every error goes through server/errors.js.
import { sendError, sendErrorFrom } from '../errors.js';
import { debugState, LOG_LEVELS, setSessionDebug, tail } from '../log.js';
import { resolveDataDir } from '../paths.js';
import { buildReport, collectInfo, reportFilename } from './report.js';
import { runDoctor, studioOllamaProbe } from './doctor.js';

const LIMIT_RE = /^\d{1,3}$/;

/**
 * @typedef {object} DiagnosticsDeps
 * @property {() => string} [dataDir]
 * @property {(purpose: string) => Promise<object>} [describe] default `describeAi` from server/ai/index.js
 * @property {() => Promise<Array<{ name?: string }>>} [listModels] default `listInstalledModels`
 * @property {() => number | null} [previewPort] default: the preview manager's running port
 * @property {(probe: () => Promise<import('./doctor.js').OllamaState>, dataDir: string) => Promise<import('./doctor.js').DoctorReport>} [doctor]
 * @property {() => Date} [now]
 */

/**
 * @param {import('express').Express} app
 * @param {DiagnosticsDeps} [deps]
 */
export function registerDiagnosticsRoutes(app, deps = {}) {
  const dataDirOf = deps.dataDir ?? (() => resolveDataDir());
  const now = deps.now ?? (() => new Date());
  const aiDescribe = async (purpose) => (deps.describe ?? (await import('../ai/index.js')).describeAi)(purpose);
  const aiList = async () => (deps.listModels ?? (await import('../ai/index.js')).listInstalledModels)();
  const previewPort = async () => {
    if (deps.previewPort) return deps.previewPort();
    return (await import('../studio/preview/manager.js')).getPreviewManager().target()?.port ?? null;
  };
  const probe = () => studioOllamaProbe({ describe: aiDescribe, listModels: aiList })();
  const runChecks = deps.doctor ?? ((ollamaProbe, dataDir) => runDoctor(undefined, { ollamaProbe, dataDir }));

  // One doctor run at a time: concurrent requests share it instead of each spawning the tools.
  let inflight = null;
  const check = () => {
    inflight ??= Promise.resolve()
      .then(() => runChecks(probe, dataDirOf()))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const info = async (req) =>
    collectInfo({
      dataDir: dataDirOf(),
      appPort: req.socket?.localPort ?? null,
      previewPort: await previewPort(),
      helper: await probe().catch(() => ({ state: 'down', host: null, models: [] })),
    });

  app.get('/api/studio/diagnostics', async (req, res) => {
    try {
      return res.json({ data: await info(req) });
    } catch (err) {
      return sendErrorFrom(res, err);
    }
  });

  app.get('/api/studio/diagnostics/doctor', async (req, res) => {
    try {
      return res.json({ data: await check() });
    } catch (err) {
      return sendErrorFrom(res, err);
    }
  });

  app.get('/api/studio/diagnostics/logs', (req, res) => {
    try {
      const { limit = '200', level = 'debug' } = req.query;
      const n = typeof limit === 'string' && LIMIT_RE.test(limit) ? Number(limit) : 0;
      if (n < 1 || n > 500 || typeof level !== 'string' || !LOG_LEVELS.includes(level)) return sendError(res, 'invalid_query');
      return res.json({ data: { lines: tail({ limit: n, minLevel: level }) } });
    } catch (err) {
      return sendErrorFrom(res, err);
    }
  });

  app.post('/api/studio/diagnostics/debug', (req, res) => {
    try {
      const body = req.body;
      if (body === null || typeof body !== 'object' || Array.isArray(body) || typeof body.on !== 'boolean') return sendError(res, 'invalid_body');
      setSessionDebug(body.on);
      return res.json({ data: debugState() });
    } catch (err) {
      return sendErrorFrom(res, err);
    }
  });

  app.get('/api/studio/diagnostics/report', async (req, res) => {
    try {
      const at = now();
      const [infoPayload, doctor] = await Promise.all([info(req), check()]);
      const zip = buildReport({ now: at, info: infoPayload, doctor });
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${reportFilename(at)}"`,
        'Cache-Control': 'no-store',
      });
      return res.status(200).send(Buffer.from(zip));
    } catch (err) {
      return sendErrorFrom(res, err);
    }
  });
}
