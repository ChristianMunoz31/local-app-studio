import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lsKey } from '@/utils/storageKeys.js';
import { markProgress, readProgress } from '../progress';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('progress', () => {
  it('reads nothing as empty and keeps previews and builds apart per app', () => {
    expect(readProgress('a1')).toEqual({});
    markProgress('a1', 'preview', 4);
    markProgress('a1', 'build', 3);
    markProgress('a2', 'preview', 1);
    expect(readProgress('a1')).toEqual({ previewed: 4, built: 3 });
    expect(readProgress('a2')).toEqual({ previewed: 1 });
    expect(window.localStorage.getItem(lsKey('studio.progress.a1'))).toBe('{"previewed":4,"built":3}');
  });

  it('reads bad JSON and wrong shapes as empty', () => {
    window.localStorage.setItem(lsKey('studio.progress.a1'), '{nope');
    expect(readProgress('a1')).toEqual({});
    window.localStorage.setItem(lsKey('studio.progress.a1'), '[1]');
    expect(readProgress('a1')).toEqual({});
    window.localStorage.setItem(lsKey('studio.progress.a1'), '{"previewed":"x","built":2}');
    expect(readProgress('a1')).toEqual({ built: 2 });
  });

  it('ignores storage errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => markProgress('a1', 'preview', 2)).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readProgress('a1')).toEqual({});
  });
});
