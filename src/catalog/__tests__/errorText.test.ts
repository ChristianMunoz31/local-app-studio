import { describe, expect, it } from 'vitest';
import { ERROR_TEXT, errorText, joinSentence } from '../errorText.ts';

describe('joinSentence', () => {
  it('joins sentence and action with a space', () => {
    expect(joinSentence('Nope.', 'Try again.')).toBe('Nope. Try again.');
  });
  it('leaves the action out when the sentence already ends with it, ignoring case', () => {
    expect(joinSentence('Could not save. try again.', 'Try again.')).toBe('Could not save. try again.');
  });
  it('handles an empty action or sentence', () => {
    expect(joinSentence('Nope.', null)).toBe('Nope.');
    expect(joinSentence('', 'Try again.')).toBe('Try again.');
  });
});

describe('errorText', () => {
  it('appends the action of an error that carries one', () => {
    const e = Object.assign(new Error('Name is required.'), { action: 'Fill in the name.' });
    expect(errorText(e, 'fallback')).toBe('Name is required. Fill in the name.');
  });
  it('does not repeat an action already in the message', () => {
    const e = Object.assign(new Error('Name is required. Fill in the name.'), { action: 'Fill in the name.' });
    expect(errorText(e, 'fallback')).toBe('Name is required. Fill in the name.');
  });
  it('uses the message of a plain error and the fallback otherwise', () => {
    expect(errorText(new Error('Plain.'), 'fallback')).toBe('Plain.');
    expect(errorText(new Error(''), 'fallback')).toBe('fallback');
    expect(errorText({}, 'fallback')).toBe('fallback');
    expect(errorText(undefined, 'fallback')).toBe('fallback');
  });
  it('every fallback string in the table names a next step', () => {
    for (const key of ['loadRowsFailed', 'saveFailed', 'addFailed', 'exportFailed', 'removeFailed'] as const) {
      expect(ERROR_TEXT[key]).toMatch(/try again\.$/i);
    }
  });
});
