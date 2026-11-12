// GET /api/app/info: version, channel and desktop flag for the UI (Dev build badge).
import { isCloudAiInBuild } from './buildFeatures.js';
import { getChannel } from './channel.js';
import { getAppVersion, isDesktopMode } from './runtime.js';

/** @param {import('express').Express} app */
export function registerAppInfoRoutes(app) {
  app.get('/api/app/info', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: { version: getAppVersion(), channel: getChannel(), desktop: isDesktopMode(), cloudAi: isCloudAiInBuild() ? 'present' : 'absent' } });
  });
}
