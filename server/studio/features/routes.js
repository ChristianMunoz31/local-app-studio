// Feature library routes (docs: DESIGN-phase6 section 7), under /api/studio behind the Studio guard.
import { ID_RE } from '../../spec/index.js';
import { sendError } from '../../errors.js';
import { badRequest, sendStudioError } from '../http.js';
import { createFeature, deleteFeature, duplicateFeature, getFeature, importFeatureFile, listFeatures, updateFeature } from './store.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const safe = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendStudioError(res, err);
  }
};

const featureNotFound = (res) =>
  sendError(res, 'feature_not_found', { message: 'That feature does not exist. It may have been deleted.' });

/** Validates `:id`; answers 404 itself for a malformed one. */
function withId(req, res, next) {
  if (typeof req.params.id !== 'string' || !ID_RE.test(req.params.id) || req.params.id.length > 31) return featureNotFound(res);
  return next();
}

/** @param {import('express').Express} app */
export function registerFeatureRoutes(app) {
  app.get('/api/studio/features', safe((req, res) => res.json({ data: listFeatures() })));

  app.post(
    '/api/studio/features/import',
    safe((req, res) => {
      if (!isObject(req.body) || req.body.file === undefined) return badRequest(res, 'Send the feature file as "file".');
      return res.status(201).json({ data: importFeatureFile(req.body.file) });
    }),
  );

  app.post(
    '/api/studio/features',
    safe((req, res) => {
      if (!isObject(req.body) || req.body.feature === undefined) return badRequest(res, 'Send the feature as "feature".');
      return res.status(201).json({ data: createFeature(req.body.feature) });
    }),
  );

  app.get(
    '/api/studio/features/:id',
    withId,
    safe((req, res) => {
      const record = getFeature(req.params.id);
      return record ? res.json({ data: record }) : featureNotFound(res);
    }),
  );

  app.put(
    '/api/studio/features/:id',
    withId,
    safe((req, res) => {
      const body = isObject(req.body) ? req.body : {};
      if (body.feature === undefined) return badRequest(res, 'Send the feature as "feature".');
      if (!Number.isSafeInteger(body.baseVersion) || body.baseVersion < 1) return badRequest(res, 'Send the version you started from as "baseVersion".');
      return res.json({ data: updateFeature(req.params.id, body.feature, body.baseVersion) });
    }),
  );

  app.post(
    '/api/studio/features/:id/duplicate',
    withId,
    safe((req, res) => {
      const record = duplicateFeature(req.params.id);
      return record ? res.status(201).json({ data: record }) : featureNotFound(res);
    }),
  );

  app.delete(
    '/api/studio/features/:id',
    withId,
    safe((req, res) => {
      if (!deleteFeature(req.params.id)) return featureNotFound(res);
      return res.json({ data: { id: req.params.id } });
    }),
  );
}
