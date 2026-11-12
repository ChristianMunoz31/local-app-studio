import { describe, expect, it } from 'vitest';
import { SEED_FEATURES, validateFeatureInput } from '@/catalog/features';
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { ERROR_COPY } from '@/errors/errorCopy.js';
import { builderRefusal, builderRefusalWords, refusalWords } from '../featureRefusal';
import { layer, seedLibrary } from './benchFixtures';

const issue = (path: string, code: string, message = 'developer words about the fragment and a binding'): SpecIssue => ({ path, code, message });

describe('builderRefusal', () => {
  it.each([
    [issue('label', 'invalid_feature'), 'feature_name_needed'],
    [issue('description', 'invalid_feature'), 'feature_line_needed'],
    [issue('params', 'invalid_feature'), 'feature_too_many_settings'],
    [issue('fragment', 'fragment_too_large'), 'feature_too_big'],
    [issue('fragment', 'feature_too_deep'), 'feature_too_big'],
    [issue('fragment', 'feature_cycle'), 'feature_holds_itself'],
    [issue('pages.2.layout.children.0.props.source', 'unbound_slot'), 'feature_needs_slots'],
    [issue('fragment', 'invalid_fragment'), 'feature_check_failed'],
    [issue('bindings.0', 'invalid_binding'), 'feature_check_failed'],
  ] as const)('maps %j to %s', (one, code) => {
    expect(builderRefusal([one])).toBe(code);
  });

  it('picks the problem a person can fix first when there are several', () => {
    expect(builderRefusal([issue('fragment', 'invalid_fragment'), issue('label', 'invalid_feature')])).toBe('feature_name_needed');
    expect(builderRefusal([])).toBe('feature_check_failed');
  });

  it('maps what the validator really says about a damaged record', () => {
    const library = seedLibrary();
    const bad = validateFeatureInput(
      { id: 'x', label: '', description: 'Says.', params: [], fragment: layer('f', 'Section'), bindings: [] },
      library,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(builderRefusal(bad.issues)).toBe('feature_name_needed');
    const seed = SEED_FEATURES[0];
    const stray = validateFeatureInput({ id: 'y', label: 'Y', description: 'Y.', params: [], fragment: seed.fragment, bindings: [] }, library);
    expect(stray.ok).toBe(false);
    if (!stray.ok) expect(builderRefusal(stray.issues)).toBe('feature_needs_slots');
  });
});

describe('words', () => {
  it('give the sentence and the action of the row', () => {
    expect(refusalWords('feature_name_needed')).toEqual({ sentence: 'Give the feature a name.', action: 'Type a name, then press Save feature.' });
  });

  it('are the unique plain sentences of every issue, with no path, id or developer word', () => {
    const words = builderRefusalWords([issue('fragment', 'invalid_fragment', 'fragment x'), issue('fragment.children.0', 'invalid_binding', 'binding y'), issue('label', 'invalid_feature')]);
    expect(words).toEqual(['This feature did not work with sample rows.', 'Give the feature a name.']);
    for (const w of words) expect(w).not.toMatch(/fragment|binding|path|\bid\b|slot_/i);
  });

  it('has a client-only row for each of the eight codes', () => {
    for (const code of ['feature_name_needed', 'feature_line_needed', 'feature_is_empty', 'feature_needs_slots', 'feature_too_many_settings', 'feature_too_big', 'feature_holds_itself', 'feature_check_failed']) {
      expect(ERROR_COPY[code]).toMatchObject({ status: 0, clientOnly: true });
      expect(ERROR_COPY[code].sentence).toBeTruthy();
      expect(ERROR_COPY[code].action).toBeTruthy();
    }
  });
});
