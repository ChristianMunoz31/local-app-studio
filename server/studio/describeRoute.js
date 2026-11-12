// Route 8: POST /api/studio/apps/:id/describe. Streams a proposed AppSpec as server-sent events. It never changes the
// app itself (Apply is a normal PUT with the revision from the proposal event), but it keeps the run with the app in
// app_state (server/studio/waiting.js): the words when the run starts, the checked proposal when the helper answers, so
// a design that waits survives a closed window or another browser. With `onto: 'waiting'` (mode edit only) the run
// changes the stored waiting design instead of the saved spec and the ask is added to the entry's asks.
import { aiAuditMeta, classifyAiError, openSse, requireAi } from '../ai/index.js';
import { recordAudit } from '../auditHook.js';
import { requireInBuild } from '../buildFeatures.js';
import { sendError, sseError } from '../errors.js';
import { keepAutomations, withoutAutomations } from '@local-app-studio/runtime/spec/rules.ts';
import { getApp } from './apps.js';
import { UUID_RE, appNotFound, badRequest, sendStudioError } from './http.js';
import { DescribeError, runDescribe } from './describe/pipeline.js';
import { checkSpec } from './specCheck.js';
import { loadLibrary } from './features/store.js';
import { getWaiting, startRun, storeProposal } from './waiting.js';
import { log } from '../log.js';

export const DESCRIBE_SCOPE = Object.freeze({ categories: [] });
const INSTRUCTION_MAX = 2000;
const NO_WAITING = 'There is no waiting design to change. Make your app first.';
export const WAITING_STALE = 'This app was saved after the waiting design was made, so it cannot be changed. Make a new design or start over.';
export const WAITING_CHANGED = 'The waiting design changed in another window. Reload this page and try again.';
export const NOT_KEPT = 'The helper made a change, but it could not be kept with the app. Try again.';
const INVALID_PROPOSAL = 'The model could not produce a valid app. Try a shorter description.';

function parseDescribeBody(req, res, next) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!UUID_RE.test(req.params.id)) return appNotFound(res);
  if (body.mode !== 'create' && body.mode !== 'edit') return badRequest(res, 'Choose create or edit.');
  if (instruction.length < 1 || instruction.length > INSTRUCTION_MAX) return badRequest(res, `Describe the app in 1 to ${INSTRUCTION_MAX} characters.`);
  if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 1) return badRequest(res, 'Send the revision you started from as "baseRevision".');
  if (body.onto !== undefined && body.onto !== 'waiting') return badRequest(res, 'Send "onto" as "waiting" or leave it out.');
  if (body.onto === 'waiting' && body.mode !== 'edit') return badRequest(res, 'A change to the waiting design is an edit.');
  res.locals.describe = { mode: body.mode, instruction, baseRevision: body.baseRevision, onto: body.onto === 'waiting' };
  return next();
}

function loadDescribeApp(req, res, next) {
  try {
    const record = getApp(req.params.id);
    if (!record) return appNotFound(res);
    if (!record.spec) {
      return sendError(res, 'spec_invalid', {
        message: 'This app has a problem that must be fixed first.',
        extra: { issues: record.issues },
      });
    }
    if (record.revision !== res.locals.describe.baseRevision) {
      return sendError(res, 'revision_conflict', {
        message: 'This app changed in another window. Reload it and try again.',
        extra: { revision: record.revision },
      });
    }
    if (res.locals.describe.onto) {
      const waiting = getWaiting(record.id);
      // The missing design stays invalid_request: it is a request that cannot be run, and the sentence says why.
      if (!waiting || !waiting.proposal) return badRequest(res, NO_WAITING);
      // A design made before a later save can never be used (Use this checks its revision), so no ask is run on it.
      if (waiting.baseRevision !== record.revision) {
        return sendError(res, 'waiting_stale', { message: WAITING_STALE, extra: { revision: record.revision } });
      }
      res.locals.waiting = waiting;
    }
    res.locals.record = record;
    return next();
  } catch (err) {
    return sendStudioError(res, err);
  }
}

const LOCAL_ONLY_MESSAGE = 'The helper runs only on the model on this computer. Choose a local Ollama tools model in Settings > AI.';

function refuseCloud(req, res, next) {
  if (res.locals.ai.isCloud) return sendError(res, 'describe_local_only', { message: LOCAL_ONLY_MESSAGE });
  return next();
}

/** @param {import('express').Express} app */
export function registerDescribeRoute(app) {
  app.post('/api/studio/apps/:id/describe', requireInBuild('helper'), parseDescribeBody, loadDescribeApp, requireAi('tools'), refuseCloud, async (req, res) => {
    const client = res.locals.ai;
    const { mode, instruction, onto } = res.locals.describe;
    const savedSpec = res.locals.record.spec;
    const waiting = onto ? res.locals.waiting : null;
    const baseSpec = waiting ? waiting.proposal : savedSpec;
    // A refined design keeps the revision the waiting design started from, so Use this still sees a changed app.
    const baseRevision = waiting?.baseRevision ?? res.locals.describe.baseRevision;
    const keep = (what, fn) => {
      try {
        fn();
      } catch (err) {
        log('warn', 'studio.waiting_write_failed', { what, code: err?.code ?? 'unknown' });
      }
    };
    keep('start', () => startRun(res.locals.record.id, { mode, instruction, baseRevision, refine: onto }));
    const started = Date.now();
    const sse = openSse(res);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    let status = 'error';
    try {
      sse.send('meta', { ai: client.ai ?? { kind: 'local', host: null } });
      const result = await runDescribe({
        client,
        scope: DESCRIBE_SCOPE,
        mode,
        instruction,
        // The helper never sees numbering or automations (its prompt and schema stay as they were); they are put back below.
        baseSpec: withoutAutomations(baseSpec),
        features: loadLibrary(),
        cacheKey: String(res.locals.record.id),
        signal: controller.signal,
        onProgress: (p) => sse.send('progress', p),
      });
      // The person cancelled while the helper worked: nothing is kept and nothing is sent.
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // The model never renames, re-identifies or re-versions the app.
      // A numbering and the rules of the saved design stay, except a rule the change broke (the review names it).
      const proposal = { ...keepAutomations(result.proposal, baseSpec), app: baseSpec.app };
      if (!checkSpec(proposal).ok) {
        sse.send('error', sseError('proposal_invalid', { message: INVALID_PROPOSAL }));
      } else {
        const fallbacks = result.fallbacks.map((f) => ({ part: f.step, pageId: f.pageId, message: f.message }));
        let stored = { at: null, stale: false };
        try {
          stored = storeProposal(res.locals.record.id, { mode, instruction, baseRevision, proposal, fallbacks, refine: onto, savedSpec, expectedAt: waiting?.at ?? null });
        } catch (err) {
          log('warn', 'studio.waiting_write_failed', { what: 'proposal', code: err?.code ?? 'unknown' });
        }
        if (stored.stale) {
          // Another window changed or removed the waiting design while this ask ran: the newer one stays.
          sse.send('error', sseError('revision_conflict', { message: WAITING_CHANGED }));
        } else if (onto && stored.at === null) {
          // A change to the waiting design needs its new version to go on from: without one a later ask or Use this would act on
          // an old design, so the change is reported as not made instead of sent as a design with no version.
          sse.send('error', sseError('server_error', { message: NOT_KEPT }));
        } else {
          status = 'ok';
          sse.send('proposal', {
            proposal,
            fallbacks,
            baseRevision,
            at: stored.at,
            onto: onto ? 'waiting' : null,
            replaced: onto ? waiting.proposal : null,
            steps: Array.isArray(result.steps) ? result.steps.length : result.steps,
          });
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err instanceof DescribeError) {
          sse.send('error', sseError(err.code, { message: err.publicMessage }));
        } else {
          const c = classifyAiError(err);
          sse.send('error', sseError(c.code, { message: c.message, extra: { retryMs: c.retryMs } }));
        }
      }
    }
    await recordAudit({
      kind: 'llm',
      feature: 'studio_describe',
      provider: client.provider,
      model: client.model,
      status,
      context: instruction.slice(0, 2000),
      meta: { calls: client.stats.calls, ms: Date.now() - started, mode, ...aiAuditMeta(client) },
    });
    sse.send('done', {});
    sse.close();
  });
}
