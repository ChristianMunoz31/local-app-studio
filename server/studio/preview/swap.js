// The Preview hot swap (ADR-019): which saved changes the running Preview child can take without a restart.
//
// The Preview frame draws the app in Studio from Studio's own spec (PreviewTab renders SpecApp); the child only answers the
// data API behind the proxy allowlist (proxy.js, ['/data']). It reads its spec once, at start (server/spec/source.js caches
// it), so it needs a restart whenever something it reads changed.
//
// The view is built the safe way round: everything in the spec counts, except the parts named in STUDIO_ONLY below, which
// only Studio draws. A new spec key, page key or compiled output therefore lands in the view by itself and restarts the child;
// only a part someone names here as Studio-only can ever be skipped. The child reads layouts and the menu in exactly two ways,
// and both are covered:
// - the start check (acceptSpec: normalize, refuse what is newer, check the shape; it walks every layer's keys). childView
//   runs the same function and gives null when it throws, so a spec the child would refuse is never swapped in;
// - compileSpec, whose whole output (tables, validators, title fields, foreign keys, createSql, the derived indexSql of
//   ADR-014 that reads sort, filter, picker and chart props, and the full text ftsSql of ADR-016) is in the view.
// previewChildView.test.js records what the child's routes read and fails when a read falls outside the view.
import crypto from 'node:crypto';
import { compileSpec } from '../../spec/compile.js';
import { acceptSpec } from '../../spec/source.js';

/**
 * The spec parts the preview child never reads apart from the two ways above: top-level keys, and keys of each page.
 * Adding a name here is a claim about the runtime server; previewChildView.test.js checks it.
 */
export const STUDIO_ONLY = Object.freeze({
  spec: Object.freeze(['theme', 'nav', 'menu']),
  page: Object.freeze(['title', 'layout']),
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON with sorted keys and undefined dropped (the same shape scratch.js hashes). */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const parts = Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

/**
 * The part of a spec the preview child reads: the accepted spec without the Studio-only parts, plus the compiled spec.
 * @param {object} spec a checked spec
 * @returns {object} throws when the child would refuse the spec
 */
export function childViewOf(spec) {
  const accepted = acceptSpec(spec);
  if (!isObject(accepted)) throw new TypeError('no spec');
  const view = without(accepted, STUDIO_ONLY.spec);
  if (Array.isArray(accepted.pages)) view.pages = accepted.pages.map((p) => (isObject(p) ? without(p, STUDIO_ONLY.page) : p));
  view.compiled = compileSpec(accepted);
  return view;
}

/**
 * A hash of everything the preview child reads from a spec, or null when it cannot be worked out (the caller then restarts).
 * @param {object} spec a checked spec
 * @returns {string | null}
 */
export function childView(spec) {
  try {
    return crypto.createHash('sha256').update(stableJson(childViewOf(spec))).digest('hex');
  } catch {
    return null;
  }
}
