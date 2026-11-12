import { describe, expect, it } from 'vitest';
import { isReservedTableId } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import { appNameProblem, deriveSlug, toId, uniquePageRoute } from '../ids';
import { stableJson } from '../stableJson';
import { issuesAt, issuesOutside, validateSpec } from '../validate';

describe('stableJson', () => {
  it('sorts keys and drops undefined', () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
    expect(stableJson(undefined)).toBe('null');
  });
});

describe('toId', () => {
  const none = new Set<string>();
  it('makes ids from labels', () => {
    expect(toId('Open Crews', none, () => false)).toBe('open_crews');
    expect(toId('2nd crew', none, () => false)).toBe('n_2nd_crew');
    expect(toId('!!!', none, () => false)).toBe('item');
  });
  it('avoids reserved and taken ids and stays within 31 chars', () => {
    expect(toId('Select', none, isReservedTableId)).toBe('select_2');
    expect(toId('crews', new Set(['crews', 'crews_2']), () => false)).toBe('crews_3');
    const long = toId('a'.repeat(50), new Set(['a'.repeat(31)]), () => false);
    expect(long.length).toBeLessThanOrEqual(31);
    expect(long.endsWith('_2')).toBe(true);
  });
});

describe('deriveSlug', () => {
  it('lowercases and joins words with a dash, like the server', () => {
    const names = ['Crew Roster', 'Alpha', 'A1', 'My App 2', 'Tool Box Pro', 'Zeta Zeta Zeta', 'Ab', 'Fleet 42', 'Pet Shop', 'Q'];
    expect(names.map(deriveSlug)).toEqual(['crew-roster', 'alpha', 'a1', 'my-app-2', 'tool-box-pro', 'zeta-zeta-zeta', 'ab', 'fleet-42', 'pet-shop', 'q']);
  });
});

describe('uniquePageRoute and appNameProblem', () => {
  it('avoids reserved segments and taken routes', () => {
    expect(uniquePageRoute('Open Crews', new Set())).toBe('/open-crews');
    expect(uniquePageRoute('Settings', new Set())).toBe('/settings-page');
    expect(uniquePageRoute('Open Crews', new Set(['/open-crews']))).toBe('/open-crews-2');
  });
  it('checks names', () => {
    expect(appNameProblem('Crew Roster')).toBeNull();
    expect(appNameProblem('A')).not.toBeNull();
    expect(appNameProblem('1Crew')).not.toBeNull();
    expect(appNameProblem('Local App Studio')).toMatch(/reserved/);
  });
});

describe('validate helpers', () => {
  it('validates a spec and finds issues by prefix', () => {
    expect(validateSpec(baseSpec()).ok).toBe(true);
    const bad = baseSpec();
    bad.tables[0].fields[0].id = 'Bad Id';
    const result = validateSpec(bad);
    expect(result.ok).toBe(false);
    expect(issuesAt(result.issues, 'tables.0').length).toBeGreaterThan(0);
    expect(issuesAt(result.issues, 'tables.01')).toEqual([]);
    expect(issuesOutside(result.issues, 'tables')).toEqual([]);
  });
});
