// Route matching for the pages of a spec. Pure: no React, no router. A page route is "/", "/crews" or "/crews/:id"
// (`:id` is one non-empty segment). Used by SpecApp (match the current path) and the runtime module (the route list).

const segmentsOf = (path) => path.split('/').filter((s) => s !== '');

/**
 * Base path as "/" or "/x/y": a leading slash, no trailing slash.
 * @param {string | undefined} basePath
 * @returns {string}
 */
export function normalizeBase(basePath) {
  const segments = segmentsOf(basePath ?? '/');
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * Joins a base path and a route ("/" and "/about" give "/about"; "/app" and "/" give "/app").
 * @param {string | undefined} basePath
 * @param {string} route
 * @returns {string}
 */
export function joinPath(basePath, route) {
  const base = normalizeBase(basePath);
  const rest = segmentsOf(route).join('/');
  if (base === '/') return `/${rest}`;
  return rest === '' ? base : `${base}/${rest}`;
}

/**
 * The path below the base path, or null when `pathname` is outside it.
 * @param {string | undefined} basePath
 * @param {string} pathname
 * @returns {string | null}
 */
export function stripBase(basePath, pathname) {
  const base = segmentsOf(normalizeBase(basePath));
  const parts = segmentsOf(pathname);
  if (parts.length < base.length) return null;
  for (let i = 0; i < base.length; i += 1) if (parts[i] !== base[i]) return null;
  return `/${parts.slice(base.length).join('/')}`;
}

const isParam = (segment) => segment.startsWith(':');

function matchRoute(route, parts) {
  const pattern = segmentsOf(route);
  if (pattern.length !== parts.length) return null;
  let recordId = null;
  for (let i = 0; i < pattern.length; i += 1) {
    if (isParam(pattern[i])) {
      try {
        recordId = decodeURIComponent(parts[i]);
      } catch {
        return null;
      }
    } else if (pattern[i] !== parts[i]) {
      return null;
    }
  }
  return { recordId };
}

/**
 * The page a path belongs to. A route without a parameter wins over one with `:id`.
 * @param {{ pages?: Array<{ id: string, route: string }> } | null | undefined} spec
 * @param {string} path Path below the base path.
 * @returns {{ pageId: string, recordId: string | null } | null}
 */
export function matchSpecRoute(spec, path) {
  const parts = segmentsOf(path);
  let withParam = null;
  for (const page of spec?.pages ?? []) {
    const hit = matchRoute(page.route, parts);
    if (!hit) continue;
    if (hit.recordId === null) return { pageId: page.id, recordId: null };
    withParam ??= { pageId: page.id, recordId: hit.recordId };
  }
  return withParam;
}

/**
 * The route of a page ("/crews/:id" with a record id becomes "/crews/<id>"), or null when the page is unknown or needs
 * a record that was not given.
 * @param {{ pages?: Array<{ id: string, route: string }> } | null | undefined} spec
 * @param {string} pageId
 * @param {string | null | undefined} [recordId]
 * @returns {string | null}
 */
export function routeFor(spec, pageId, recordId = null) {
  const page = spec?.pages?.find((p) => p.id === pageId);
  if (!page) return null;
  const segments = segmentsOf(page.route);
  if (segments.some(isParam) && !recordId) return null;
  return `/${segments.map((s) => (isParam(s) ? encodeURIComponent(recordId) : s)).join('/')}`;
}

/** True for a route that holds a `:id` parameter (not linkable from a menu). */
export const routeHasParam = (route) => segmentsOf(route).some(isParam);
