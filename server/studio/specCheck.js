// The one definition of a valid stored or submitted AppSpec, plus the pure helpers that name and seed an app.
import { APP_NAME_RE, RESERVED_APP_NAMES, isWindowsDeviceName, validateAppSpec } from '../spec/index.js';
import { CATALOG_CHECKS } from '../../src/catalog/validateLayout.ts';
import { expandSpecFeatures, hasFeatureNodes } from '../../src/catalog/features/index.ts';

export const SPEC_SHAPE = Object.freeze({ maxDepth: 80, maxNodes: 150000 });
export const MAX_APPS = 200;
const NAME_MAX = 40;

/**
 * Iterative (no recursion, no stringify) depth and node count check on a raw JSON value.
 * @param {unknown} value
 * @param {{ maxDepth: number, maxNodes: number }} [limits]
 * @returns {string | null} the problem, or null
 */
export function jsonShapeProblem(value, { maxDepth, maxNodes } = SPEC_SHAPE) {
  const stack = [[value, 1]];
  let nodes = 0;
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [node, depth] = item;
    nodes += 1;
    if (nodes > maxNodes) return 'This app has too many values.';
    if (depth > maxDepth) return `Values may nest at most ${maxDepth} levels deep.`;
    if (node === null || typeof node !== 'object') continue;
    for (const child of Array.isArray(node) ? node : Object.values(node)) stack.push([child, depth + 1]);
  }
  return null;
}

/**
 * Shape check, then validateAppSpec with the catalog layout and menu hooks. Never throws.
 * @param {unknown} input
 * @returns {{ ok: true, spec: object, issues: [] } | { ok: false, spec: null, issues: Array<{ path: string, code: string, message: string }> }}
 */
export function checkSpec(input) {
  try {
    const problem = jsonShapeProblem(input);
    if (problem) return { ok: false, spec: null, issues: [{ path: '(root)', code: 'too_complex', message: problem }] };
    const result = validateAppSpec(input, { ...CATALOG_CHECKS });
    return result.ok ? { ok: true, spec: result.value, issues: [] } : { ok: false, spec: null, issues: result.issues };
  } catch {
    return { ok: false, spec: null, issues: [{ path: '(root)', code: 'invalid', message: 'This app could not be checked.' }] };
  }
}

/**
 * Expands Feature layers with the current library, then checkSpec. Never throws. A spec with no Feature layer skips the
 * library read. Specs are stored expanded: an unexpanded Feature layer fails as unknown_part.
 * @param {unknown} input
 * @param {ReadonlyMap<string, object> | (() => ReadonlyMap<string, object>)} library the library, or a function that reads it
 * @returns {ReturnType<typeof checkSpec>}
 */
export function expandAndCheck(input, library) {
  try {
    if (jsonShapeProblem(input) !== null || !hasFeatureNodes(input)) return checkSpec(input);
    const expanded = expandSpecFeatures(input, typeof library === 'function' ? library() : library);
    if (!expanded.ok) return { ok: false, spec: null, issues: expanded.issues };
    return checkSpec(expanded.value);
  } catch {
    return { ok: false, spec: null, issues: [{ path: '(root)', code: 'invalid', message: 'This app could not be checked.' }] };
  }
}

/** @param {unknown} name */
export function isValidAppName(name) {
  return (
    typeof name === 'string' &&
    name === name.trim() &&
    name.length >= 2 &&
    name.length <= NAME_MAX &&
    APP_NAME_RE.test(name) &&
    !RESERVED_APP_NAMES.has(name.toLowerCase()) &&
    !isWindowsDeviceName(name)
  );
}

/** @param {string} name a valid app name (APP_NAME_RE guarantees the result matches SLUG_RE) */
export const deriveSlug = (name) => name.toLowerCase().replaceAll(' ', '-');

/** @param {string} slug */
export const deriveIdentifier = (slug) => `com.example.${slug.replaceAll('-', '')}`;

/** @param {string} name */
export function copyName(name) {
  const full = `${name} Copy`;
  return full.length <= NAME_MAX ? full : `${name.slice(0, NAME_MAX - 5).trimEnd()} Copy`;
}

/**
 * A new app: one home page with a heading.
 * @param {string} name
 * @param {string} slug
 */
export function starterSpec(name, slug) {
  return {
    specVersion: 1,
    app: { name, slug, identifier: deriveIdentifier(slug), version: '1.0.0', description: '', icon: null },
    tables: [],
    pages: [
      {
        id: 'home',
        title: 'Home',
        route: '/',
        sources: [],
        layout: {
          id: 'root_home',
          type: 'Page',
          props: {},
          children: [{ id: 'heading_1', type: 'Heading', props: { size: 'lg' }, children: name }],
        },
      },
    ],
    nav: [{ pageId: 'home', label: 'Home', icon: 'home' }],
    theme: { preset: 'aurora', radius: 'md' },
  };
}
