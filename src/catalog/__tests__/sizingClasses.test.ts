// The shared row class table and grouping helper (DESIGN-phase9.md 2.4).
import { describe, expect, it } from 'vitest';
import { LAYER_WIDTHS } from '@local-app-studio/runtime/spec/sizing.ts';
import type { LayerWidth } from '@local-app-studio/runtime/spec/sizing.ts';
import { GROW_CLASS, ROW_CLASS, SIZED_PARENTS, UNSIZED_TYPES, WIDTH_CLASS, itemClass, sizingSegments } from '@local-app-studio/runtime/catalog/parts/sizingClasses.ts';

const L = (type: string, width?: string, grow?: boolean): Record<string, unknown> => ({
  id: `x_${Math.random().toString(36).slice(2, 8)}`,
  type,
  ...(width === undefined ? {} : { sizing: { width, ...(grow === undefined ? {} : { grow }) } }),
  props: {},
  children: [],
});
const full = (): Record<string, unknown> => L('Text');
const half = (): Record<string, unknown> => L('Text', 'half');

describe('sizingSegments', () => {
  it('gives nothing for no children and singles when nothing is sized', () => {
    expect(sizingSegments('Page', [])).toEqual([]);
    expect(sizingSegments('Page', [full(), L('Text', 'full', true), full()])).toEqual([
      { kind: 'single', index: 0 },
      { kind: 'single', index: 1 },
      { kind: 'single', index: 2 },
    ]);
  });

  it('makes a row of one sized child', () => {
    expect(sizingSegments('Section', [half()])).toEqual([{ kind: 'row', indexes: [0] }]);
  });

  it('groups a run of sized children between full ones', () => {
    expect(sizingSegments('Page', [full(), half(), half(), full()])).toEqual([
      { kind: 'single', index: 0 },
      { kind: 'row', indexes: [1, 2] },
      { kind: 'single', index: 3 },
    ]);
  });

  it('splits runs at a full child', () => {
    expect(sizingSegments('Card', [half(), full(), L('Text', 'fit')])).toEqual([
      { kind: 'row', indexes: [0] },
      { kind: 'single', index: 1 },
      { kind: 'row', indexes: [2] },
    ]);
  });

  it('treats junk children as singles', () => {
    const inherited = Object.assign(Object.create({ sizing: { width: 'half' } }) as object, { type: 'Text' });
    const junk: unknown[] = [null, 3, 'text', [], { sizing: { width: 'half' } }, { type: 7, sizing: { width: 'half' } }, inherited, L('Text', 'huge')];
    expect(sizingSegments('Page', junk)).toEqual(junk.map((_, index) => ({ kind: 'single', index })));
  });

  it('never sizes Page, Tab or Column children', () => {
    expect(sizingSegments('Page', [L('Tab', 'half'), L('Column', 'half'), L('Page', 'half')]).every((s) => s.kind === 'single')).toBe(true);
    expect(sizingSegments('Tabs', [L('Tab', 'half')])).toEqual([{ kind: 'single', index: 0 }]);
  });

  it('gives singles under parents that do not stack', () => {
    for (const parent of ['Grid', 'Row', 'PageHeader', 'Tabs', 'Columns', 'Text', 'Nope', undefined, 7]) {
      expect(sizingSegments(parent, [half(), half()]), String(parent)).toEqual([
        { kind: 'single', index: 0 },
        { kind: 'single', index: 1 },
      ]);
    }
  });

  it('rows under every stacking parent', () => {
    expect([...SIZED_PARENTS].sort()).toEqual(['Card', 'Collapsible', 'Column', 'Page', 'Section', 'Tab']);
    expect([...UNSIZED_TYPES].sort()).toEqual(['Column', 'Page', 'Tab']);
    for (const parent of SIZED_PARENTS) expect(sizingSegments(parent, [half(), half()])).toEqual([{ kind: 'row', indexes: [0, 1] }]);
  });
});

/** The fraction of the row of each share width. */
const FRACTION: Partial<Record<LayerWidth, number>> = { 'three-quarters': 3 / 4, 'two-thirds': 2 / 3, half: 1 / 2, third: 1 / 3, quarter: 1 / 4 };

/** Evaluates "a/b" or "a" or "a*b/c" literals to a number. */
function evalFactor(text: string): number {
  return text.split('*').reduce((acc, part) => {
    const [num, den] = part.split('/');
    return acc * (den === undefined ? Number(num) : Number(num) / Number(den));
  }, 1);
}

describe('WIDTH_CLASS', () => {
  it('has exactly the 7 widths, each one md:basis class', () => {
    expect(Object.keys(WIDTH_CLASS).sort()).toEqual([...LAYER_WIDTHS].sort());
    for (const w of LAYER_WIDTHS) {
      expect(WIDTH_CLASS[w]).toMatch(/^md:basis-\S+$/);
    }
    expect(WIDTH_CLASS.full).toBe('md:basis-full');
    expect(WIDTH_CLASS.fit).toBe('md:basis-auto');
  });

  it.each(Object.entries(FRACTION))('%s is f * 100 percent minus 4 * (1 - f) * --spacing', (width, f) => {
    const m = /^md:basis-\[calc\(([0-9]+)%((?:\/[0-9]+)?)_-_var\(--spacing\)((?:\*[0-9/]+)*)\)\]$/.exec(WIDTH_CLASS[width as LayerWidth]);
    expect(m, WIDTH_CLASS[width as LayerWidth]).not.toBeNull();
    if (m === null || f === undefined) return;
    expect(Number(m[1]) / (m[2] === '' ? 1 : Number(m[2].slice(1)))).toBeCloseTo(f * 100, 10);
    const spacing = m[3] === '' ? 1 : evalFactor(m[3].slice(1));
    expect(spacing).toBeCloseTo(4 * (1 - f), 10);
  });

  it('the row uses gap-4 and one column below md', () => {
    expect(ROW_CLASS).toBe('flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start');
    expect(ROW_CLASS.split(' ')).toContain('gap-4');
  });

  it('itemClass joins the literal table values', () => {
    expect(itemClass({ width: 'half', grow: false })).toBe('min-w-0 md:basis-[calc(50%_-_var(--spacing)*2)]');
    expect(itemClass({ width: 'fit', grow: true })).toBe(`min-w-0 md:basis-auto ${GROW_CLASS}`);
    expect(GROW_CLASS).toBe('md:grow');
  });
});
