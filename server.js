// MUST be first: populates process.env before other modules read it at
// import-evaluation time.
import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDataRoutes } from './server/dataRoutes.js';
import { limiterHandler, sendError, sendErrorFrom, sseError } from './server/errors.js';
import { configureLog, REQUEST_ID_HEADER, requestContext } from './server/log.js';
import { installProcessGuards } from './server/processGuards.js';
import { setRedactDataDir } from './server/redact.js';
import { runAssistant } from './server/agents/assistantAgent.js';
import { executeTool } from './server/agents/assistantTools.js';
import { APPROVED_TOOL_RESULT, DECLINED_TOOL_RESULT, FAILED_SAVE_TOOL_RESULT, noteApproval, restorePendingAction, takePendingAction } from './server/agents/pendingActions.js';
import { CONVERSATION_BUSY_MESSAGE, acquireConversationRun, releaseConversationRun } from './server/agents/runLock.js';
import {
  aiAuditMeta,
  classifyAiError,
  describeAi,
  openSse,
  requireAi,
} from './server/ai/index.js';
import { registerAiSettingsRoutes } from './server/aiSettingsRoutes.js';
import * as dataAccess from './server/dataAccess.js';
import { registerAssistantAdvisorRoutes } from './server/assistantAdvisorRoutes.js';
import { isAssistantPage, ASSISTANT_MAX_MESSAGE_CHARS } from './server/assistant/pages.js';
import { registerExportRoutes } from './server/exportRoutes.js';
import { registerIngestRoutes, INGEST_BODY_PATH } from './server/ingestRoutes.js';
import { IMPORT_TOO_LARGE_MESSAGE, registerImportRoutes } from './server/importRoutes.js';
import { registerBackupRoutes } from './server/backup/routes.js';
import { registerStableCopyRoutes } from './server/backup/stableCopyRoutes.js';
import { registerAppInfoRoutes } from './server/appInfoRoutes.js';
import { getChannel, isDevChannel } from './server/channel.js';
import { checkDevDataDir, checkShellChannel } from './server/channelGuards.js';
import { resolveStableDataDir } from './server/paths.js';
import { restoreGateMiddleware } from './server/backup/lock.js';
import { previewMigrationExitCode } from './server/db/errors.js';
import { EXIT_RESTORE_RECOVERY, reconcileRestoreJournal } from './server/backup/restore.js';
import { startBackupScheduler, stopBackupScheduler } from './server/backup/service.js';
import { drainBackupWorker, resumeBackupWorker } from './server/backup/worker/client.js';
import { secretsPrimer } from './server/secrets/index.js';
import { registerSecretsRoutes } from './server/secretsRoutes.js';
import { recordAudit } from './server/auditHook.js';
import { registerAuditRoutes } from './server/audit.js';
import { registerNetworkActivityRoutes } from './server/networkAudit.js';
import {
  checkStartupSecurity,
  formatListenUrl,
  isLoopbackHost,
  isSchedulerEnabled,
  resolveAllowedOrigins,
  resolveListenConfig,
  resolveTrustProxy,
} from './server/config.js';
import { createHostGuard, isSameOrigin, resolveHostPolicy } from './server/hostGuard.js';
import { registerSettingsRoutes } from './server/settingsRoutes.js';
import { initLicense } from './server/license/index.js';
import { storeErrorMessage } from './server/license/messages.js';
import { registerLicenseRoutes } from './server/licenseRoutes.js';
import { registerStaticRoutes } from './server/staticRoutes.js';
import {
  isModuleBudgetPath,
  moduleOwnBody,
  moduleNoStorePaths,
  mountModuleAiLimiters,
  mountModuleLimiters,
  registerServerModules,
  startServerModules,
  stopServerModules,
} from './server/modules/index.js';
import { startScheduler, stopScheduler } from './server/scheduler.js';
import { clearDbShutdown, getDb, isDbError, peekDb, resolveDbPath, shutdownDb } from './server/db/index.js';
import { getAppMode } from './server/appMode.js';
import { envDir, getAppVersion, isDesktopMode } from './server/runtime.js';
import { createDesktopGate, initDesktopAuth } from './server/desktop/auth.js';
import { buildCsp, createSecurityHeaders } from './server/desktop/csp.js';
import { readSecretLine } from './server/desktop/handshake.js';

// The log role of this process: the Studio server, a built app, or the Studio preview child (a runtime-mode child).
const LOG_ROLE = (process.env.APP_PREVIEW_CHILD || '').trim() === '1' ? 'preview' : getAppMode();

// Desktop (Tauri sidecar) mode: per-launch secret gate, strict CSP, no APP_PASSWORD. Decided once at
// import time, like the other env-driven switches below.
const DESKTOP = isDesktopMode();

const DIST_DIR = envDir('APP_DIST_DIR') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');

const app = express();

// Trust no proxy by default (Local App Studio listens on loopback). Set APP_TRUST_PROXY=1
// only when running behind exactly one reverse proxy, so rate limiting and the
// cookie Secure flag see the real client IP and protocol.
app.set('trust proxy', resolveTrustProxy());

// Express 5 defaults to the 'simple' query parser. Keep qs ('extended') so bracket and repeated params
// (limit[]=5, limit=1&limit=2) still parse as arrays and the strict route validators can reject them.
app.set('query parser', 'extended');

// DNS-rebinding guard: MUST be the first middleware. Any Host outside the allowlist
// (loopback names, APP_ALLOWED_HOSTS, a non-loopback APP_HOST) gets 421.
app.use(createHostGuard());
// Request id, X-Request-Id header and one log line per request. Right after the host guard, which stays first.
app.use(requestContext());

if (DESKTOP) {
  // The CSP hashes the inline script in the built index.html once, here. Headers go on every response
  // (the SPA fallback can serve index.html for any path), including the gate's own pages, so they are
  // mounted before the gate.
  let indexHtml = '';
  try {
    indexHtml = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  } catch {
    // no built UI: the API still works, the CSP just carries no script hashes
  }
  app.use(createSecurityHeaders(buildCsp(indexHtml)));
  app.use(createDesktopGate());
}

// CORS allowlist. Requests with no Origin (curl, server-to-server) are allowed.
// Browsers also send Origin on same-origin POSTs, so an Origin whose scheme/host/port
// is an allowed host AND equals the request's Host is allowed too (this is what lets the
// bundled UI work on any allowed host/port). Other cross-origin browser requests
// must match ALLOWED_ORIGINS (comma-separated) or the loopback defaults in config.js.
const ALLOWED_ORIGINS = resolveAllowedOrigins();
const HOST_POLICY = resolveHostPolicy();
app.use(
  cors((req, callback) => {
    const origin = req.get('origin');
    if (!origin || ALLOWED_ORIGINS.includes(origin) || isSameOrigin(origin, req.get('host'), HOST_POLICY)) {
      return callback(null, { origin: true, exposedHeaders: [REQUEST_ID_HEADER] });
    }
    return callback(new Error('Not allowed by CORS'));
  }),
);
// POST /api/export and POST /api/ingest/parse apply their own JSON limits in their routes (export much smaller,
// ingest larger for a base64 document), so the global parser must not consume the body first and make them dead.
// Express routes case-insensitively and ignores trailing slashes; path checks must too.
const normalizePath = (p) => p.toLowerCase().replace(/\/+$/, '');
const jsonParser = express.json({ limit: '2mb' });
const OWN_BODY_PATHS = new Set(['/api/export', INGEST_BODY_PATH]);
// An active module can list its own body-limited routes the same way (server/modules/index.js `ownBody`).
app.use((req, res, next) =>
  OWN_BODY_PATHS.has(normalizePath(req.path)) || moduleOwnBody(req) ? next() : jsonParser(req, res, next),
);

const TOO_MANY_MESSAGE = 'Too many requests, please try again later.';

// Rate limiting. A modest global cap on /api plus tighter caps on the
// abuse-prone endpoints: AI POSTs (model time) and the license store calls.
// AI status GETs are not counted against the AI budgets.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  // A module with its own budget (server/modules/*.js `limiters`, for example /api/data) is not counted here.
  skip: (req) => isModuleBudgetPath(req),
  handler: limiterHandler({ message: TOO_MANY_MESSAGE }),
});
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterHandler({ message: TOO_MANY_MESSAGE }),
});
// Dedicated budget for secrets writes/test so heavy use of the AI endpoints (which
// share strictLimiter) can't lock the user out of managing keys, and vice versa.
const secretsWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterHandler({ message: TOO_MANY_MESSAGE }),
});
// Activate and Move to another computer are the only calls that can reach a store: one shared budget
// (10 per 15 min) so a stuck button can't hammer Gumroad or Lemon Squeezy.
const licenseNetworkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterHandler({ message: storeErrorMessage('rate_limited') }),
});
// Approving or declining a proposed Assistant change runs no model; it gets its own generous
// budget so a busy AI budget never blocks a confirmation.
const actionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterHandler({ message: TOO_MANY_MESSAGE }),
});
/** Apply `limiter` to POSTs only, unless `skip(req)` says otherwise. */
const postLimiter = (limiter, skip) => (req, res, next) =>
  req.method !== 'POST' || skip?.(req) ? next() : limiter(req, res, next);
// Actions run no model and conversation creation is a plain DB write: neither spends the strict AI budget.
const isActionsPath = (req) => /^\/(actions|conversations)(\/|$)/i.test(req.path);
// Secrets, data, export and license responses must never be cached, including limiter/auth errors.
app.use(['/api/secrets', '/api/data', '/api/export', '/api/ingest', '/api/license', ...moduleNoStorePaths()], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', globalLimiter);
// Each active module's own rate budgets, right after the global limiter that skips them.
mountModuleLimiters(app, rateLimit);
app.use('/api/assistant/actions', actionsLimiter);
app.use('/api/assistant', postLimiter(strictLimiter, isActionsPath));
// Module AI POSTs (for example Studio's Describe) spend the same strict budget.
mountModuleAiLimiters(app, () => postLimiter(strictLimiter));

// ============================================================
// Auth gate. When APP_PASSWORD + AUTH_SECRET are set, every /api
// route requires a valid signed session cookie obtained via
// POST /api/login. When unset (the default for a single-user local install),
// the gate is disabled and the API is open to whoever can reach the port.
// ============================================================
// Desktop mode ignores both: the per-launch desktop gate above is the only gate there.
const APP_PASSWORD = DESKTOP ? '' : process.env.APP_PASSWORD || '';
const AUTH_SECRET = DESKTOP ? '' : process.env.AUTH_SECRET || '';
const AUTH_ENABLED = !!(APP_PASSWORD && AUTH_SECRET);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_COOKIE = 'app_session';
const PUBLIC_AUTH_PATHS = new Set(['/api/login', '/api/logout', '/api/auth/status']);

const signAuth = (payload) =>
  crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');

const createSessionToken = () => {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${signAuth(payload)}`;
};

const verifySessionToken = (token) => {
  if (!token || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signAuth(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && Date.now() < exp;
};

const parseCookies = (req) => {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    try {
      out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // Malformed percent-encoding: skip this pair rather than failing the request.
    }
  }
  return out;
};

// Secure only when the request itself is HTTPS (req.secure; honors X-Forwarded-Proto
// only when APP_TRUST_PROXY=1), so plain-http localhost sessions still work.
const sessionCookie = (token, maxAgeSec, secure) => {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
};

const passwordMatches = (input) => {
  try {
    if (typeof input !== 'string') return false;
    const a = crypto.createHmac('sha256', AUTH_SECRET).update(input).digest();
    const b = crypto.createHmac('sha256', AUTH_SECRET).update(APP_PASSWORD).digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterHandler({ message: 'Too many login attempts, please try again later.' }),
});

app.get('/api/auth/status', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ enabled: false, authenticated: true });
  res.json({ enabled: true, authenticated: verifySessionToken(parseCookies(req)[SESSION_COOKIE]) });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  if (!AUTH_ENABLED) return sendError(res, 'auth_not_configured');
  if (!passwordMatches(req.body?.password)) {
    await recordAudit({ kind: 'auth', feature: 'sign_in', status: 'error' });
    return sendError(res, 'invalid_password');
  }
  await recordAudit({ kind: 'auth', feature: 'sign_in', status: 'ok' });
  res.setHeader('Set-Cookie', sessionCookie(createSessionToken(), Math.floor(SESSION_TTL_MS / 1000), req.secure));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', sessionCookie('', 0, req.secure));
  res.json({ ok: true });
});

// Protect every other /api route. Express routing is case-insensitive (/API/x and
// /Api/x reach the same handlers as /api/x), so the prefix test and the public-path
// lookup compare the lowercased path with trailing slashes ignored.
const API_PREFIX_RE = /^\/api(\/|$)/i;
const normalizeApiPath = (p) => p.toLowerCase().replace(/\/+$/, '');
app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next();
  if (!API_PREFIX_RE.test(req.path)) return next();
  if (PUBLIC_AUTH_PATHS.has(normalizeApiPath(req.path))) return next();
  if (verifySessionToken(parseCookies(req)[SESSION_COOKIE])) return next();
  return sendError(res, 'sign_in_required');
});

// Secrets writes (PUT/DELETE/test) get their own cap; GET (status) is read-only and
// gated, so it only counts against the global limiter. Mounted after the auth gate so
// unauthenticated (401) requests cannot exhaust the owner's write budget; the early
// no-store middleware above still covers their 401s and any 429.
const writesOnly = (limiter) => (req, res, next) =>
  req.method === 'GET' || req.method === 'HEAD' ? next() : limiter(req, res, next);
app.use('/api/secrets', writesOnly(secretsWriteLimiter));

// Warm the secrets cache (one DB read per 60s) so synchronous peekSecret() reads in
// every handler see keys saved from Settings. Mounted after the auth gate.
app.use('/api', secretsPrimer);

// While a backup restore swaps the database file, /api answers 503 db_restoring (only
// GET /api/backups/status passes). Counts in-flight requests so the restore can wait for them.
app.use('/api', restoreGateMiddleware);

// The local SQLite database is the sole data backend. registerDataRoutes serves generic app
// state. Each route 503s if the database cannot be opened, so a failed open never silently
// removes an endpoint.
registerDataRoutes(app);

// ============================================================
// Assistant: the tool-calling assistant that reads + acts on the user's real
// Local App Studio data. SSE-streamed (thinking, delta, tool.start/tool.done, confirm.required,
// final, run.done) so the Assistant panel can show tool activity live. Runs on the
// local tool model. Writes wait for confirmation and are bounded by a per-run cap.
// ============================================================
app.get('/api/assistant/status', async (req, res) => {
  res.json(await describeAi('tools'));
});

const validateAssistant = (req, res, next) => {
  const { prompt, conversationId, page } = req.body || {};
  if (page !== undefined && page !== null && !isAssistantPage(page)) {
    return sendError(res, 'unknown_page', { message: 'Unknown page' });
  }
  if (conversationId !== undefined && conversationId !== null && typeof conversationId !== 'string') {
    return sendError(res, 'invalid_body', { message: 'conversationId must be a string' });
  }
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return sendError(res, 'invalid_body', { message: 'Missing or invalid prompt' });
  }
  if (prompt.length > ASSISTANT_MAX_MESSAGE_CHARS) {
    return sendError(res, 'prompt_too_long', { message: 'Prompt is too long' });
  }

  return next();
};

// AI that cannot run answers 503 before the stream opens; nothing is sent anywhere.
app.post('/api/assistant', validateAssistant, requireAi('tools'), async (req, res) => {
    const { prompt, conversationId, page } = req.body;
    const client = res.locals.ai;
    // One run per conversation: answered before any SSE headers.
    const lockId = conversationId || null;
    if (lockId && !acquireConversationRun(lockId)) {
      return sendError(res, 'conversation_busy', { message: CONVERSATION_BUSY_MESSAGE });
    }
    try {
      const controller = new AbortController();
      const abort = { aborted: false };
      res.on('close', () => {
        if (!res.writableFinished) {
          abort.aborted = true;
          controller.abort();
        }
      });
      const sse = openSse(res);
      // First event: where this turn runs (computer, network or a cloud host), so the UI can say so.
      sse.sendEvent({ type: 'meta', ai: client.ai ?? { kind: 'local', host: null } });
      const started = Date.now();
      let auditStatus = 'ok';
      try {
        await runAssistant({
          conversationId: conversationId || null,
          prompt: prompt.trim(),
          page: page || null,
          abort,
          signal: controller.signal,
          client,
          onEvent: (event) => {
            if (!abort.aborted) sse.sendEvent(event);
          },
        });
      } catch (err) {
        console.error('Assistant error:', err?.name || 'unknown');
        auditStatus = 'error';
        const c = classifyAiError(err);
        if (!abort.aborted) {
          sse.sendEvent({
            ...sseError(c.code, { message: c.message, extra: { ...(c.reason ? { reason: c.reason } : {}), retryMs: c.retryMs } }),
            type: 'error',
          });
        }
      } finally {
        await recordAudit({
          kind: 'llm',
          feature: 'assistant',
          ...(page ? { page } : {}),
          provider: client.provider,
          model: client.model,
          status: auditStatus,
          context: prompt,
          meta: { calls: client.stats.calls, ms: Date.now() - started, ...aiAuditMeta(client) },
        });
        sse.close();
      }
    } finally {
      if (lockId) releaseConversationRun(lockId);
    }
});

// Approve or decline a write Assistant proposed (ASSISTANT_CONFIRM_WRITES). Tokens are single-use,
// expire after ten minutes and are bound to the conversation they came from. No model runs
// here (the approved tool executes locally), so the only gate is isAiEnabled(): no Ollama
// probe and no AI queue slot, and declining always works while AI is on.
app.post('/api/assistant/actions/:token', requireAi('tools', { enabledOnly: true }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { approve, conversationId } = req.body || {};
  if (typeof approve !== 'boolean') {
    return sendError(res, 'invalid_body', { message: 'approve must be a boolean' });
  }
  if (conversationId !== undefined && conversationId !== null && typeof conversationId !== 'string') {
    return sendError(res, 'invalid_body', { message: 'conversationId must be a string' });
  }
  const action = takePendingAction(req.params.token, conversationId || null);
  if (!action) {
    return sendError(res, 'action_not_found', { message: 'That change expired or was already handled.' });
  }
  // The stored tool result replaces "awaiting_confirmation" in later turns. It is plain words, not the saved row: a
  // declined save must never read back as a record, and an approved one is data the next read tool shows.
  const persistTool = async (content) => {
    if (!action.conversationId) return;
    try {
      await dataAccess.appendMessage(action.conversationId, { role: 'tool', content, toolCallId: action.callId });
    } catch {
      /* best effort */
    }
  };
  try {
    if (!approve) {
      await persistTool(DECLINED_TOOL_RESULT);
      return res.json({ data: { name: action.name, approved: false, result: null } });
    }
    const ctx = action.ctx;
    if ((ctx.writeCount ?? 0) >= (ctx.writeCap ?? 3)) {
      restorePendingAction(req.params.token, action);
      return sendError(res, 'write_cap_reached', { message: 'Assistant reached its change limit for that request.' });
    }
    const result = await executeTool(action.name, action.args, ctx);
    if (result?.error !== undefined) {
      // The save did not happen: say so in the stored row, and do not let the next turn believe a change was approved.
      await persistTool(FAILED_SAVE_TOOL_RESULT);
    } else {
      noteApproval(action.conversationId);
      await persistTool(APPROVED_TOOL_RESULT);
    }
    return res.json({ data: { name: action.name, approved: true, result } });
  } catch (err) {
    console.error('Assistant action error:', err?.name || 'unknown');
    return sendError(res, 'server_error', { message: 'Failed to apply the change' });
  }
});

// Assistant conversation history (best-effort; 503s if the local database is unavailable).
app.get('/api/assistant/conversations', async (req, res) => {
  try {
    res.json(await dataAccess.listConversations({ limit: 30 }));
  } catch (err) {
    sendErrorFrom(res, err);
  }
});

const CONVERSATION_TITLE_MAX_CHARS = 200;
app.post('/api/assistant/conversations', async (req, res) => {
  const title = req.body?.title;
  if (title !== undefined && title !== null && typeof title !== 'string') {
    return sendError(res, 'invalid_body', { message: 'title must be a string' });
  }
  try {
    const clipped = typeof title === 'string' ? title.slice(0, CONVERSATION_TITLE_MAX_CHARS) : undefined;
    res.json(await dataAccess.createConversation({ title: clipped }));
  } catch (err) {
    sendErrorFrom(res, err);
  }
});

app.get('/api/assistant/conversations/:id/messages', async (req, res) => {
  try {
    res.json(await dataAccess.getMessages(req.params.id, { limit: 100 }));
  } catch (err) {
    sendErrorFrom(res, err);
  }
});

// Assistant page advisor: POST /api/assistant/advice - strictLimiter via the /api/assistant prefix, behind the auth gate
registerAssistantAdvisorRoutes(app);
registerExportRoutes(app, { authEnabled: AUTH_ENABLED });
// Document parser: POST /api/ingest/parse (bytes in, page text out; parsing runs in a child process, server/ingest/).
registerIngestRoutes(app, { authEnabled: AUTH_ENABLED });
registerImportRoutes(app, { authEnabled: AUTH_ENABLED });
registerBackupRoutes(app, { authEnabled: AUTH_ENABLED });
// Dev channel only: one-way copy of the stable Local App Studio data (a stable build never registers these).
registerStableCopyRoutes(app, { authEnabled: AUTH_ENABLED });
// Version, channel and desktop flag for the UI (Dev build badge).
registerAppInfoRoutes(app);
registerSecretsRoutes(app);
// Access & AI audit log (GET /api/audit), behind the auth gate.
registerAuditRoutes(app);
// Network activity (GET /api/privacy/network-activity): outbound connections from the audit log, host only.
registerNetworkActivityRoutes(app);
// Profile (display name) and Settings → Network opt-ins, behind the auth gate.
registerSettingsRoutes(app);
// Settings > AI (Ollama host, models, optional cloud provider), behind the auth gate.
registerAiSettingsRoutes(app);
// Store license keys (status, activate, deactivate, remove, trial), behind the auth gate and the desktop gate.
// The network limiter sits after the auth gate so unauthenticated requests cannot spend the budget (no-store is set earlier).
app.use(['/api/license/activate', '/api/license/deactivate'], postLimiter(licenseNetworkLimiter));
registerLicenseRoutes(app);
// Routes of the active modules (server/modules/), behind the auth gate and the desktop gate.
registerServerModules(app, { authEnabled: AUTH_ENABLED });

// Unmatched API paths answer JSON, never the SPA shell.
app.use('/api', (req, res) => sendError(res, 'not_found'));

// Built UI: when dist/ exists, Local App Studio serves it itself (single process).
registerStaticRoutes(app, { distDir: DIST_DIR });

// Final error handler: keeps CORS rejections and any uncaught errors from
// leaking a stack trace via Express's default HTML error page.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Parser errors skip the no-store middleware above (they fire before it), so every /api error is marked here.
  const errPath = normalizePath(req.path);
  if (errPath === '/api' || errPath.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (err && err.message === 'Not allowed by CORS') {
    return sendError(res, 'origin_not_allowed');
  }
  // A malformed percent-escape in a route param (/api/state/%E0%A4%A): the router throws a
  // URIError with status 400 and no err.type, which would otherwise fall through to 500.
  if (err instanceof URIError && err.status === 400) {
    return sendError(res, 'invalid_request', { message: 'The request address is not valid.' });
  }
  // body-parser 4xx (malformed JSON, 413 too large, 415 unsupported encoding/charset):
  // it attaches the raw request body to err.body, which can contain a pasted API key.
  // Answer with the parser's status and a fixed message; never log the error object.
  const parserStatus = err?.status ?? err?.statusCode;
  if (parserStatus === 413 && normalizePath(req.path) === '/api/import') {
    return sendError(res, 'import_too_large', { message: IMPORT_TOO_LARGE_MESSAGE });
  }
  if (parserStatus === 413 && moduleOwnBody(req)) {
    const ownMessage = moduleOwnBody(req).tooLarge?.message;
    return sendError(res, 'request_too_large', { status: 413, ...(typeof ownMessage === 'string' ? { message: ownMessage } : {}) });
  }
  if (typeof err?.type === 'string' && Number.isInteger(parserStatus) && parserStatus >= 400 && parserStatus < 500) {
    // The Studio and built-app clients show the sentence: say what is wrong and name the 2 MB limit.
    const named = errPath.startsWith('/api/studio/') || errPath === '/api/data' || errPath.startsWith('/api/data/');
    return sendError(res, parserStatus === 413 ? 'request_too_large' : 'invalid_body', {
      status: parserStatus,
      ...(named && parserStatus !== 413 ? { message: 'That request could not be read. Check it and try again.' } : {}),
    });
  }
  console.error('Unhandled error:', err?.type || err?.code || err?.name || 'unknown');
  return sendErrorFrom(res, err);
});

/**
 * Boots the HTTP server: startup security checks, opens (and migrates) the database, listens, then
 * starts the scheduler. Rejects on a failed security check, database or listen error.
 * In desktop mode it first reads the per-launch secret from `stdin` (see server/desktop/handshake.js),
 * then prints one `APP_READY {json}` line once listening, and shuts down when `stdin` closes.
 * @param {{ port?: number, host?: string, handleSignals?: boolean, log?: boolean, stdin?: import('node:stream').Readable }} [opts]
 * @returns {Promise<{ server: import('node:http').Server, url: string, stop: () => Promise<void> }>}
 */
export async function startServer({ port, host, handleSignals = false, log = false, stdin = process.stdin } = {}) {
  const resolved = resolveListenConfig();
  const listenConfig = { ...resolved, ...(port !== undefined ? { port } : {}), ...(host !== undefined ? { host } : {}) };
  const security = checkStartupSecurity();
  for (const w of security.warnings) console.warn(w);
  if (!security.ok) {
    for (const e of security.errors) console.error(e);
    throw Object.assign(new Error('Startup security check failed'), { code: 'startup_security' });
  }
  // Channel isolation guards. Pure path and string checks that run before anything touches the data folder
  // (restore journal, secrets, key file, license, database).
  const shellChannel = DESKTOP ? checkShellChannel() : { ok: true };
  const dataDirGuard = shellChannel.ok ? checkDevDataDir() : shellChannel;
  if (!dataDirGuard.ok) {
    console.error(dataDirGuard.message);
    throw Object.assign(new Error('Startup security check failed'), { code: 'startup_security' });
  }
  let stdinGone = false;
  let stdinMarker = null;
  if (DESKTOP) {
    if (!isLoopbackHost(listenConfig.host)) {
      console.error('Desktop mode only listens on a loopback address.');
      throw Object.assign(new Error('Startup security check failed'), { code: 'startup_security' });
    }
    initDesktopAuth(await readSecretLine(stdin));
    // From here until the real shutdown listeners attach (after the DB open and listen), remember that the
    // shell went away and swallow stream errors, so neither is lost or uncaught.
    const markGone = () => {
      stdinGone = true;
    };
    stdin.on('end', markGone);
    stdin.on('close', markGone);
    stdin.on('error', markGone);
    stdinMarker = markGone;
  }
  clearDbShutdown();
  resumeBackupWorker();
  // Finish or undo an interrupted backup restore before the database opens.
  // If recovery cannot finish, refuse to start: opening the database now could create an empty one
  // next to the half-moved real files.
  try {
    await reconcileRestoreJournal();
  } catch (err) {
    const code = err?.code || err?.name || 'unknown';
    console.error('Restore recovery failed:', code);
    throw Object.assign(new Error('Restore recovery failed'), {
      code: 'restore_recovery_failed',
      dataDir: path.dirname(resolveDbPath()),
      cause: err,
    });
  }
  if (isDevChannel()) {
    const stable = resolveStableDataDir();
    if (stable.overridden) console.log(`Local App Studio Dev: copy source overridden by APP_STABLE_DATA_DIR: ${stable.dir}`);
  }
  // The data folder is known: open the log file and tell the redactor which folder to hide.
  configureLog({ dataDir: path.dirname(resolveDbPath()), role: LOG_ROLE, desktop: DESKTOP });
  setRedactDataDir(path.dirname(resolveDbPath()));
  // Open (and migrate) the database before listening; refuse to start without it.
  getDb();
  initLicense({ dataDir: path.dirname(resolveDbPath()), distDir: DIST_DIR });
  const server = await new Promise((resolve, reject) => {
    const srv = app.listen(listenConfig.port, listenConfig.host);
    srv.once('error', reject);
    srv.once('listening', () => {
      srv.off('error', reject);
      resolve(srv);
    });
  });
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : listenConfig.port;
  const url = formatListenUrl({ ...listenConfig, port: boundPort });
  if (DESKTOP) {
    // The single line the shell waits for. Never print the secret, bootstrap token or cookie.
    const dataDir = path.dirname(resolveDbPath());
    console.log(`APP_READY ${JSON.stringify({ port: boundPort, dataDir, version: getAppVersion(), channel: getChannel() })}`);
  } else if (log) {
    console.log(`Local App Studio running at ${url}`);
    console.log(`Data: ${resolveDbPath()}`);
  }
  if (isSchedulerEnabled()) {
    startScheduler();
    startBackupScheduler();
  }
  await startServerModules();

  let stopping = null;
  const stop = () => {
    if (!stopping) {
      stopScheduler();
      stopBackupScheduler();
      stopping = (async () => {
        const closed = new Promise((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections?.();
        });
        // Backup worker: let a running operation finish (up to 1.5 s), else terminate it, so no worker
        // thread holds the database or a partial file when the handle closes. Inside the 3 s hard exit.
        await Promise.all([closed, drainBackupWorker({ timeoutMs: 1500 }).catch(() => {})]);
        // Module hooks (for example killing a preview child) run before the database closes.
        await stopServerModules();
        shutdownDb();
      })();
    }
    return stopping;
  };
  if (handleSignals) {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      setTimeout(() => process.exit(0), 3000).unref();
      stop().then(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    // Desktop shell: Windows cannot deliver SIGTERM to a console-less child, so the parent holds
    // our stdin pipe and closing it (or the parent dying) triggers the same graceful shutdown.
    // Always on in desktop mode; APP_EXIT_ON_STDIN_CLOSE=1 enables it for other launchers.
    if (DESKTOP || process.env.APP_EXIT_ON_STDIN_CLOSE === '1') {
      stdin.on('end', shutdown);
      stdin.on('close', shutdown);
      stdin.on('error', shutdown);
      if (stdinMarker) {
        stdin.off('end', stdinMarker);
        stdin.off('close', stdinMarker);
        stdin.off('error', stdinMarker);
      }
      if (stdinGone) shutdown();
      stdin.resume();
    }
  }
  return { server, url, stop };
}

// The app is exported for supertest; Vitest sets VITEST so tests never open a socket.
// `--role` belongs to server/entry.js (the parser child). Starting the app with it would open the database in a
// process meant to be a parser, so refuse before startServer runs.
if (!process.env.VITEST && process.argv.slice(2).some((a) => a === '--role' || a.startsWith('--role='))) {
  console.error('--role is handled by server/entry.js, not server.js. Run: node server/entry.js --role parser');
  process.exit(2);
}
if (!process.env.VITEST) {
  // Uncaught exceptions and unhandled rejections: keep serving unless the process is unsafe (exit 5). Before startServer
  // resolves, the startup path applies (exit 1).
  const uninstallGuards = installProcessGuards({
    role: LOG_ROLE,
    getDb: peekDb,
    errors: { sendError, sseError },
  });
  startServer({ handleSignals: true, log: true }).then(
    ({ server, stop }) => {
      uninstallGuards.markReady(stop);
      server.on('error', (err) => {
        console.error(`Server error: ${err?.code || err?.name || 'unknown'}`);
        process.exit(1);
      });
    },
    (err) => {
      if (err?.code === 'startup_security') process.exit(1);
      if (err?.code === 'restore_recovery_failed') {
        const dir = err.dataDir ?? '<data dir>';
        const details = err.cause?.details ?? {};
        const backupsPath = path.join(dir, 'backups');
        const asideDb = path.join(dir, 'restore-aside', 'app.db');
        const failedFiles = Array.isArray(details.restoreFailed) ? details.restoreFailed : [];
        let previous;
        if (fs.existsSync(asideDb)) {
          previous = `Your previous data is in ${asideDb} and safety copies are in ${backupsPath}.`;
        } else {
          const safety = typeof details.safetyId === 'string' ? `the safety backup ${details.safetyId} in ${backupsPath}` : `the safety copies in ${backupsPath}`;
          const failed = failedFiles.length ? ` and the restore-failed files ${failedFiles.map((n) => path.join(dir, n)).join(', ')}` : '';
          previous = `Your previous data is in ${safety}${failed}.`;
        }
        console.error(
          'Local App Studio could not finish recovering an interrupted backup restore, so it did not start. ' +
            `Nothing was deleted. ${previous} Close programs that may be using these files ` +
            '(antivirus, sync tools) and start Local App Studio again.',
        );
        process.exit(EXIT_RESTORE_RECOVERY);
      }
      if (err?.code === 'desktop_handshake') {
        console.error('Desktop startup failed: invalid handshake.');
        process.exit(2);
      }
      if (isDbError(err)) console.error(`Database unavailable: ${err.code}`);
      // Only the Studio preview child reports a failed table update with its own exit code (not the backup step).
      const migrationExit = previewMigrationExitCode(err);
      if (migrationExit !== null) process.exit(migrationExit);
      else if (err?.code === 'EADDRINUSE') console.error(`Port ${resolveListenConfig().port} is already in use. Set APP_PORT to another port.`);
      else console.error(`Server error: ${err?.code || err?.name || 'unknown'}`);
      process.exit(1);
    },
  );
}

export default app;
