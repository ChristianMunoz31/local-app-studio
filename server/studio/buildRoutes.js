// Build routes: toolchain check, build history, start, status, events (SSE) and cancel. Each one answers 403 feature_unavailable
// first in a build without the installer (requireInBuild('installer'), docs/ARCHITECTURE.md, 'The pro seam').
import { requireNetwork } from '../netPolicy.js';
import { openSse } from '../ai/index.js';
import { requireInBuild } from '../buildFeatures.js';
import { sendError } from '../errors.js';
import { UUID_RE, appNotFound, badRequest, sendStudioError } from './http.js';
import { getApp } from './apps.js';
import { getBuildService } from './build/service.js';

const TOOLCHAIN_TTL_MS = 30 * 1000;
const buildNotFound = (res) => sendError(res, 'build_not_found', { message: 'That build does not exist.' });

/**
 * @param {import('express').Express} app
 * @param {{ service?: ReturnType<typeof getBuildService>, detect?: () => Promise<object> }} [opts] defaults: the process-wide service and the real toolchain check
 */
export function registerBuildRoutes(app, { service, detect } = {}) {
  const svc = () => service ?? getBuildService();
  const detectTools =
    detect ?? (async () => (await import('./build/toolchain.js')).detectToolchain());
  let cached = null;
  let inflight = null;
  // One check at a time: concurrent requests (and repeat visits to Settings) share it instead of each
  // spawning the tools. The detect call starts in a microtask so a synchronous throw cannot leave a stale slot.
  const check = () => {
    inflight ??= Promise.resolve()
      .then(detectTools)
      .then((report) => {
        cached = { at: Date.now(), report };
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const withId = (req, res, next) => {
    if (!UUID_RE.test(req.params.id)) return appNotFound(res);
    return next();
  };
  const withBuildId = (req, res, next) => {
    if (!UUID_RE.test(req.params.buildId)) return buildNotFound(res);
    return next();
  };

  app.get('/api/studio/build/toolchain', requireInBuild('installer'), async (req, res) => {
    try {
      const fresh = cached && Date.now() - cached.at < TOOLCHAIN_TTL_MS;
      const entry = req.query.refresh === '1' || !fresh ? await check() : cached;
      const { ok, checkedAt, hostTriple, items } = entry.report;
      return res.json({ data: { ok, checkedAt, hostTriple, items } });
    } catch (err) {
      return sendStudioError(res, err);
    }
  });

  app.get('/api/studio/apps/:id/builds', requireInBuild('installer'), withId, (req, res) => {
    try {
      if (!getApp(req.params.id)) return appNotFound(res);
      return res.json({ data: svc().list(req.params.id) });
    } catch (err) {
      return sendStudioError(res, err);
    }
  });

  app.post('/api/studio/apps/:id/builds', requireInBuild('installer'), requireNetwork('build'), withId, (req, res) => {
    try {
      const baseRevision = req.body && typeof req.body === 'object' ? req.body.baseRevision : undefined;
      if (!Number.isInteger(baseRevision) || baseRevision < 1) return badRequest(res, 'Send the revision you are building as "baseRevision".');
      return res.status(201).json({ data: svc().start({ appId: req.params.id, baseRevision }) });
    } catch (err) {
      return sendStudioError(res, err);
    }
  });

  app.get('/api/studio/builds/:buildId', requireInBuild('installer'), withBuildId, (req, res) => {
    try {
      const build = svc().get(req.params.buildId);
      return build ? res.json({ data: build }) : buildNotFound(res);
    } catch (err) {
      return sendStudioError(res, err);
    }
  });

  app.get('/api/studio/builds/:buildId/events', requireInBuild('installer'), withBuildId, (req, res) => {
    let unsubscribe = () => {};
    try {
      let sse = null;
      const sub = svc().subscribe(req.params.buildId, (event) => {
        sse?.sendEvent(event);
        if (event.type === 'end') sse?.close();
      });
      const snapshot = sub ? sub.snapshot : svc().storedSnapshot(req.params.buildId);
      if (!snapshot) return buildNotFound(res);
      unsubscribe = sub ? sub.unsubscribe : unsubscribe;
      sse = openSse(res);
      res.on('close', () => {
        unsubscribe();
        sse?.stopHeartbeat();
      });
      sse.sendEvent({ type: 'snapshot', ...snapshot });
      if (!snapshot.live) {
        unsubscribe();
        sse.sendEvent({ type: 'end', build: snapshot.build });
        sse.close();
      }
      return undefined;
    } catch (err) {
      unsubscribe();
      return sendStudioError(res, err);
    }
  });

  app.post('/api/studio/builds/:buildId/cancel', requireInBuild('installer'), withBuildId, async (req, res) => {
    try {
      return res.json({ data: await svc().cancel(req.params.buildId) });
    } catch (err) {
      return sendStudioError(res, err);
    }
  });
}
