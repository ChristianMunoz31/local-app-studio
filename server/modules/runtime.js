// The runtime module (what every built app is): the generic data API (/api/data/:table, ADR-004) registered by
// server/runtime/routes.js, with the rate budget fixed in phase 1 so the global 300 per 15 minutes never blocks a CRUD
// screen. The global 2 MB parser covers one record (60 fields of at most 20000 characters); the CSV import route has its own
// 16 MB parser, so its path is listed in `ownBody` and an overflow answers with the 16 MB sentence (no server.js edit).
import { registerRuntimeRoutes } from '@local-app-studio/runtime/server/routes.js';

/** @type {import('./index.js').ServerModule} */
const runtimeModule = {
  id: 'runtime',
  modes: ['runtime'],
  noStorePaths: ['/api/data'],
  limiters: [{ path: '/api/data', windowMs: 15 * 60 * 1000, max: 3000 }],
  aiPostPaths: [],
  ownBody: [
    {
      pattern: /^\/api\/data\/[a-z][a-z0-9_]{0,30}\/import$/,
      methods: ['POST'],
      tooLarge: { message: 'This file is too large to import here. The limit is 16 MB.' },
    },
  ],
  register(app) {
    registerRuntimeRoutes(app);
  },
};

export default runtimeModule;
