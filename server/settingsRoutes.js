// /api/profile and /api/settings/network. Registered after the auth gate in server.js.
import { sendError } from './errors.js';
import { getProfile, setProfile } from './profile.js';
import {
  featureUnavailableBody,
  isFeatureId,
  isFeatureInBuild,
  listNetworkFeatures,
  networkRequiredBody,
  requireNetwork,
  setNetworkFeature,
} from './netPolicy.js';
import { disableCloudAi } from './aiSettingsRoutes.js';
import { checkForUpdate } from './updateCheck.js';
import { sendStorageError } from './storageErrors.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const badRequest = (res, error) => sendError(res, 'invalid_body', { message: error });

/**
 * @param {import('express').Express} app
 */
export function registerSettingsRoutes(app) {
  app.use(['/api/profile', '/api/settings'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/profile', async (req, res) => {
    try {
      res.json(await getProfile());
    } catch (err) {
      sendStorageError(res, err);
    }
  });

  app.put('/api/profile', async (req, res) => {
    const body = req.body;
    if (!isPlainObject(body)) return badRequest(res, 'Body must be a JSON object.');
    const { displayName, onboarded } = body;
    if (displayName !== undefined && displayName !== null && typeof displayName !== 'string') {
      return badRequest(res, 'displayName must be a string or null.');
    }
    if (onboarded !== undefined && onboarded !== true) {
      return badRequest(res, 'onboarded must be true.');
    }
    try {
      res.json(await setProfile({ displayName, onboarded }));
    } catch (err) {
      sendStorageError(res, err);
    }
  });

  app.get('/api/settings/network', async (req, res) => {
    try {
      res.json(await listNetworkFeatures());
    } catch (err) {
      sendStorageError(res, err);
    }
  });

  app.put('/api/settings/network', async (req, res) => {
    const body = req.body;
    if (!isPlainObject(body) || !isFeatureId(body.id) || typeof body.enabled !== 'boolean') {
      return badRequest(res, 'Body must be { "id": a known feature, "enabled": boolean }.');
    }
    if (body.enabled === true && !isFeatureInBuild(body.id)) {
      return sendError(res, 'feature_unavailable', { message: featureUnavailableBody(body.id).message, extra: { feature: body.id } });
    }
    try {
      // Switching cloud AI off here must end the cloud setup the same way the AI disable route does.
      if (body.id === 'cloudAi' && body.enabled === false) await disableCloudAi();
      else await setNetworkFeature(body.id, body.enabled);
      res.json(await listNetworkFeatures());
    } catch (err) {
      sendStorageError(res, err);
    }
  });

  // Upstream failures are a 200 with status 'unavailable' (the repo may be private), never a 5xx.
  app.get('/api/settings/updates/check', requireNetwork('updates'), async (req, res) => {
    try {
      res.json({ data: await checkForUpdate({ refresh: req.query.refresh === '1' }) });
    } catch (err) {
      if (err?.status === 403) {
        return sendError(res, 'network_opt_in_required', { message: networkRequiredBody('updates').message, extra: { feature: 'updates' } });
      }
      return sendError(res, 'update_check_failed', { message: 'Update check failed' });
    }
  });
}
