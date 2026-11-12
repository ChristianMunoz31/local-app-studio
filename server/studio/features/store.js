// Feature library storage: every read re-validates the stored body, every write validates with validateFeatureInput.
// All database access goes through server/db/index.js (query.js); no SQL is built here.
import { createHash } from 'node:crypto';
import { FEATURE_LIMITS, validateFeatureInput } from '../../../src/catalog/features/index.ts';
import { insert, nowIso, remove, select, update, withTransaction } from '../../db/index.js';
import { StudioError } from '../apps.js';
import { featureUsage, nestedFeatureIds } from './usage.js';

const COLUMNS = ['id', 'label', 'description', 'version', 'body', 'created_at', 'updated_at'];
const FORMAT = 'local-app-studio-feature';
const IMPORT_MAX_CHARS = 262144;
const ID_MAX = 31;
const LABEL_MAX = 40;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const notFound = () => new StudioError('feature_not_found', 404, 'That feature does not exist. It may have been deleted.');
const tooMany = () => new StudioError('too_many_features', 409, `You can keep up to ${FEATURE_LIMITS.library} features. Delete one first.`);
const invalidFeature = (issues) => new StudioError('invalid_feature', 400, issues[0]?.message ?? 'The feature is not valid.', { issues });
const invalidFile = (issues) => new StudioError('invalid_feature_file', 400, issues[0]?.message ?? 'That file is not a feature file.', { issues });
const unreadable = () => [{ path: 'body', code: 'invalid_feature', message: 'This feature could not be read.' }];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** JSON with sorted object keys, for equality. @param {unknown} v @returns {string} */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isPlain(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const bodyKey = (b) => stableStringify({ params: b.params, fragment: b.fragment, bindings: b.bindings });

/** A stored row as a definition when its body has the right shape, else null. */
function parseRow(row) {
  const b = row.body;
  if (!isPlain(b) || !Array.isArray(b.params) || !Array.isArray(b.bindings) || !isPlain(b.fragment)) return null;
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    version: row.version,
    updatedAt: row.updated_at,
    params: b.params,
    fragment: b.fragment,
    bindings: b.bindings,
  };
}

const asInput = (d) => ({ id: d.id, label: d.label, description: d.description, params: d.params, fragment: d.fragment, bindings: d.bindings });

const CHECK_FAILED = [{ path: 'body', code: 'invalid_feature', message: 'This feature could not be checked.' }];

/** Validation outcome per (id, version, updated_at, content, library fingerprint). Cleared when it grows past the cap. */
const checkCache = new Map();
const CACHE_MAX = 4000;

/** Identity of a stored row: changes whenever the row's version, timestamp or content does. */
function rowKey(row) {
  const content = createHash('sha1').update(JSON.stringify([row.label, row.description, row.body])).digest('hex');
  return `${row.id}|${row.version}|${row.updated_at}|${content}`;
}

/** The keys of every feature this one nests, directly or not (a missing one counts too): all its check depends on. */
function fingerprintOf(def, live) {
  const seen = new Set([def.id]);
  const parts = [];
  const stack = [def];
  for (let d = stack.pop(); d !== undefined; d = stack.pop()) {
    for (const id of nestedFeatureIds(d.fragment)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const e = live.get(id);
      if (e === undefined) parts.push(`missing:${id}`);
      else {
        parts.push(e.key);
        stack.push(e.def);
      }
    }
  }
  return parts.sort().join('\n');
}

function checkOne(def, key, lib, fingerprint) {
  const cacheKey = `${key}#${fingerprint}`;
  const hit = checkCache.get(cacheKey);
  if (hit) return hit;
  let result;
  try {
    result = validateFeatureInput(asInput(def), lib, { replacingId: def.id });
  } catch {
    result = { ok: false, issues: CHECK_FAILED };
  }
  const outcome = { ok: result.ok, issues: result.ok ? [] : result.issues };
  if (checkCache.size >= CACHE_MAX) checkCache.clear();
  checkCache.set(cacheKey, outcome);
  return outcome;
}

/**
 * Every stored row with its validation outcome. A feature is checked against the features that are ok, repeated until
 * nothing changes, so a feature that nests an invalid one is reported not ok too. Results are cached per feature.
 */
function readAll() {
  const rows = select('studio_features', { columns: COLUMNS, orderBy: [{ column: 'updated_at', dir: 'desc' }] });
  const entries = rows.map((row) => ({ row, def: parseRow(row), key: rowKey(row) }));
  const live = new Map(entries.filter((e) => e.def !== null).map((e) => [e.def.id, e]));
  const failed = new Map();
  for (let changed = true; changed; ) {
    const lib = new Map([...live].map(([id, e]) => [id, e.def]));
    const dropped = [];
    for (const [id, e] of live) {
      const outcome = checkOne(e.def, e.key, lib, fingerprintOf(e.def, live));
      if (!outcome.ok) {
        failed.set(id, outcome.issues);
        dropped.push(id);
      }
    }
    for (const id of dropped) live.delete(id);
    changed = dropped.length > 0;
  }
  return entries.map(({ row, def }) => {
    if (def === null) return { row, def: null, ok: false, issues: unreadable() };
    return live.has(def.id) ? { row, def, ok: true, issues: [] } : { row, def, ok: false, issues: failed.get(def.id) };
  });
}

function toRecord({ row, def, ok, issues }, usage) {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    version: row.version,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    params: def?.params ?? [],
    fragment: def?.fragment ?? null,
    bindings: def?.bindings ?? [],
    ok,
    issues,
    usedBy: usage.get(row.id) ?? { apps: [], features: [] },
  };
}

const usageOf = (all) => featureUsage(all.filter((a) => a.def !== null).map((a) => a.def));
/** The features that validate: what new or edited features may nest. */
const libOf = (all) => new Map(all.filter((a) => a.ok).map((a) => [a.def.id, a.def]));
const idsOf = (all) => new Set(all.map((a) => a.row.id));

/** @returns {object[]} FeatureRecord, newest first, at most 100 */
export function listFeatures() {
  const all = readAll();
  const usage = usageOf(all);
  return all.slice(0, FEATURE_LIMITS.library).map((a) => toRecord(a, usage));
}

/** @param {string} id @returns {object | null} */
export function getFeature(id) {
  const all = readAll();
  const found = all.find((a) => a.row.id === id);
  return found ? toRecord(found, usageOf(all)) : null;
}

/** The features that still validate, for expansion (Describe, app save). @returns {Map<string, object>} */
export function loadLibrary() {
  return libOf(readAll());
}

/**
 * The Assistant's read: saved features with counts computed in code.
 * @param {{ query?: string }} [opts] matched case-insensitively in JS against name and description
 * @returns {{ features: object[], total: number }}
 */
export function listFeatureSummaries({ query } = {}) {
  const all = readAll();
  const usage = usageOf(all);
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const features = all
    .filter((a) => a.ok)
    .filter((a) => needle === '' || `${a.row.label} ${a.row.description}`.toLowerCase().includes(needle))
    .map((a) => ({
      id: a.row.id,
      name: a.row.label,
      description: a.row.description,
      version: a.row.version,
      settings: a.def.params.map((p) => ({ name: p.name, label: p.label, type: p.type })),
      usedByApps: usage.get(a.row.id)?.apps.length ?? 0,
    }));
  return { features: features.slice(0, 50), total: features.length };
}

function checked(input, lib, replacingId) {
  const result = validateFeatureInput(input, lib, replacingId === undefined ? {} : { replacingId });
  if (!result.ok) throw invalidFeature(result.issues);
  return result.value;
}

const toRow = (v) => ({ id: v.id, label: v.label, description: v.description, body: { params: v.params, fragment: v.fragment, bindings: v.bindings } });

/** The record of a feature just written, from the set already loaded (no second validation pass). */
function writtenRecord(all, row) {
  const entry = { row, def: parseRow(row), ok: true, issues: [] };
  return toRecord(entry, usageOf([...all.filter((a) => a.row.id !== row.id), entry]));
}

/** @param {unknown} input a FeatureInput */
export function createFeature(input) {
  return withTransaction(() => {
    const all = readAll();
    const value = checked(input, libOf(all));
    if (idsOf(all).has(value.id)) {
      throw new StudioError('feature_id_taken', 409, 'A feature with that name already exists. Pick another name.');
    }
    if (all.length >= FEATURE_LIMITS.library) throw tooMany();
    return writtenRecord(all, insert('studio_features', { ...toRow(value), version: 1 }));
  });
}

/**
 * Version goes up only when params, fragment or bindings change.
 * @param {string} id
 * @param {unknown} input a FeatureInput
 * @param {number} baseVersion
 */
export function updateFeature(id, input, baseVersion) {
  return withTransaction(() => {
    const all = readAll();
    const existing = all.find((a) => a.row.id === id)?.row;
    if (!existing) throw notFound();
    if (!isPlain(input) || input.id !== id) {
      throw new StudioError('invalid_request', 400, 'The feature id in the body must match the address.');
    }
    if (existing.version !== baseVersion) {
      throw new StudioError('version_conflict', 409, 'This feature changed in another window. Reload it and try again.', { version: existing.version });
    }
    const value = checked(input, libOf(all), id);
    const old = parseRow(existing);
    const changed = old === null || bodyKey(old) !== bodyKey(value);
    const rows = update(
      'studio_features',
      { label: value.label, description: value.description, body: toRow(value).body, version: changed ? baseVersion + 1 : baseVersion, updated_at: nowIso() },
      { where: { id, version: baseVersion } },
    );
    if (rows.length === 0) throw notFound();
    return writtenRecord(all, rows[0]);
  });
}

/** First free `<base>_copy`, `<base>_copy_2` ..., cut so the id stays within 31 characters. */
function copyId(base, taken) {
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? '_copy' : `_copy_${n}`;
    const candidate = `${base.slice(0, ID_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** @param {string} id @returns {object | null} null when the feature does not exist */
export function duplicateFeature(id) {
  return withTransaction(() => {
    const all = readAll();
    const existing = all.find((a) => a.row.id === id)?.row;
    if (!existing) return null;
    if (all.length >= FEATURE_LIMITS.library) throw tooMany();
    const def = parseRow(existing);
    if (def === null) throw invalidFeature(unreadable());
    const label = `${def.label} copy`.slice(0, LABEL_MAX).trimEnd();
    const value = checked({ ...asInput(def), id: copyId(id, idsOf(all)), label }, libOf(all));
    return writtenRecord(all, insert('studio_features', { ...toRow(value), version: 1 }));
  });
}

/** Refused with 409 feature_in_use while an app or another feature uses it. @param {string} id @returns {boolean} false when missing */
export function deleteFeature(id) {
  return withTransaction(() => {
    const all = readAll();
    if (!all.some((a) => a.row.id === id)) return false;
    const used = usageOf(all).get(id) ?? { apps: [], features: [] };
    if (used.apps.length > 0 || used.features.length > 0) {
      const parts = [];
      if (used.apps.length > 0) parts.push(`${plural(used.apps.length, 'app', 'apps')}: ${used.apps.map((a) => a.name).join(', ')}`);
      if (used.features.length > 0) parts.push(`${plural(used.features.length, 'feature', 'features')}: ${used.features.map((f) => f.label).join(', ')}`);
      throw new StudioError('feature_in_use', 409, `This feature is used by ${parts.join(' and by ')}. Remove or detach it there first.`, used);
    }
    return remove('studio_features', { where: { id } }) > 0;
  });
}

/** Points Feature nodes at renamed features, on a private copy. */
function rewriteNodes(entry, renames) {
  if (renames.size === 0 || !isPlain(entry) || !isPlain(entry.fragment)) return entry;
  const copy = structuredClone(entry);
  const stack = [copy.fragment];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    if (!isPlain(l)) continue;
    if (l.type === 'Feature' && isPlain(l.props) && typeof l.props.featureId === 'string' && renames.has(l.props.featureId)) {
      l.props.featureId = renames.get(l.props.featureId);
    }
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return copy;
}

function importId(base, taken) {
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, ID_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Imports a feature file { format, formatVersion, feature, includes }. All or nothing, in one transaction. Same id and
 * identical body reuses the stored feature; same id and a different body takes the first free `<id>_2`, `_3` ...
 * @param {unknown} file
 * @returns {{ imported: object[], renamed: { from: string, to: string }[] }}
 */
export function importFeatureFile(file) {
  let size = Infinity;
  try {
    size = JSON.stringify(file)?.length ?? Infinity;
  } catch {
    // not plain JSON
  }
  if (size > IMPORT_MAX_CHARS) throw invalidFile([{ path: '', code: 'invalid_feature_file', message: 'That file is too large to be a feature file.' }]);
  if (!isPlain(file) || file.format !== FORMAT || file.formatVersion !== 1 || !isPlain(file.feature) || (file.includes !== undefined && !Array.isArray(file.includes))) {
    throw invalidFile([{ path: '', code: 'invalid_feature_file', message: 'That is not a Local App Studio feature file.' }]);
  }
  const includes = file.includes ?? [];
  if (includes.length > FEATURE_LIMITS.library) throw tooMany();
  return withTransaction(() => {
    const loaded = readAll();
    const lib = libOf(loaded);
    const defs = new Map(loaded.filter((a) => a.def !== null).map((a) => [a.def.id, a.def]));
    const taken = idsOf(loaded);
    const renames = new Map();
    const renamed = [];
    const resolved = [];
    let stored = loaded.length;
    for (const raw of [...includes, file.feature]) {
      const entry = rewriteNodes(raw, renames);
      const id = isPlain(entry) && typeof entry.id === 'string' ? entry.id : null;
      const current = id === null ? undefined : defs.get(id);
      if (current !== undefined && bodyKey(current) === bodyKey(entry)) {
        resolved.push(id);
        continue;
      }
      let target = entry;
      if (id !== null && taken.has(id)) {
        const to = importId(id, taken);
        renames.set(id, to);
        renamed.push({ from: id, to });
        target = { ...entry, id: to };
      }
      let result;
      try {
        result = validateFeatureInput(target, lib);
      } catch {
        result = { ok: false, issues: [{ path: '', code: 'invalid_feature', message: 'A feature in the file could not be checked.' }] };
      }
      if (!result.ok) throw invalidFile(result.issues);
      if (stored >= FEATURE_LIMITS.library) throw tooMany();
      insert('studio_features', { ...toRow(result.value), version: 1 });
      stored += 1;
      const stamped = { ...result.value, version: 1, updatedAt: nowIso() };
      lib.set(result.value.id, stamped);
      defs.set(result.value.id, stamped);
      taken.add(result.value.id);
      resolved.push(result.value.id);
    }
    const all = readAll();
    const usage = usageOf(all);
    const imported = resolved.map((rid) => toRecord(all.find((a) => a.row.id === rid), usage));
    return { imported, renamed };
  });
}
