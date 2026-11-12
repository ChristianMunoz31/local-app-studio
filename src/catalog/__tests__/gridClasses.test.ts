// The literal class tables of a free Grid (DESIGN-phase21.md 5.1): complete, capped at the spec limits, and written out in the source.
import { describe, expect, it } from 'vitest';
import { GRID_LIMITS } from '@local-app-studio/runtime/spec/gridPlacement.ts';
import {
  COL_SPAN_CLASS,
  COL_START_CLASS,
  GRID_ITEM_BASE,
  ROW_SPAN_CLASS,
  ROW_START_CLASS,
  UNPLACED_ITEM_CLASS,
  gridAreaClass,
  gridItemClass,
} from '@local-app-studio/runtime/catalog/parts/gridClasses.ts';

const RAW = import.meta.glob('../../../packages/runtime/src/catalog/parts/gridClasses.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SOURCE = Object.values(RAW)[0] ?? '';

const TABLES: ReadonlyArray<readonly [string, Readonly<Record<number, string>>, string, number]> = [
  ['COL_START_CLASS', COL_START_CLASS, 'md:col-start-', GRID_LIMITS.columns],
  ['COL_SPAN_CLASS', COL_SPAN_CLASS, 'md:col-span-', GRID_LIMITS.maxSpan],
  ['ROW_START_CLASS', ROW_START_CLASS, 'md:row-start-', GRID_LIMITS.maxRow],
  ['ROW_SPAN_CLASS', ROW_SPAN_CLASS, 'md:row-span-', GRID_LIMITS.maxRowSpan],
];

describe('grid class tables', () => {
  it.each(TABLES)('%s holds every number 1..limit and nothing else', (_name, table, prefix, max) => {
    expect(Object.keys(table).map(Number)).toEqual(Array.from({ length: max }, (_v, i) => i + 1));
    for (let n = 1; n <= max; n += 1) expect(table[n]).toBe(`${prefix}${n}`);
  });

  it('has 96 classes in all', () => {
    expect(TABLES.reduce((sum, t) => sum + Object.keys(t[1]).length, 0)).toBe(96);
  });

  it.each(TABLES)('%s writes every class as a literal string in the source', (_name, table) => {
    for (const cls of Object.values(table)) expect(SOURCE).toContain(`'${cls}'`);
  });

  it('builds no class name from a template literal', () => {
    expect(SOURCE).not.toMatch(/`[^`]*md:(col|row)-(start|span)-\$\{/);
  });
});

describe('gridAreaClass and gridItemClass', () => {
  it('joins the four position classes', () => {
    expect(gridAreaClass({ col: 4, span: 3, row: 13, rowSpan: 2 })).toBe('md:col-start-4 md:col-span-3 md:row-start-13 md:row-span-2');
  });

  it('wraps a readable block and gives an unreadable one a full row', () => {
    expect(gridItemClass({ col: 1, span: 12, row: 60, rowSpan: 1 })).toBe(`${GRID_ITEM_BASE} md:col-start-1 md:col-span-12 md:row-start-60 md:row-span-1`);
    for (const raw of [undefined, null, {}, { col: 0, span: 1, row: 1, rowSpan: 1 }, { col: 12, span: 3, row: 1, rowSpan: 1 }, 'x']) {
      expect(gridItemClass(raw)).toBe(UNPLACED_ITEM_CLASS);
    }
  });
});
