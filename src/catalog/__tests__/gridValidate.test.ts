import { describe, expect, it } from 'vitest';
import { gridDef } from '@local-app-studio/runtime/catalog/parts/Grid.def';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { GRID_NOT_ALLOWED_MESSAGE, GRID_OVERLAP_MESSAGE, checkLayer } from '../validateLayout';
import { joinSentence } from '../errorText';
import { CORE_ERROR_COPY as ERROR_COPY } from '../../errors/copy.core.js';
import { crewCtx, layer } from './fixtures';

const at = (col: number, span: number, row: number, rowSpan: number): GridPlace => ({ col, span, row, rowSpan });
const text = (id: string, grid?: GridPlace): LayoutLayer => ({ ...layer(id, 'Text', {}, 'x'), ...(grid === undefined ? {} : { grid }) });
const freeGrid = (children: LayoutLayer[], props: Record<string, unknown> = {}): LayoutLayer =>
  layer('g', 'Grid', { placement: 'free', columns: 12, rows: 3, ...props } as LayoutLayer['props'], children);
const check = (root: LayoutLayer, base = 'layer') => checkLayer(root, crewCtx(), base);
const codes = (root: LayoutLayer): string[] => check(root).map((i) => i.code);

describe('grid_not_allowed', () => {
  it('on a Page root', () => {
    const issues = check({ ...layer('root', 'Page'), grid: at(1, 3, 1, 1) } as LayoutLayer, 'pages.1.layout');
    expect(issues).toEqual([{ path: 'pages.1.layout.grid', code: 'grid_not_allowed', message: GRID_NOT_ALLOWED_MESSAGE }]);
  });

  it('on a child of a flow Grid', () => {
    const issues = check(layer('root', 'Page', {}, [layer('g', 'Grid', {}, [text('t', at(1, 3, 1, 1))])]));
    expect(issues.map((i) => [i.path, i.code])).toEqual([['layer.children.0.children.0.grid', 'grid_not_allowed']]);
  });

  it('on a child of a Section', () => {
    expect(codes(layer('root', 'Page', {}, [layer('s', 'Section', {}, [text('t', at(1, 3, 1, 1))])]))).toEqual(['grid_not_allowed']);
  });

  it('on a menu slot layer', () => {
    const issues = checkLayer(text('t', at(1, 3, 1, 1)), crewCtx(), 'menu.start.0', 20, 'menu');
    expect(issues.map((i) => [i.path, i.code])).toEqual([['menu.start.0.grid', 'grid_not_allowed']]);
  });

  it('is not raised for a placed part checked alone', () => {
    expect(check(text('t', at(1, 3, 1, 1)))).toEqual([]);
  });

  it('is not raised for a child of a free Grid', () => {
    expect(codes(layer('root', 'Page', {}, [freeGrid([text('t', at(1, 3, 1, 1))], { rows: 1 })]))).toEqual([]);
  });
});

describe('grid_overlap', () => {
  it('flags the second child only, at its grid path', () => {
    const issues = check(freeGrid([text('a', at(1, 6, 1, 1)), text('b', at(6, 3, 1, 1)), text('c', at(7, 3, 1, 1))], { rows: 1 }));
    expect(issues.map((i) => [i.path, i.code, i.message])).toEqual([['layer.children.1.grid', 'grid_overlap', GRID_OVERLAP_MESSAGE]]);
  });

  it('touching places and unreadable blocks are fine', () => {
    expect(codes(freeGrid([text('a', at(1, 3, 1, 1)), text('b', at(4, 3, 1, 1)), text('c')], { rows: 1 }))).toEqual([]);
  });
});

describe('Grid props', () => {
  it('a valid free Grid passes', () => {
    expect(check(freeGrid([text('a', at(1, 3, 3, 1))]))).toEqual([]);
  });

  it('rows must reach the last covered row', () => {
    const issues = check(freeGrid([text('a', at(1, 3, 4, 2))], { rows: 3 }));
    expect(issues.map((i) => [i.path, i.code, i.message])).toEqual([
      ['layer.props.rows', 'invalid_props', 'Grid: rows must be at least 5, the last row its parts reach. Set rows to 5.'],
    ]);
  });

  it('a free Grid needs 12 columns', () => {
    const issues = check(freeGrid([], { columns: 2 }));
    expect(issues.map((i) => [i.path, i.message])).toEqual([['layer.props.columns', 'Grid: parts placed freely use 12 columns. Set columns to 12.']]);
    expect(check(layer('g', 'Grid', { placement: 'free', rows: 1 })).map((i) => i.path)).toEqual(['layer.props.columns']);
  });

  it('12 columns and rows need free placement', () => {
    expect(check(layer('g', 'Grid', { columns: 12 })).map((i) => i.message)).toEqual([
      'Grid: 12 columns only work when parts are placed freely. Use 1 to 4 columns, or set placement to free.',
    ]);
    expect(check(layer('g', 'Grid', { columns: 2, rows: 3 })).map((i) => i.message)).toEqual([
      'Grid: rows only work when parts are placed freely. Remove rows, or set placement to free.',
    ]);
  });

  it('range errors are zod errors', () => {
    expect(codes(layer('g', 'Grid', { placement: 'free', columns: 12, rows: 61 }))).toContain('invalid_props');
    expect(codes(layer('g', 'Grid', { placement: 'sideways' }))).toContain('invalid_props');
  });

  it('the helper-facing props stay exactly columns and gap', () => {
    const shape = gridDef.props(crewCtx()).shape;
    expect(Object.keys(shape)).toEqual(['columns', 'gap']);
    expect(gridDef.props(crewCtx()).parse({})).toEqual({ columns: 2, gap: 'md' });
    expect(gridDef.props(crewCtx()).safeParse({ placement: 'free' }).success).toBe(false);
    expect(Object.keys((gridDef.designProps?.(crewCtx()) ?? gridDef.props(crewCtx())).shape)).toEqual(['columns', 'gap', 'placement', 'rows']);
  });
});

describe('messages and copy rows', () => {
  it('equal joinSentence of their rows', () => {
    expect(GRID_NOT_ALLOWED_MESSAGE).toBe(joinSentence(String(ERROR_COPY.grid_not_allowed.sentence), ERROR_COPY.grid_not_allowed.action));
    expect(GRID_OVERLAP_MESSAGE).toBe(joinSentence(String(ERROR_COPY.grid_overlap.sentence), ERROR_COPY.grid_overlap.action));
  });
});
