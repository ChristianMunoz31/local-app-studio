// Routes 9 to 13: start, status, stop and data reset of the preview child, and the /api/preview proxy.
import { sendError } from '../errors.js';
import { getApp } from './apps.js';
import { UUID_RE, appNotFound, badRequest, sendStudioError } from './http.js';
import { getPreviewManager } from './preview/manager.js';
import { createPreviewProxy } from './preview/proxy.js';

/**
 * @param {import('express').Express} app
 * @param {{ manager?: ReturnType<typeof getPreviewManager> }} [opts] defaults to the process-wide manager, looked up per request
 */
export function registerPreviewRoutes(app, { manager } = {}) {
  const mgr = () => manager ?? getPreviewManager();

  app.post('/api/studio/preview/start', async (req, res) => {
    try {
      const appId = req.body && typeof req.body === 'object' ? req.body.appId : undefined;
      if (typeof appId !== 'string' || !UUID_RE.test(appId)) return badRequest(res, 'Send the app to preview as "appId".');
      const record = getApp(appId);
      if (!record) return appNotFound(res);
      if (!record.spec) {
        return sendError(res, 'spec_invalid', {
          message: 'This app has a problem that must be fixed first.',
          extra: { issues: record.issues },
        });
      }
      const status = await mgr().start({ id: record.id, spec: record.spec, revision: record.revision });
      if (status.state === 'failed') {
        return sendError(res, 'preview_start_failed', { message: 'The preview could not start. Try again.' });
      }
      return res.json({ data: status });
    } catch (err) {
      return sendStudioError(res, err);
    }
  });

  app.get('/api/studio/preview/status', (req, res) => res.json({ data: mgr().status() }));

  app.post('/api/studio/preview/stop', async (req, res) => {
    try {
      return res.json({ data: await mgr().stop() });
    } catch (err) {
      return sendStudioError(res, err);
    }
  });

  app.post('/api/studio/preview/reset', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { appId, confirm } = body;
      if (typeof appId !== 'string' || !UUID_RE.test(appId) || confirm !== 'reset') {
        return badRequest(res, 'Send the app as "appId" and "confirm": "reset".');
      }
      const record = getApp(appId);
      if (!record) return appNotFound(res);
      res.set('Cache-Control', 'no-store');
      try {
        const status = await mgr().resetData({ id: record.id, spec: record.spec, revision: record.revision });
        return res.json({ data: status });
      } catch (err) {
        if (err && err.code === 'preview_reset_failed') {
          return sendError(res, 'preview_reset_failed', { message: 'The preview data could not be reset. Try again.' });
        }
        throw err;
      }
    } catch (err) {
      return sendStudioError(res, err);
    }
  });

  app.use(
    '/api/preview',
    createPreviewProxy({ getTarget: () => mgr().target(), isStarting: () => mgr().status().state === 'starting' }),
  );
}
