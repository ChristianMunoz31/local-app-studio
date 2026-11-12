import { describe, expect, it } from 'vitest';
import type { GridDirection, GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import { GRID_NOT_ALLOWED_MESSAGE, GRID_OVERLAP_MESSAGE } from '@/catalog/validateLayout';
import * as words from '../gridWords';

const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const p = (col: number, span: number, row: number, rowSpan: number): GridPlace => ({ col, span, row, rowSpan });

const collect = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    try {
      const text = String((value as (...a: unknown[]) => unknown)('Auto grid'));
      // A helper that takes a number or a cell makes nonsense of a name; only the name helpers are checked here.
      if (!/undefined|NaN/.test(text)) out.push(text);
    } catch {
      // A helper that needs a number or a cell is covered by its own test.
    }
  } else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) collect(v, out);
  return out;
};

describe('cell, size and move words', () => {
  it('count with plurals', () => {
    expect(words.cellWords({ col: 4, row: 2 })).toBe('column 4, row 2');
    expect(words.columnsWide(1)).toBe('1 column wide');
    expect(words.columnsWide(6)).toBe('6 columns wide');
    expect(words.rowsHigh(1)).toBe('1 row high');
    expect(words.rowsHigh(2)).toBe('2 rows high');
    expect(words.rowsTall).toBe(words.rowsHigh);
    expect(words.movedWords({ col: 4, row: 2 })).toBe('Moved to column 4, row 2.');
  });

  it('say the extent', () => {
    expect(words.columnRange(p(4, 6, 1, 1))).toBe('columns 4 to 9');
    expect(words.columnRange(p(4, 1, 1, 1))).toBe('column 4');
    expect(words.rowRange(p(1, 1, 3, 2))).toBe('rows 3 to 4');
    expect(words.rowRange(p(1, 1, 3, 1))).toBe('row 3');
    expect(words.columnsSpan(p(4, 6, 1, 1))).toBe('6 columns wide, columns 4 to 9');
    expect(words.rowsSpan(p(1, 1, 3, 2))).toBe('2 rows high, rows 3 to 4');
    expect(words.widthWords(p(4, 6, 1, 1))).toBe('Now 6 columns wide, columns 4 to 9.');
    expect(words.widthWords(p(4, 1, 1, 1))).toBe('Now 1 column wide, column 4.');
    expect(words.heightWords(p(1, 1, 3, 2))).toBe('Now 2 rows high, rows 3 to 4.');
    expect(words.heightWords(p(1, 1, 3, 1))).toBe('Now 1 row high, row 3.');
    expect(words.placeDescription(p(4, 3, 2, 1))).toBe('column 4, row 2, 3 columns wide, 1 row high');
    expect(words.placeLine(p(4, 6, 2, 1))).toBe('Starts at column 4, row 2. 6 columns wide, 1 row high.');
  });

  it('name places for drags and history', () => {
    expect(words.gridPlaceName('Auto grid', { col: 4, row: 2 })).toBe('Auto grid, column 4, row 2');
    expect(words.addedLabel('Text', { col: 4, row: 2 })).toBe('added Text at column 4, row 2');
    expect(words.movedLabel('Text', { col: 4, row: 2 })).toBe('moved Text to column 4, row 2');
    expect(words.numberProblem(1, 9)).toBe('Use a whole number from 1 to 9.');
  });

  it('adds the narrow sentence only when asked', () => {
    expect(words.NARROW_WORDS).toBe('The grid shows one column on a narrow screen.');
    expect(words.withNarrow('Moved.', false)).toBe('Moved.');
    expect(words.withNarrow('Moved.', true)).toBe('Moved. The grid shows one column on a narrow screen.');
  });
});

describe('limitWords', () => {
  it('col', () => {
    expect(words.limitWords('col', p(1, 1, 1, 1))).toBe('Column can be 1 to 12.');
    expect(words.limitWords('col', p(1, 12, 1, 1))).toBe('Column can only be 1 while the width is 12 columns.');
    expect(words.limitWords('col', p(1, 4, 1, 1))).toBe('Column can be 1 to 9 while the width is 4 columns.');
  });

  it('span', () => {
    expect(words.limitWords('span', p(1, 1, 1, 1))).toBe('Width can be 1 to 12 columns.');
    expect(words.limitWords('span', p(12, 1, 1, 1))).toBe('Width can only be 1 column while Column is 12.');
    expect(words.limitWords('span', p(4, 1, 1, 1))).toBe('Width can be 1 to 9 columns while Column is 4.');
  });

  it('row', () => {
    expect(words.limitWords('row', p(1, 1, 1, 1))).toBe('Row can be 1 to 60.');
    expect(words.limitWords('row', p(1, 1, 1, 3))).toBe('Row can be 1 to 58 while the height is 3 rows.');
    expect(words.limitWords('row', p(1, 1, 1, 2))).toBe('Row can be 1 to 59 while the height is 2 rows.');
  });

  it('rowSpan', () => {
    expect(words.limitWords('rowSpan', p(1, 1, 49, 1))).toBe('Height can be 1 to 12 rows.');
    expect(words.limitWords('rowSpan', p(1, 1, 60, 1))).toBe('Height can only be 1 row while Row is 60.');
    expect(words.limitWords('rowSpan', p(1, 1, 56, 1))).toBe('Height can be 1 to 5 rows while Row is 56.');
  });
});

describe('refusal words', () => {
  it('blockedWords for all eight pairs', () => {
    const cases: Array<[GridDirection, 'move' | 'resize', string]> = [
      ['left', 'move', 'Cannot move left: Heading is in column 3.'],
      ['right', 'move', 'Cannot move right: Heading is in column 3.'],
      ['up', 'move', 'Cannot move up: Heading is in row 3.'],
      ['down', 'move', 'Cannot move down: Heading is in row 3.'],
      ['left', 'resize', 'Cannot make it narrower: Heading is in column 3.'],
      ['right', 'resize', 'Cannot make it wider: Heading is in column 3.'],
      ['up', 'resize', 'Cannot make it shorter: Heading is in row 3.'],
      ['down', 'resize', 'Cannot make it taller: Heading is in row 3.'],
    ];
    for (const [dir, mode, expected] of cases) expect(words.blockedWords(dir, mode, 'Heading', 3)).toBe(expected);
  });

  it('placeBlockedWords', () => {
    expect(words.placeBlockedWords('Heading', { col: 5, row: 2 })).toBe('Cannot place it there: Heading is in column 5, row 2.');
  });

  it('the eight edge words and the rest', () => {
    expect(words.EDGE_WORDS).toEqual({
      left: 'Column 1 is the first column.',
      right: 'Column 12 is the last column.',
      up: 'Row 1 is the first row.',
      down: 'Row 60 is the last row.',
      narrowest: 'It is already 1 column wide.',
      widest: 'Column 12 is the last column.',
      shortest: 'It is already 1 row high.',
      tallest: 'Row 60 is the last row.',
    });
    expect(words.TALLEST_WORDS).toBe('A part can be at most 12 rows high.');
    expect(words.GRID_FULL_WORDS).toBe('There is no free room left on this grid.');
    expect(words.NOT_FREE_WORDS).toBe('This part is not on a grid that places parts freely.');
    expect(words.OUT_OF_GRID_WORDS).toBe('That place does not fit on the grid.');
    expect(words.TOO_MANY_WORDS).toBe('This grid holds too many parts to place them freely.');
  });

  it('uses the validator words, kept generic, for the two layout codes', () => {
    expect(words.GRID_OVERLAP_WORDS).toBe(GRID_OVERLAP_MESSAGE);
    expect(words.GRID_NOT_ALLOWED_WORDS).toBe(GRID_NOT_ALLOWED_MESSAGE);
  });
});

describe('settings, handle and target words', () => {
  it('Place labels', () => {
    expect(words.PLACE_WORDS.heading).toBe('Place');
    expect(words.PLACE_WORDS.col).toBe('Column');
    expect(words.PLACE_WORDS.span).toBe('Width in columns');
    expect(words.PLACE_WORDS.row).toBe('Row');
    expect(words.PLACE_WORDS.rowSpan).toBe('Height in rows');
    expect(words.PLACE_WORDS.fillRow).toBe('Fill the row');
    expect(words.PLACE_WORDS.chooseCell).toBe('Choose column and row...');
  });

  it('the switch and its confirm', () => {
    expect(words.FREE_WORDS.label).toBe('Place parts freely');
    expect(words.FREE_WORDS.on('Auto grid')).toBe('Auto grid now places parts freely.');
    expect(words.FREE_WORDS.off('Auto grid')).toBe('Auto grid now puts parts one after the other.');
    expect(words.FREE_WORDS.confirmTitle).toBe('Stop placing parts freely?');
    expect(words.FREE_WORDS.confirmBody.endsWith('Ctrl+Z brings them back.')).toBe(true);
    expect(words.FREE_WORDS.confirmNo).toBe('Keep places');
  });

  it('handles and target pills', () => {
    expect(words.HANDLE_WORDS.width('Text')).toBe('Change the width of Text');
    expect(words.HANDLE_WORDS.height('Text')).toBe('Change the height of Text');
    expect(words.TARGET_WORDS).toEqual({ free: 'Drop here', taken: 'Cells taken' });
  });
});

describe('every string', () => {
  it('has no en or em dash and no PascalCase part type', () => {
    const all = collect(words);
    expect(all.length).toBeGreaterThan(30);
    for (const s of all) {
      expect(s).not.toMatch(DASHES);
      expect(s).not.toMatch(/\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/);
    }
  });
});
