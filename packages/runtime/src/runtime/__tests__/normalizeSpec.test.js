import { describe, expect, it } from 'vitest';
import crewRoster from '../../spec/fixtures/crew-roster.json';
import { SPEC_DEFAULTS, normalizeSpec } from '../normalizeSpec.js';

describe('normalizeSpec and the menu block', () => {
  it('adds no menu key to a spec without one, and leaves the key order alone', () => {
    const out = normalizeSpec(crewRoster);
    expect(Object.keys(out)).toEqual(['specVersion', 'app', 'tables', 'pages', 'nav', 'theme']);
    expect('menu' in out).toBe(false);
    expect(JSON.stringify(normalizeSpec(out))).toBe(JSON.stringify(out));
  });

  it('fills the missing parts of a menu object and nothing else', () => {
    expect(normalizeSpec({ ...crewRoster, menu: {} }).menu).toEqual({ position: 'top', style: 'icons-and-labels' });
    expect(normalizeSpec({ ...crewRoster, menu: { position: 'side' } }).menu).toEqual({ position: 'side', style: 'icons-and-labels' });
    expect(normalizeSpec({ ...crewRoster, menu: { style: 'labels' } }).menu).toEqual({ position: 'top', style: 'labels' });
    expect(normalizeSpec({ ...crewRoster, menu: { position: 'side', style: 'labels' } }).menu).toEqual({ position: 'side', style: 'labels' });
    expect(SPEC_DEFAULTS.menu).toEqual({ position: 'top', style: 'icons-and-labels' });
  });

  it('keeps a menu that is not an object as it is (validation rejects it, normalization never does)', () => {
    for (const bad of ['top', 7, null, true, ['top']]) expect(normalizeSpec({ ...crewRoster, menu: bad }).menu).toEqual(bad);
  });

  it('does not change the input and is idempotent with a menu', () => {
    const input = { ...crewRoster, menu: { position: 'side' } };
    const before = JSON.stringify(input);
    const once = normalizeSpec(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(normalizeSpec(once)).toEqual(once);
  });
});
