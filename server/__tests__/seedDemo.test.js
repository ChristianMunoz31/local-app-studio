import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDemo } from '../../scripts/seedDemo.js';
import { insert, select } from '../db/index.js';
import { closeTestDb, createTestDb } from './helpers/testDb.js';

const NOW = new Date(2026, 5, 15, 10, 0, 0);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

describe('seedDemo', () => {
  let db;
  let result;

  beforeEach(async () => {
    db = createTestDb();
    result = await seedDemo({ insert, now: NOW });
  });
  afterEach(() => closeTestDb(db));

  it('fills studio_features with the two demo features and the profile, and reports what it wrote', () => {
    expect(result.counts.studio_features).toBe(2);
    expect(select('studio_features').map((f) => f.id).sort()).toEqual(['kpi_row', 'search_list']);
    expect(result.counts.app_state).toBe(1);
  });

  it('seeds the profile name and onboarding marker', () => {
    const state = Object.fromEntries(select('app_state').map((r) => [r.key, r.value]));
    expect(state.profile.displayName).toBe('Demo');
    expect(typeof state.profile.onboardedAt).toBe('string');
  });

  it('stores valid feature bodies the store can read back', () => {
    for (const f of select('studio_features')) {
      expect(f.version).toBe(1);
      expect(Array.isArray(f.body.params)).toBe(true);
      expect(Array.isArray(f.body.bindings)).toBe(true);
      expect(f.body.fragment.id).toBeTypeOf('string');
    }
  });

  it('never writes a timestamp after now', () => {
    for (const f of select('studio_features')) {
      expect(Date.parse(f.created_at) <= NOW.getTime()).toBe(true);
      expect(Date.parse(f.updated_at) <= NOW.getTime()).toBe(true);
    }
  });

  it('is deterministic for a fixed now', async () => {
    const snapshot = () => select('studio_features').map((f) => [f.id, f.created_at, f.body]);
    const first = snapshot();
    closeTestDb(db);
    db = createTestDb();
    await seedDemo({ insert, now: NOW });
    expect(snapshot()).toEqual(first);
  });

  it('contains no emails or em dashes', () => {
    const text = JSON.stringify([select('studio_features'), select('app_state')]);
    expect(text).not.toMatch(EMAIL_RE);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
