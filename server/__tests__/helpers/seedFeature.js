// Saves one valid feature through the real store, for tests that need list_features to return data.
// The caller owns the database (createTestDb / resetDb); this only writes a row through createFeature.
import { SEED_FEATURES } from '../../../src/catalog/features/index.ts';
import { createFeature } from '../../studio/features/store.js';

/**
 * @param {{ id?: string, label?: string, description?: string }} [over] fields to replace on the kpi_row seed
 * @returns {object} the saved feature
 */
export function seedFeature(over = {}) {
  const base = structuredClone(SEED_FEATURES.find((f) => f.id === 'kpi_row'));
  delete base.version;
  delete base.updatedAt;
  return createFeature({ ...base, ...over });
}
