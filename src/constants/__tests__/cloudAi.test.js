import { describe, expect, it } from 'vitest';
import {
  CLOUD_CATEGORY_DEFAULTS,
  CLOUD_CATEGORY_IDS,
  CLOUD_CATEGORY_LABELS,
  CLOUD_CONSENT_ACKS,
  CLOUD_CONSENT_VERSION,
} from '../cloudAi';
import { categoryLabels, joinList } from '../../utils/cloudLabels';

describe('cloudAi constants', () => {
  it('lists the data kinds in display order', () => {
    expect([...CLOUD_CATEGORY_IDS]).toEqual(['features']);
  });

  it('allows everything by default (Studio has a single kind, features, and no default-off kind)', () => {
    expect(Object.keys(CLOUD_CATEGORY_DEFAULTS)).toEqual([...CLOUD_CATEGORY_IDS]);
    const off = CLOUD_CATEGORY_IDS.filter((id) => CLOUD_CATEGORY_DEFAULTS[id] === false);
    expect(off).toEqual([]);
    expect(CLOUD_CATEGORY_DEFAULTS).toEqual({ features: true });
  });

  it('pins the consent version and acknowledgements', () => {
    expect(CLOUD_CONSENT_VERSION).toBe(1);
    expect([...CLOUD_CONSENT_ACKS]).toEqual(['sends_data', 'pay_provider']);
  });

  it('labels every kind, with the documented hints and no dashes', () => {
    expect(Object.keys(CLOUD_CATEGORY_LABELS)).toEqual([...CLOUD_CATEGORY_IDS]);
    expect(CLOUD_CATEGORY_LABELS.features.label).toBe('Saved features');
    expect(CLOUD_CATEGORY_LABELS.features.hint).toBe('Names, descriptions and settings of the features you saved');
    for (const { label, hint } of Object.values(CLOUD_CATEGORY_LABELS)) {
      expect(`${label} ${hint ?? ''}`).not.toMatch(/[‒-―]/);
    }
  });

  it('is frozen so nothing can change it at runtime', () => {
    expect(Object.isFrozen(CLOUD_CATEGORY_IDS)).toBe(true);
    expect(Object.isFrozen(CLOUD_CATEGORY_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(CLOUD_CONSENT_ACKS)).toBe(true);
  });
});

describe('cloud label helpers', () => {
  it('joins lists in plain words', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b'])).toBe('a and b');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('maps ids to labels in display order and drops unknown ids', () => {
    expect(categoryLabels(['nope', 'features', 'notes'])).toEqual(['Saved features']);
    expect(categoryLabels(undefined)).toEqual([]);
    expect(categoryLabels('features')).toEqual([]);
  });
});
