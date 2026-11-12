import { describe, expect, it } from 'vitest';
import { IMPORT_WORDS, PREVIEW_IMPORT_MAX_BODY, encodedSize, importLabel, resumeLabel, sizeProblem } from '../data/importModel.js';

describe('importModel', () => {
  it('measures the encoded JSON body in bytes, not characters', () => {
    expect(encodedSize({ a: 'é' })).toBe(new TextEncoder().encode('{"a":"é"}').length);
  });

  it('refuses a body over the limit with the sentence of the mode', () => {
    const big = { csv: 'x'.repeat(PREVIEW_IMPORT_MAX_BODY) };
    expect(sizeProblem(big, PREVIEW_IMPORT_MAX_BODY)).toBe(IMPORT_WORDS.tooLargePreview);
    expect(sizeProblem(big)).toBeNull();
    expect(sizeProblem({ csv: 'x'.repeat(PREVIEW_IMPORT_MAX_BODY - 40) }, PREVIEW_IMPORT_MAX_BODY)).toBeNull();
    expect(sizeProblem({ csv: 'x'.repeat(100) }, 50)).toBe(IMPORT_WORDS.tooLargePreview);
  });

  it('words', () => {
    expect(resumeLabel(1002)).toBe('Import again from row 1002');
    expect(importLabel(1)).toBe('Import 1 row');
    expect(importLabel(298)).toBe('Import 298 rows');
    expect(Object.values(IMPORT_WORDS).join(' ')).not.toMatch(/[\u2013\u2014]/);
  });
});
