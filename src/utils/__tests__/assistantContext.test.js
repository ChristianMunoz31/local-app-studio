import { describe, it, expect } from 'vitest';
import { TRUNCATION_MARKER, clip, round2, serializeAssistantContext } from '../assistantContext';
import { ASSISTANT_CONTEXT_MAX_CHARS } from '../../constants/assistantPages';

const NOW = new Date(2026, 9, 2, 14, 5);

describe('serializeAssistantContext', () => {
  it('emits valid JSON under the cap with page, today, localTime and data', () => {
    const { context, truncated } = serializeAssistantContext({ pageKey: 'items', data: { n: 1 }, now: NOW });
    expect(truncated).toBe(false);
    expect(context.length).toBeLessThanOrEqual(ASSISTANT_CONTEXT_MAX_CHARS);
    expect(JSON.parse(context)).toEqual({
      page: 'items',
      today: '2026-10-02',
      localTime: '14:05',
      data: { n: 1 },
    });
  });

  it('truncates oversized payloads to exactly the cap with the marker', () => {
    const { context, truncated } = serializeAssistantContext({
      pageKey: 'notes',
      data: { text: 'word '.repeat(2000) },
      now: NOW,
    });
    expect(truncated).toBe(true);
    expect(context).toHaveLength(ASSISTANT_CONTEXT_MAX_CHARS);
    expect(context.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it('redacts secrets', () => {
    const { context } = serializeAssistantContext({
      pageKey: 'notes',
      data: { apiKey: 'abc', note: 'use gsk_secret1234567890abcdef' },
      now: NOW,
    });
    expect(context).not.toContain('gsk_secret');
    expect(context).not.toContain('"abc"');
  });

  it('notes missing data', () => {
    const { context } = serializeAssistantContext({ pageKey: 'home', data: null, now: NOW });
    expect(JSON.parse(context).data).toEqual({ note: 'No page data registered' });
  });
});

describe('helpers', () => {
  it('clip trims and adds an ellipsis', () => {
    expect(clip('  hello   world ', 50)).toBe('hello world');
    expect(clip('abcdefghij', 5)).toBe('abcd…');
    expect(clip(null, 5)).toBe('');
  });

  it('round2 rounds finite numbers and nulls the rest', () => {
    expect(round2(1.2349)).toBe(1.23);
    expect(round2('4.567')).toBe(4.57);
    expect(round2(undefined)).toBeNull();
    expect(round2(null)).toBeNull();
    expect(round2(NaN)).toBeNull();
  });
});
