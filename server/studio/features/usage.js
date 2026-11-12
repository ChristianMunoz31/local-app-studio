// Where each feature is used: by marker in stored app specs, and by Feature nodes inside other features.
// One complete scan per call: every app is read, in batches, because the data import does not cap the app count.
// The scans are iterative and read-only.
import { featureMarkers } from '../../../src/catalog/features/index.ts';
import { select } from '../../db/index.js';

const BATCH = 25;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Feature ids placed through Feature nodes of a fragment. @param {unknown} fragment @returns {Set<string>} */
export function nestedFeatureIds(fragment) {
  const found = new Set();
  const stack = [fragment];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    if (!isPlain(l)) continue;
    if (l.type === 'Feature' && isPlain(l.props) && typeof l.props.featureId === 'string') found.add(l.props.featureId);
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return found;
}

/**
 * @param {Iterable<{ id: string, label: string, fragment: unknown }>} defs every stored feature that could be read
 * @returns {Map<string, { apps: { id: string, name: string }[], features: { id: string, label: string }[] }>}
 */
export function featureUsage(defs) {
  const usage = new Map();
  const entry = (id) => {
    let e = usage.get(id);
    if (!e) {
      e = { apps: [], features: [] };
      usage.set(id, e);
    }
    return e;
  };
  for (let offset = 0; ; offset += BATCH) {
    const rows = select('apps', { columns: ['id', 'name', 'spec'], orderBy: [{ column: 'id', dir: 'asc' }], limit: BATCH, offset });
    for (const row of rows) {
      for (const featureId of featureMarkers(row.spec).keys()) entry(featureId).apps.push({ id: row.id, name: row.name });
    }
    if (rows.length < BATCH) break;
  }
  for (const def of defs) {
    for (const featureId of nestedFeatureIds(def.fragment)) {
      if (featureId !== def.id) entry(featureId).features.push({ id: def.id, label: def.label });
    }
  }
  return usage;
}
