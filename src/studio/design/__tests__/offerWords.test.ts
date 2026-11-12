// The offer sentence in the Feature builder says table slot, never "This app has no table yet".
import { describe, expect, it } from 'vitest';
import { offerWordsFor } from '../offerWords';

describe('offerWordsFor', () => {
  it('keeps the app words outside the builder and uses slot words inside it', () => {
    expect(offerWordsFor({ kind: 'no_table' }, false)).toBe('This app has no table yet.');
    expect(offerWordsFor({ kind: 'no_table' }, true)).toBe('This feature has no table slot yet.');
  });

  it('says table slots, not Page settings, when a feature holds the most slots', () => {
    expect(offerWordsFor({ kind: 'full' }, false)).toContain('Remove one in Page settings first.');
    expect(offerWordsFor({ kind: 'full' }, true)).toBe('This feature already has the most table slots. Remove one first.');
  });
});
