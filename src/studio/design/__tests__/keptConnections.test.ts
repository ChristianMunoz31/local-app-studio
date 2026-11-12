import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lsKey } from '@/utils/storageKeys.js';
import { KEPT_MAX, readKept, writeKept } from '../keptConnections';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('keptConnections', () => {
  it('reads nothing when nothing is stored', () => {
    expect(readKept('a1').size).toBe(0);
  });
  it('round-trips a set, per app, under an app. key', () => {
    writeKept('a1', new Set(['home|q|other_table|people']));
    writeKept('a2', new Set(['x']));
    expect([...readKept('a1')]).toEqual(['home|q|other_table|people']);
    expect([...readKept('a2')]).toEqual(['x']);
    expect(window.localStorage.getItem(lsKey('studio.keptConnections.a1'))).toBe('["home|q|other_table|people"]');
  });
  it('tolerates broken, non-array and mixed values', () => {
    const key = lsKey('studio.keptConnections.a1');
    window.localStorage.setItem(key, '{nope');
    expect(readKept('a1').size).toBe(0);
    window.localStorage.setItem(key, '{"a":1}');
    expect(readKept('a1').size).toBe(0);
    window.localStorage.setItem(key, '["ok",3,null,"fine"]');
    expect([...readKept('a1')]).toEqual(['ok', 'fine']);
  });
  it('keeps at most 200 keys, the newest', () => {
    const keys = new Set(Array.from({ length: KEPT_MAX + 5 }, (_, i) => `k${i}`));
    writeKept('a1', keys);
    const back = readKept('a1');
    expect(back.size).toBe(KEPT_MAX);
    expect(back.has('k0')).toBe(false);
    expect(back.has(`k${KEPT_MAX + 4}`)).toBe(true);
  });
  it('swallows a storage error on read and write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => writeKept('a1', new Set(['x']))).not.toThrow();
    expect(readKept('a1').size).toBe(0);
  });
});
