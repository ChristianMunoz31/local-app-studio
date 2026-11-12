import { describe, expect, it } from 'vitest';
import { layer } from '@/catalog/__tests__/fixtures';
import { EDGE_WORDS, TALLEST_WORDS } from '../../lib/gridWords';
import { gridReach, orderChanged, placeRefusal, stepRefusal } from '../gridSteps';
import { at, freeGrid, page, text } from './gridFixtures';

const named = (l: { id: string }): string => (l.id === 'h' ? 'Heading' : `Text ${l.id}`);

describe('stepRefusal', () => {
  it('is null for an allowed step, an unplaced part and a part outside a free Grid', () => {
    const root = page(freeGrid('g', [text('a', at(2, 3, 1, 1))]), layer('flow', 'Grid', {}, [text('f')]));
    expect(stepRefusal(root, 'a', 'right', 'move', named)).toBeNull();
    expect(stepRefusal(root, 'f', 'right', 'move', named)).toBeNull();
    expect(stepRefusal(root, 'missing', 'right', 'move', named)).toBeNull();
    const unplaced = page(freeGrid('g', [text('a')]));
    expect(stepRefusal(unplaced, 'a', 'right', 'move', named)).toBeNull();
  });

  it('names the blocker and the entered line for each move direction', () => {
    const root = page(freeGrid('g', [text('h', at(5, 1, 3, 1)), text('a', at(2, 3, 3, 1)), text('l', at(1, 1, 3, 1)), text('u', at(2, 3, 2, 1)), text('d', at(2, 3, 4, 1))], 4));
    expect(stepRefusal(root, 'a', 'right', 'move', named)).toBe('Cannot move right: Heading is in column 5.');
    expect(stepRefusal(root, 'a', 'left', 'move', named)).toBe('Cannot move left: Text l is in column 1.');
    expect(stepRefusal(root, 'a', 'up', 'move', named)).toBe('Cannot move up: Text u is in row 2.');
    expect(stepRefusal(root, 'a', 'down', 'move', named)).toBe('Cannot move down: Text d is in row 4.');
  });

  it('names a tall blocker that starts above the part with the entered column', () => {
    const root = page(freeGrid('g', [text('h', at(5, 1, 1, 4)), text('a', at(2, 3, 3, 1))], 4));
    expect(stepRefusal(root, 'a', 'right', 'move', named)).toBe('Cannot move right: Heading is in column 5.');
  });

  it('names the blocker of a resize right and down', () => {
    const root = page(freeGrid('g', [text('h', at(5, 1, 3, 1)), text('a', at(2, 3, 3, 1)), text('d', at(2, 1, 4, 1))], 4));
    expect(stepRefusal(root, 'a', 'right', 'resize', named)).toBe('Cannot make it wider: Heading is in column 5.');
    expect(stepRefusal(root, 'a', 'down', 'resize', named)).toBe('Cannot make it taller: Text d is in row 4.');
  });

  it('gives the edge words', () => {
    const root = page(freeGrid('g', [text('tl', at(1, 1, 1, 1)), text('br', at(12, 1, 60, 1)), text('tall', at(1, 1, 40, 12))], 60));
    expect(stepRefusal(root, 'tl', 'left', 'move', named)).toBe('Column 1 is the first column.');
    expect(stepRefusal(root, 'br', 'right', 'move', named)).toBe('Column 12 is the last column.');
    expect(stepRefusal(root, 'tl', 'up', 'move', named)).toBe('Row 1 is the first row.');
    expect(stepRefusal(root, 'br', 'down', 'move', named)).toBe('Row 60 is the last row.');
    expect(stepRefusal(root, 'tl', 'left', 'resize', named)).toBe(EDGE_WORDS.narrowest);
    expect(stepRefusal(root, 'tl', 'up', 'resize', named)).toBe(EDGE_WORDS.shortest);
    expect(stepRefusal(root, 'br', 'right', 'resize', named)).toBe(EDGE_WORDS.widest);
    expect(stepRefusal(root, 'br', 'down', 'resize', named)).toBe(EDGE_WORDS.tallest);
    expect(stepRefusal(root, 'tall', 'down', 'resize', named)).toBe(TALLEST_WORDS);
  });
});

describe('placeRefusal', () => {
  it('names the first covered cell in reading order, and is null when free', () => {
    const root = page(freeGrid('g', [text('h', at(5, 2, 2, 2)), text('a', at(1, 2, 1, 1))], 3));
    expect(placeRefusal(root, 'a', at(4, 3, 1, 3), named)).toBe('Cannot place it there: Heading is in column 5, row 2.');
    expect(placeRefusal(root, 'a', at(1, 3, 1, 1), named)).toBeNull();
    expect(placeRefusal(root, 'missing', at(1, 3, 1, 1), named)).toBeNull();
  });
});

describe('gridReach', () => {
  it('stops before a neighbour, at column 12, at 12 rows and at row 60', () => {
    const root = page(freeGrid('g', [text('n', at(6, 1, 1, 1)), text('a', at(2, 1, 1, 1)), text('b', at(4, 1, 5, 1)), text('c', at(10, 1, 55, 1))], 55));
    expect(gridReach(root, 'a')).toEqual({ span: 4, rowSpan: 12 });
    expect(gridReach(root, 'b')).toEqual({ span: 9, rowSpan: 12 });
    expect(gridReach(root, 'c')).toEqual({ span: 3, rowSpan: 6 });
  });

  it('stops a tall reach before a part below, and keeps the current size', () => {
    const root = page(freeGrid('g', [text('a', at(1, 2, 1, 2)), text('b', at(1, 1, 5, 1))], 5));
    expect(gridReach(root, 'a')).toEqual({ span: 12, rowSpan: 4 });
    expect(gridReach(root, 'missing')).toEqual({ span: 1, rowSpan: 1 });
  });
});

describe('orderChanged', () => {
  it('is true when a move passes a sibling in reading order, false inside the same position', () => {
    const before = page(freeGrid('g', [text('a', at(1, 2, 1, 1)), text('b', at(4, 2, 1, 1))]));
    const passed = page(freeGrid('g', [text('b', at(4, 2, 1, 1)), text('a', at(7, 2, 1, 1))]));
    const same = page(freeGrid('g', [text('a', at(2, 2, 1, 1)), text('b', at(4, 2, 1, 1))]));
    expect(orderChanged(before, passed, 'a')).toBe(true);
    expect(orderChanged(before, same, 'a')).toBe(false);
    expect(orderChanged(before, same, 'missing')).toBe(false);
  });
});
