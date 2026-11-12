import { describe, expect, it } from 'vitest';
import {
  EXAMPLES_HELP,
  MADE_FROM_EXAMPLE_KEY,
  countsLine,
  lookLine,
  madeFromExampleNotice,
  madeFromExampleState,
  readMadeFromExample,
  showsLine,
  tryTheseLine,
} from '../examples';

describe('example words', () => {
  it('words the shows, counts, look and ideas lines', () => {
    expect(showsLine(['a filter bar', 'linked tables'])).toBe('Shows: a filter bar, linked tables');
    expect(countsLine(2, 3)).toBe('2 tables, 3 pages');
    expect(countsLine(1, 1)).toBe('1 table, 1 page');
    expect(lookLine('forest', 'dark')).toBe('Forest look, dark');
    expect(lookLine('paper', 'light')).toBe('Paper look, light');
    expect(tryTheseLine(['a', 'b', 'c'])).toBe('Ideas to try: a; b; c.');
    expect(madeFromExampleNotice('Crew Board 2')).toBe('Made Crew Board 2 from the example. It is yours to change.');
  });

  it('has no em or en dash in the help line and says where to press', () => {
    expect(EXAMPLES_HELP).not.toMatch(/[\u2013\u2014]/);
    expect(EXAMPLES_HELP).toContain('Use this example');
  });
});

describe('the made-from-example router state', () => {
  it('round trips and copies the ideas', () => {
    const ideas = ['x', 'y'];
    const state = madeFromExampleState('Crew Board', ideas);
    expect(Object.keys(state)).toEqual([MADE_FROM_EXAMPLE_KEY]);
    expect(state.madeFromExample.tryThese).not.toBe(ideas);
    expect(readMadeFromExample({ stepFocus: true, ...state })).toEqual({ name: 'Crew Board', tryThese: ['x', 'y'] });
  });

  it.each([[null], [undefined], ['x'], [{}], [{ madeFromExample: null }], [{ madeFromExample: { name: '' } }], [{ madeFromExample: { name: 5 } }]])(
    'reads nothing from %j',
    (state) => {
      expect(readMadeFromExample(state)).toBeNull();
    },
  );

  it('drops ideas that are not text', () => {
    expect(readMadeFromExample({ madeFromExample: { name: 'A', tryThese: ['ok', 3, ''] } })).toEqual({ name: 'A', tryThese: ['ok'] });
    expect(readMadeFromExample({ madeFromExample: { name: 'A' } })).toEqual({ name: 'A', tryThese: [] });
  });
});
