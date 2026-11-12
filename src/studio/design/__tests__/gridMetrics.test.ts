import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellAt, dropRowsTemplate, measureGrid, narrowGrid, parseTracks, trackIndex } from '../gridMetrics';
import type { GridMetrics } from '../gridMetrics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTracks', () => {
  it('reads a resolved px list', () => {
    expect(parseTracks('64px 40.5px 40px')).toEqual([64, 40.5, 40]);
  });
  it('skips tokens in brackets', () => {
    expect(parseTracks('[a] 10px [b c] 20px')).toEqual([10, 20]);
  });
  it('gives null for anything that is not px', () => {
    expect(parseTracks('none')).toBeNull();
    expect(parseTracks('1fr 10px')).toBeNull();
    expect(parseTracks('')).toBeNull();
    expect(parseTracks('10px auto')).toBeNull();
  });
});

describe('trackIndex', () => {
  const sizes = [10, 10, 10];
  it('finds the track inside a track', () => {
    expect(trackIndex(sizes, 4, 0)).toBe(1);
    expect(trackIndex(sizes, 4, 9)).toBe(1);
    expect(trackIndex(sizes, 4, 15)).toBe(2);
    expect(trackIndex(sizes, 4, 30)).toBe(3);
  });
  it('gives a gap to the track before it', () => {
    expect(trackIndex(sizes, 4, 12)).toBe(1);
    expect(trackIndex(sizes, 4, 13.9)).toBe(1);
    expect(trackIndex(sizes, 4, 14)).toBe(2);
  });
  it('clamps before the first and after the last track', () => {
    expect(trackIndex(sizes, 4, -5)).toBe(1);
    expect(trackIndex(sizes, 4, 500)).toBe(4);
  });
});

describe('cellAt', () => {
  const m: GridMetrics = { left: 100, top: 50, cols: Array.from({ length: 12 }, () => 10), rows: [20, 20], colGap: 0, rowGap: 0 };
  it('reads the cell under a client point', () => {
    expect(cellAt(m, 105, 55)).toEqual({ col: 1, row: 1 });
    expect(cellAt(m, 125, 75)).toEqual({ col: 3, row: 2 });
  });
  it('clamps columns to 12 and rows to 60', () => {
    expect(cellAt(m, 5000, 5000)).toEqual({ col: 12, row: 3 });
    const tall: GridMetrics = { ...m, rows: Array.from({ length: 70 }, () => 1) };
    expect(cellAt(tall, 100, 5000)).toEqual({ col: 1, row: 60 });
    expect(cellAt(m, -50, -50)).toEqual({ col: 1, row: 1 });
  });
});

describe('measureGrid', () => {
  it('is null for no element and for a grid that is not display grid', () => {
    expect(measureGrid(null)).toBeNull();
    vi.stubGlobal('getComputedStyle', () => ({ display: 'flex' }));
    expect(measureGrid({ getBoundingClientRect: () => ({ left: 0, top: 0 }) } as unknown as Element)).toBeNull();
  });
  it('reads tracks, gaps and the content origin', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      display: 'grid',
      gridTemplateColumns: '10px 10px',
      gridTemplateRows: '20px',
      columnGap: '8px',
      rowGap: '4px',
      borderLeftWidth: '1px',
      borderTopWidth: '2px',
      paddingLeft: '3px',
      paddingTop: '4px',
    }));
    const m = measureGrid({ getBoundingClientRect: () => ({ left: 10, top: 20 }) } as unknown as Element);
    expect(m).toEqual({ left: 14, top: 26, cols: [10, 10], rows: [20], colGap: 8, rowGap: 4 });
  });
  it('is null when the tracks are not px (below md the Grid is not a grid)', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'grid', gridTemplateColumns: 'none', gridTemplateRows: 'none' }));
    expect(measureGrid({ getBoundingClientRect: () => ({ left: 0, top: 0 }) } as unknown as Element)).toBeNull();
  });
});

describe('narrowGrid', () => {
  it('is true when matchMedia matches (width < 48rem)', () => {
    const matchMedia = vi.fn((q: string) => ({ matches: q === '(width < 48rem)' }));
    vi.stubGlobal('window', { matchMedia });
    expect(narrowGrid()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(width < 48rem)');
  });
  it('is false when it does not match', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(narrowGrid()).toBe(false);
  });
  it('is false when matchMedia is missing', () => {
    vi.stubGlobal('window', {});
    expect(narrowGrid()).toBe(false);
  });
});

describe('dropRowsTemplate', () => {
  it('is the measured rows plus one empty row, so the dotted rows are the rows cellAt judges', () => {
    expect(dropRowsTemplate([40, 120])).toBe('40px 120px calc(var(--spacing)*10)');
    expect(dropRowsTemplate([40.5])).toBe('40.5px calc(var(--spacing)*10)');
  });
  it('adds no row past the 60 a Grid may have, and is null when nothing was measured', () => {
    expect((dropRowsTemplate(Array.from({ length: 60 }, () => 40)) ?? '').split(' ')).toHaveLength(60);
    expect(dropRowsTemplate(null)).toBeNull();
    expect(dropRowsTemplate([])).toBeNull();
  });
});
