// The server module registry (docs/OWNERSHIP.md). server.js reads module descriptors instead of being edited per module:
// each module owns its routes, rate budgets, no-store paths and lifecycle hooks. Only modules whose `modes` include the
// running app mode are active, so Studio routes do not exist in a runtime build (and the Studio seam file is a stub there).
import { getAppMode } from '../appMode.js';
import { limiterHandler } from '../errors.js';
import runtimeModule from './runtime.js';
import studioModule from './studio.js';

/** @typedef {{
 *   id: 'runtime' | 'studio',
 *   modes: Array<'studio' | 'runtime'>,
 *   noStorePaths: string[],
 *   limiters: Array<{ path: string, windowMs: number, max: number }>,
 *   aiPostPaths: string[],
 *   ownBody?: Array<{ path?: string, pattern?: RegExp, methods?: string[], tooLarge: object }>,
 *   register: (app: import('express').Express, ctx: { authEnabled: boolean }) => void,
 *   onStart?: () => void | Promise<void>,
 *   onStop?: () => void | Promise<void>,
 * }} ServerModule */

/** @type {ReadonlyArray<ServerModule>} */
export const SERVER_MODULES = Object.freeze([runtimeModule, studioModule]);

/**
 * The modules that belong to a mode.
 * @param {'studio' | 'runtime'} [mode]
 * @returns {ServerModule[]}
 */
export const activeServerModules = (mode = getAppMode()) => SERVER_MODULES.filter((m) => m.modes.includes(mode));

/** Paths whose responses must never be cached, from the active modules. */
export const moduleNoStorePaths = () => activeServerModules().flatMap((m) => m.noStorePaths);

const normalize = (p) => p.toLowerCase().replace(/\/+$/, '');

/**
 * True when the request falls under an active module's own rate budget, so the global limiter must skip it.
 * Compares `req.baseUrl + req.path` lowercased with trailing slashes dropped, on whole path segments.
 * @param {{ baseUrl?: string, path?: string }} req
 * @param {'studio' | 'runtime'} [mode]
 * @returns {boolean}
 */
export function isModuleBudgetPath(req, mode = getAppMode()) {
  const path = normalize(`${req.baseUrl ?? ''}${req.path ?? ''}`);
  return activeServerModules(mode).some((m) =>
    m.limiters.some((l) => {
      const prefix = normalize(l.path);
      return path === prefix || path.startsWith(`${prefix}/`);
    }),
  );
}

/**
 * The active module's own body-parser entry for a request path, or null. A route listed in a module's `ownBody` applies its
 * own JSON limit, so the global 2 MB parser skips it, and `tooLarge` is the 413 body the error handler sends for it.
 * An entry names its route by an exact `path` or by a `pattern` tested on the normalized path (a per-table route), and may
 * name `methods`: without it every method matches, so a per-table pattern must (a PATCH to a record whose id is "import" keeps its parser).
 * @param {{ path?: string, method?: string }} req
 * @param {'studio' | 'runtime'} [mode]
 * @returns {{ path?: string, pattern?: RegExp, methods?: string[], tooLarge: object } | null}
 */
export function moduleOwnBody(req, mode = getAppMode()) {
  const path = normalize(req.path ?? '');
  for (const m of activeServerModules(mode)) {
    const hit = (m.ownBody ?? []).find(
      (b) => (!b.methods || b.methods.includes(String(req.method ?? '').toUpperCase())) && (b.pattern ? b.pattern.test(path) : normalize(b.path ?? '') === path),
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * One express-rate-limit per module entry, right after the global limiter.
 * @param {import('express').Express} app
 * @param {(opts: object) => import('express').RequestHandler} rateLimit express-rate-limit's factory
 */
export function mountModuleLimiters(app, rateLimit) {
  for (const m of activeServerModules()) {
    for (const l of m.limiters) {
      app.use(
        l.path,
        rateLimit({
          windowMs: l.windowMs,
          max: l.max,
          standardHeaders: true,
          legacyHeaders: false,
          handler: limiterHandler({ message: 'Too many requests, please try again later.' }),
        }),
      );
    }
  }
}

/**
 * The AI POSTs of the active modules spend the strict AI budget.
 * @param {import('express').Express} app
 * @param {(path: string) => import('express').RequestHandler} wrap builds the handler for one path (server.js: postLimiter(strictLimiter))
 */
export function mountModuleAiLimiters(app, wrap) {
  for (const m of activeServerModules()) for (const p of m.aiPostPaths) app.use(p, wrap(p));
}

/**
 * @param {import('express').Express} app
 * @param {{ authEnabled: boolean }} ctx
 */
export function registerServerModules(app, ctx) {
  for (const m of activeServerModules()) m.register(app, ctx);
}

/** Runs every active module's `onStart` after the server listens. A failing hook is logged (code only) and does not stop the rest. */
export async function startServerModules() {
  for (const m of activeServerModules()) {
    try {
      await m.onStart?.();
    } catch (err) {
      console.error(`Module ${m.id} failed to start:`, err?.code || err?.name || 'unknown');
    }
  }
}

/** Runs every active module's `onStop` in stop(), before the database closes. A failing hook is logged and does not stop the rest. */
export async function stopServerModules() {
  for (const m of activeServerModules()) {
    try {
      await m.onStop?.();
    } catch (err) {
      console.error(`Module ${m.id} failed to stop:`, err?.code || err?.name || 'unknown');
    }
  }
}
