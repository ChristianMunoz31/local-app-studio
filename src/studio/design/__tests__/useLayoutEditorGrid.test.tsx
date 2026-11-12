// useLayoutEditor keeps the free Grids consistent on every apply (DESIGN-phase21.md 6.7).
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { layer } from '@/catalog/__tests__/fixtures';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { findLayer, insertLayer, moveLayer } from '../../lib/layoutTree';
import { GRID_FULL_WORDS } from '../../lib/gridWords';
import { toFree } from '../../lib/gridLayout';
import { useLayoutEditor } from '../useLayoutEditor';

const at = (col: number, span: number, row: number, rowSpan: number): GridPlace => ({ col, span, row, rowSpan });
const text = (id: string, grid?: GridPlace): LayoutLayer => ({ ...layer(id, 'Text', {}, id), ...(grid === undefined ? {} : { grid }) });
const kidsOf = (root: LayoutLayer, id: string): LayoutLayer[] => (findLayer(root, id)?.layer.children as LayoutLayer[] | undefined) ?? [];

const START: LayoutLayer = layer('root', 'Page', {}, [
  layer('g', 'Grid', { placement: 'free', columns: 12, rows: 2 }, [text('a', at(1, 3, 1, 1)), text('b', at(4, 3, 2, 1))]),
  layer('s', 'Section', {}, []),
]);

describe('useLayoutEditor and the free Grid', () => {
  it('drops the place of a part moved out of the Grid and follows with rows', () => {
    const { result } = renderHook(() => useLayoutEditor(START));
    act(() => {
      result.current.apply(moveLayer(result.current.root, 'b', { parentId: 's', index: 0 }));
    });
    expect(findLayer(result.current.root, 'b')?.layer.grid).toBeUndefined();
    expect(findLayer(result.current.root, 'g')?.layer.props).toMatchObject({ rows: 1 });
    expect(result.current.canUndo).toBe(true);
  });

  it('gives a part moved into the Grid the next free cell', () => {
    const start = layer('root', 'Page', {}, [layer('g', 'Grid', { placement: 'free', columns: 12, rows: 1 }, [text('a', at(1, 3, 1, 1))]), layer('s', 'Section', {}, [text('c')])]);
    const { result } = renderHook(() => useLayoutEditor(start));
    act(() => {
      result.current.apply(moveLayer(result.current.root, 'c', { parentId: 'g', index: 1 }));
    });
    expect(findLayer(result.current.root, 'c')?.layer.grid).toEqual(at(4, 3, 1, 1));
  });

  it('syncs both trees of a pair result', () => {
    const { result } = renderHook(() => useLayoutEditor(START));
    act(() => {
      const moved = moveLayer(result.current.root, 'b', { parentId: 's', index: 0 });
      if (!moved.ok) throw new Error(moved.message);
      result.current.applyPair({ ok: true, page: moved.root, menu: result.current.menuRoot, focusId: 'b' });
    });
    expect(findLayer(result.current.root, 'b')?.layer.grid).toBeUndefined();
    expect(kidsOf(result.current.root, 'g').map((c) => c.id)).toEqual(['a']);
  });

  it('makes no history step for a result that changes nothing', () => {
    const { result } = renderHook(() => useLayoutEditor(START));
    act(() => {
      result.current.apply({ ok: true, root: result.current.root, focusId: 'a' });
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.changeCount()).toBe(0);
  });

  it('gives a Grid that went free its places in one step', () => {
    const flow = layer('root', 'Page', {}, [layer('g', 'Grid', { columns: 2 }, [text('a'), text('b')])]);
    const { result } = renderHook(() => useLayoutEditor(flow));
    act(() => {
      result.current.apply(toFree(result.current.root, 'g'));
    });
    expect(kidsOf(result.current.root, 'g').map((c) => c.grid)).toEqual([at(1, 6, 1, 1), at(7, 6, 1, 1)]);
    expect(result.current.changeCount()).toBe(1);
  });

  it('does not sync on reset (a loaded design is shown as stored)', () => {
    const { result } = renderHook(() => useLayoutEditor(layer('root', 'Page', {}, [])));
    const stored = layer('root', 'Page', {}, [layer('g', 'Grid', { placement: 'free', columns: 12, rows: 9 }, [text('a', at(1, 3, 1, 1))])]);
    act(() => {
      result.current.reset({ root: stored, menu: result.current.menuRoot, sources: [], tables: [] });
    });
    expect(result.current.root).toBe(stored);
  });

  it('refuses a part moved or inserted into a full Grid with the grid_full words and no history entry', () => {
    const rows = Array.from({ length: 60 }, (_, i) => text(`r${i}`, at(1, 12, i + 1, 1)));
    const full = layer('root', 'Page', {}, [layer('g', 'Grid', { placement: 'free', columns: 12, rows: 60 }, rows), layer('s', 'Section', {}, [text('c')])]);
    const { result } = renderHook(() => useLayoutEditor(full));
    let moveWords: string | null = null;
    let insertWords: string | null = null;
    act(() => {
      moveWords = result.current.apply(moveLayer(result.current.root, 'c', { parentId: 'g', index: 60 }));
      insertWords = result.current.apply(insertLayer(result.current.root, { parentId: 'g', index: 60 }, text('n')));
    });
    expect(moveWords).toBe(GRID_FULL_WORDS);
    expect(insertWords).toBe(GRID_FULL_WORDS);
    expect(result.current.root).toBe(full);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.changeCount()).toBe(0);
  });
});
