// Spec compatibility (ADR-015): which optional spec capabilities an app uses, and whether this version knows all of them.
// Pure and import free like normalizeSpec.js (the server, the sidecar bundle and the browser all load it). It never validates
// shape: that is schema.ts. It only answers "does this design use something newer than I am?".
//
// A feature is an optional capability added after the baseline (a spec with no `features` list). Each one has a stable id that
// reads as its own name in kebab case ("kanban-boards"), so a version that does not know the id can still name it in plain words.
// To add one, add ONE line to SPEC_FEATURES below (docs/APP_SPEC.md, "Spec features"):
//   { id, part }      the feature is the use of a part type (a layer whose `type` is `part`)
//   { id, key }       the feature is a top-level spec key
//   { id, layerKey }  the feature is a key on a layer (a part), beside id, type, props and children
//   { id, part, prop } the feature is a prop of a part (a layer of that type whose `props` holds the key, with any value)

/** @typedef {{ id: string, part?: string, key?: string, layerKey?: string, prop?: string }} SpecFeature */

/**
 * The optional capabilities this version knows, in no particular order. Full text search (ADR-016) is not one: it adds no
 * spec key, part or prop, only indexes the compiler derives.
 * @type {ReadonlyArray<SpecFeature>}
 */
export const SPEC_FEATURES = Object.freeze([
  { id: 'table-inline-edit', part: 'DataTable', prop: 'edit' },
  { id: 'global-search', part: 'GlobalSearch' },
  { id: 'kanban-boards', part: 'Kanban' },
]);

/** The highest `specVersion` this version reads. Kept equal to SPEC_VERSION in schema.ts by specCompat.test.js (this file imports nothing). */
export const SPEC_VERSION_KNOWN = 1;

/** The top-level keys of the baseline spec and the layer keys of the baseline part (schema.ts AppSpecSchema, LayoutLayerSchema). */
export const BASE_SPEC_KEYS = Object.freeze(['specVersion', 'app', 'tables', 'pages', 'nav', 'theme', 'menu', 'features']);
export const BASE_LAYER_KEYS = Object.freeze(['id', 'type', 'name', 'feature', 'sizing', 'grid', 'props', 'children']);

/** Stops the layer walk on a tree far larger than any valid spec (validation reports the size). */
const MAX_LAYERS = 20000;
/** Names listed in a sentence before it says "and N more". */
const MAX_NAMED = 3;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.hasOwn(o, k) && o[k] !== undefined;

/** Every layer of the pages and the menu slots, without recursion. Reads only what is there; never throws. */
function layersOf(spec) {
  const stack = [];
  if (Array.isArray(spec.pages)) for (const page of spec.pages) if (isObject(page) && isObject(page.layout)) stack.push(page.layout);
  if (isObject(spec.menu)) for (const slot of ['start', 'end']) if (Array.isArray(spec.menu[slot])) stack.push(...spec.menu[slot].filter(isObject));
  const out = [];
  for (let layer = stack.pop(); layer !== undefined && out.length < MAX_LAYERS; layer = stack.pop()) {
    out.push(layer);
    if (Array.isArray(layer.children)) for (const child of layer.children) if (isObject(child)) stack.push(child);
  }
  return out;
}

/**
 * The ids of the optional capabilities a spec uses, sorted and without duplicates, so the same design always gives the same list.
 * @param {unknown} spec
 * @param {ReadonlyArray<SpecFeature>} [registry] the capabilities to look for (tests pass their own)
 * @returns {string[]}
 */
export function specFeatures(spec, registry = SPEC_FEATURES) {
  if (!isObject(spec) || registry.length === 0) return [];
  const layers = layersOf(spec);
  const used = new Set();
  for (const f of registry) {
    if (f.key !== undefined && has(spec, f.key)) used.add(f.id);
    if (f.part !== undefined && f.prop !== undefined) {
      if (layers.some((l) => l.type === f.part && isObject(l.props) && has(l.props, f.prop))) used.add(f.id);
    } else if (f.part !== undefined && layers.some((l) => l.type === f.part)) used.add(f.id);
    if (f.layerKey !== undefined && layers.some((l) => has(l, f.layerKey))) used.add(f.id);
  }
  return [...used].sort();
}

/**
 * The spec with its `features` list set to what it uses: absent when it uses none (a baseline spec stays byte for byte as it
 * was), and the same object when the list is already right.
 * @template T
 * @param {T} spec
 * @param {ReadonlyArray<SpecFeature>} [registry]
 * @returns {T}
 */
export function withFeatures(spec, registry = SPEC_FEATURES) {
  if (!isObject(spec)) return spec;
  const wanted = specFeatures(spec, registry);
  const have = Array.isArray(spec.features) ? spec.features : undefined;
  if (wanted.length === 0) {
    if (have === undefined) return spec;
    const rest = { ...spec };
    delete rest.features;
    return /** @type {T} */ (rest);
  }
  if (have !== undefined && have.length === wanted.length && have.every((id, i) => id === wanted[i])) return spec;
  return /** @type {T} */ ({ ...spec, features: wanted });
}

/** "kanban-boards" is shown as "Kanban boards". */
export function featureLabel(id) {
  const words = String(id).replaceAll('-', ' ').trim();
  return words === '' ? 'a newer feature' : `${words[0].toUpperCase()}${words.slice(1)}`;
}

const quote = (name) => `"${String(name).slice(0, 40)}"`;

function listOf(names) {
  if (names.length > MAX_NAMED) return `${names.slice(0, MAX_NAMED).join(', ')} and ${names.length - MAX_NAMED} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}

/**
 * Whether the design says it needs a newer version, on positive evidence only: a `features` id this version does not know, or a
 * `specVersion` above SPEC_VERSION_KNOWN. Reads the raw design (before schema parsing), so a newer feature is named instead of
 * being reported as a shape error. Never throws.
 *
 * An unknown top-level or layer key alone is NOT evidence: in Studio it is a typo or a hand edit, and the schema reports it as
 * `unrecognized_keys` with its path. `unknownKeys: true` adds that check, for a reader that runs no schema (server/spec/source.js:
 * a built app would otherwise open a design with a key nothing validated).
 * @param {unknown} spec
 * @param {ReadonlyArray<SpecFeature>} [registry] the capabilities this version knows (tests pass their own)
 * `version: false` skips the `specVersion` evidence, for a reader whose own shape check already refuses another version
 * (source.js: `app_spec_invalid`, pinned by source.test.js).
 * @param {{ unknownKeys?: boolean, version?: boolean }} [opts]
 * @returns {{ newer: string[], sentence: string } | null} `newer` lists the names (sorted), `sentence` is the plain refusal
 */
export function specCompatProblem(spec, registry = SPEC_FEATURES, { unknownKeys = false, version = true } = {}) {
  if (!isObject(spec)) return null;
  const knownIds = new Set(registry.map((f) => f.id));
  const newer = new Set();
  let newerVersion = false;
  if (version && typeof spec.specVersion === 'number' && spec.specVersion > SPEC_VERSION_KNOWN) {
    newerVersion = true;
    newer.add(`Spec version ${spec.specVersion}`);
  }
  if (Array.isArray(spec.features)) {
    for (const id of spec.features) if (typeof id !== 'string' || !knownIds.has(id)) newer.add(featureLabel(id));
  }
  if (unknownKeys) {
    const knownKeys = new Set([...BASE_SPEC_KEYS, ...registry.flatMap((f) => (f.key === undefined ? [] : [f.key]))]);
    const knownLayerKeys = new Set([...BASE_LAYER_KEYS, ...registry.flatMap((f) => (f.layerKey === undefined ? [] : [f.layerKey]))]);
    for (const key of Object.keys(spec)) if (!knownKeys.has(key)) newer.add(quote(key));
    for (const layer of layersOf(spec)) for (const key of Object.keys(layer)) if (!knownLayerKeys.has(key)) newer.add(quote(key));
  }
  if (newer.size === 0) return null;
  const names = [...newer].sort();
  const sentence = newerVersion ? 'This app was made by a newer version of Local App Studio.' : `This app uses ${listOf(names)}, which this version does not know.`;
  return { newer: names, sentence };
}
