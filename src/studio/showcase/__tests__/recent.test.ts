import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENT_KEY, RECENT_MAX, readRecent, recordRecent, subscribeRecent } from '../recent';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('recent features', () => {
  it('lives under the app. prefix and reads empty when nothing is stored', () => {
    expect(RECENT_KEY).toBe('app.studio.recentFeatures');
    expect(readRecent()).toEqual([]);
  });

  it('puts the newest first, moves a repeat to the front and keeps at most 8', () => {
    for (const key of ['part:Text', 'part:Card', 'part:Text']) recordRecent(key);
    expect(readRecent()).toEqual(['part:Text', 'part:Card']);
    for (let i = 0; i < 12; i += 1) recordRecent(`feature:f_${i}`);
    const kept = readRecent();
    expect(kept).toHaveLength(RECENT_MAX);
    expect(kept[0]).toBe('feature:f_11');
  });

  it('ignores a key that is not well formed and reads junk as empty or filters it', () => {
    recordRecent('part:bad key');
    recordRecent('other:Text');
    recordRecent(`part:${'a'.repeat(65)}`);
    expect(readRecent()).toEqual([]);
    for (const junk of ['not json', '{"a":1}', '"part:Text"', 'null']) {
      window.localStorage.setItem(RECENT_KEY, junk);
      expect(readRecent(), junk).toEqual([]);
    }
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(['part:Text', 7, null, 'x', 'part:Text', 'feature:ok_1', { a: 1 }]));
    expect(readRecent()).toEqual(['part:Text', 'feature:ok_1']);
  });

  it('swallows a storage error and still tells subscribers', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const seen = vi.fn();
    const stop = subscribeRecent(seen);
    expect(() => recordRecent('part:Text')).not.toThrow();
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    recordRecent('part:Card');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('reads empty when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRecent()).toEqual([]);
  });
});
