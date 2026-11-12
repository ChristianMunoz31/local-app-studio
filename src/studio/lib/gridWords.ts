// The plain words of parts placed freely on a grid (docs/DESIGN.md "Parts placed freely on a grid"). Pure, no React, like
// sizingWords.ts. Every string lives here so a wording change is one edit. No part type names in them (plainMessage passes them through).
import type { GridCell, GridDirection, GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import { GRID_NOT_ALLOWED_MESSAGE, GRID_OVERLAP_MESSAGE } from '@/catalog/validateLayout';

/** The validator's own words (the copy rows of grid_overlap and grid_not_allowed); they stay generic. */
export const GRID_OVERLAP_WORDS = GRID_OVERLAP_MESSAGE;
export const GRID_NOT_ALLOWED_WORDS = GRID_NOT_ALLOWED_MESSAGE;

/** A box of the Place section. */
export type PlaceField = 'col' | 'span' | 'row' | 'rowSpan';

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const cellWords = (c: GridCell): string => `column ${c.col}, row ${c.row}`;
export const columnsWide = (n: number): string => `${count(n, 'column', 'columns')} wide`;
export const rowsHigh = (n: number): string => `${count(n, 'row', 'rows')} high`;
/** The same function as rowsHigh, kept so the phase 21 name stays. */
export const rowsTall = rowsHigh;
/** "columns 4 to 9"; one column: "column 4". */
export const columnRange = (p: GridPlace): string => (p.span === 1 ? `column ${p.col}` : `columns ${p.col} to ${p.col + p.span - 1}`);
/** "rows 3 to 4"; one row: "row 3". */
export const rowRange = (p: GridPlace): string => (p.rowSpan === 1 ? `row ${p.row}` : `rows ${p.row} to ${p.row + p.rowSpan - 1}`);
/** "6 columns wide, columns 4 to 9" (the width handle's aria-valuetext). */
export const columnsSpan = (p: GridPlace): string => `${columnsWide(p.span)}, ${columnRange(p)}`;
/** "2 rows high, rows 3 to 4" (the height handle's aria-valuetext). */
export const rowsSpan = (p: GridPlace): string => `${rowsHigh(p.rowSpan)}, ${rowRange(p)}`;
export const movedWords = (c: GridCell): string => `Moved to ${cellWords(c)}.`;
/** "Now 6 columns wide, columns 4 to 9." */
export const widthWords = (p: GridPlace): string => `Now ${columnsSpan(p)}.`;
/** "Now 2 rows high, rows 3 to 4." */
export const heightWords = (p: GridPlace): string => `Now ${rowsSpan(p)}.`;
/** The placed block's accessible description: "column 4, row 2, 3 columns wide, 1 row high". */
export const placeDescription = (p: GridPlace): string => `${cellWords(p)}, ${columnsWide(p.span)}, ${rowsHigh(p.rowSpan)}`;
/** "Starts at column 4, row 2. 6 columns wide, 1 row high." */
export const placeLine = (p: GridPlace): string => `Starts at ${cellWords(p)}. ${columnsWide(p.span)}, ${rowsHigh(p.rowSpan)}.`;
/** Appended to a keyboard, handle or Place announcement below md. */
export const NARROW_WORDS = 'The grid shows one column on a narrow screen.';
export const withNarrow = (text: string, narrow: boolean): string => (narrow ? `${text} ${NARROW_WORDS}` : text);
/** "Auto grid, column 4, row 2" (drag announcements). */
export const gridPlaceName = (gridName: string, c: GridCell): string => `${gridName}, ${cellWords(c)}`;
/** History labels, lower case, no full stop: "added Text at column 4, row 2", "moved Text to column 4, row 2". */
export const addedLabel = (name: string, c: GridCell): string => `added ${name} at ${cellWords(c)}`;
export const movedLabel = (name: string, c: GridCell): string => `moved ${name} to ${cellWords(c)}`;
export const numberProblem = (min: number, max: number): string => `Use a whole number from ${min} to ${max}.`;

/**
 * A whole number outside a box's range, with the limit that depends on the other box:
 * col: span 1 "Column can be 1 to 12."; span 12 "Column can only be 1 while the width is 12 columns."; else "Column can be 1 to 9 while the width is 4 columns."
 * span: col 1 "Width can be 1 to 12 columns."; col 12 "Width can only be 1 column while Column is 12."; else "Width can be 1 to 9 columns while Column is 4."
 * row: rowSpan 1 "Row can be 1 to 60."; else "Row can be 1 to 58 while the height is 3 rows."
 * rowSpan: row <= 49 "Height can be 1 to 12 rows."; row 60 "Height can only be 1 row while Row is 60."; else "Height can be 1 to 5 rows while Row is 56."
 */
export const limitWords = (field: PlaceField, p: GridPlace): string => {
  if (field === 'col') {
    const max = 13 - p.span;
    if (max === 12) return 'Column can be 1 to 12.';
    if (max === 1) return `Column can only be 1 while the width is ${count(p.span, 'column', 'columns')}.`;
    return `Column can be 1 to ${max} while the width is ${count(p.span, 'column', 'columns')}.`;
  }
  if (field === 'span') {
    const max = 13 - p.col;
    if (max === 12) return 'Width can be 1 to 12 columns.';
    if (max === 1) return `Width can only be 1 column while Column is ${p.col}.`;
    return `Width can be 1 to ${max} columns while Column is ${p.col}.`;
  }
  if (field === 'row') {
    if (p.rowSpan === 1) return 'Row can be 1 to 60.';
    return `Row can be 1 to ${61 - p.rowSpan} while the height is ${count(p.rowSpan, 'row', 'rows')}.`;
  }
  const max = 61 - p.row;
  if (max >= 12) return 'Height can be 1 to 12 rows.';
  if (max === 1) return `Height can only be 1 row while Row is ${p.row}.`;
  return `Height can be 1 to ${max} rows while Row is ${p.row}.`;
};

const STEP_VERB = {
  move: { left: 'move left', right: 'move right', up: 'move up', down: 'move down' },
  resize: { left: 'make it narrower', right: 'make it wider', up: 'make it shorter', down: 'make it taller' },
} as const;
/** A step stopped by another part: "Cannot move right: Heading is in column 5." `line` is the column (left, right) or row (up, down) the part tried to enter. */
export const blockedWords = (dir: GridDirection, mode: 'move' | 'resize', blocker: string, line: number): string =>
  `Cannot ${STEP_VERB[mode][dir]}: ${blocker} is in ${dir === 'left' || dir === 'right' ? 'column' : 'row'} ${line}.`;
/** A Place value or handle drag stopped by another part: "Cannot place it there: Heading is in column 5, row 2." */
export const placeBlockedWords = (blocker: string, c: GridCell): string => `Cannot place it there: ${blocker} is in ${cellWords(c)}.`;

export const PLACE_WORDS = {
  heading: 'Place',
  col: 'Column',
  span: 'Width in columns',
  row: 'Row',
  rowSpan: 'Height in rows',
  fillRow: 'Fill the row',
  fillRowHint: 'Makes it 12 columns wide, from column 1, in the rows it is in.',
  hint: 'Place changes when you leave a box or press Enter. The arrow keys change it at once.',
  chooseCell: 'Choose column and row...',
} as const;

/** The limit a step reached (gridLayout's grid_edge words). */
export const EDGE_WORDS = {
  left: 'Column 1 is the first column.',
  right: 'Column 12 is the last column.',
  up: 'Row 1 is the first row.',
  down: 'Row 60 is the last row.',
  narrowest: 'It is already 1 column wide.',
  widest: 'Column 12 is the last column.',
  shortest: 'It is already 1 row high.',
  tallest: 'Row 60 is the last row.',
} as const;
/** A resize down stopped by the 12-row limit before row 60. */
export const TALLEST_WORDS = 'A part can be at most 12 rows high.';
export const GRID_FULL_WORDS = 'There is no free room left on this grid.';
export const NOT_FREE_WORDS = 'This part is not on a grid that places parts freely.';
export const OUT_OF_GRID_WORDS = 'That place does not fit on the grid.';
export const TOO_MANY_WORDS = 'This grid holds too many parts to place them freely.';

export const FREE_WORDS = {
  label: 'Place parts freely',
  hint: 'Put each part at a column and row of its own, on 12 columns.',
  on: (name: string): string => `${name} now places parts freely.`,
  off: (name: string): string => `${name} now puts parts one after the other.`,
  confirmTitle: 'Stop placing parts freely?',
  confirmBody: 'Their places are forgotten. The parts stay, one after the other. Ctrl+Z brings them back.',
  confirmYes: 'Stop placing freely',
  confirmBusy: 'Stopping...',
  confirmNo: 'Keep places',
} as const;

export const HANDLE_WORDS = {
  width: (name: string): string => `Change the width of ${name}`,
  height: (name: string): string => `Change the height of ${name}`,
} as const;

export const TARGET_WORDS = { free: 'Drop here', taken: 'Cells taken' } as const;
