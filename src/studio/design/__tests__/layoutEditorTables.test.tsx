// The Design editor holds the draft tables beside the trees and sources: one apply with tables is one history entry.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LayoutLayer, Table } from '@local-app-studio/runtime/spec/schema';
import type { TreeResult } from '../../lib/layoutTree';
import type { Source } from '../../lib/bindOnDrop';
import { useLayoutEditor } from '../useLayoutEditor';

const page = (children: LayoutLayer[] = []): LayoutLayer => ({ id: 'root_home', type: 'Page', props: {}, children });
const crews: Table = { id: 'crews', label: 'Crews', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] };
const list: Source = { id: 'all_crews', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 };
const table = (root: LayoutLayer): TreeResult => ({ ok: true, root, focusId: 'root_home' });

describe('useLayoutEditor tables', () => {
  it('starts with the tables it is given, and the load is not a step', () => {
    const { result } = renderHook(() => useLayoutEditor(page(), undefined, [], [crews]));
    expect(result.current.tables).toEqual([crews]);
    expect(result.current.canUndo).toBe(false);
  });

  it('applies the root, the sources and the tables as one history entry, and Undo and Redo bring all three back', () => {
    const { result } = renderHook(() => useLayoutEditor(page(), undefined, [], []));
    const before = result.current.root;
    const next = page([{ id: 'table_1', type: 'DataTable', props: { source: 'all_crews' }, children: [] }]);
    act(() => {
      expect(result.current.apply(table(next), 'page', [list], [crews])).toBeNull();
    });
    expect(result.current.root).toBe(next);
    expect(result.current.sources).toEqual([list]);
    expect(result.current.tables).toEqual([crews]);
    act(() => result.current.undo());
    expect(result.current.root).toBe(before);
    expect(result.current.sources).toEqual([]);
    expect(result.current.tables).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.root).toBe(next);
    expect(result.current.sources).toEqual([list]);
    expect(result.current.tables).toEqual([crews]);
  });

  it('keeps the current tables when an apply leaves them out', () => {
    const { result } = renderHook(() => useLayoutEditor(page(), undefined, [], [crews]));
    act(() => {
      result.current.apply(table(page([{ id: 'divider_1', type: 'Divider', props: {}, children: [] }])));
    });
    expect(result.current.tables).toEqual([crews]);
    act(() => result.current.undo());
    expect(result.current.tables).toEqual([crews]);
  });

  it('a change of only the tables is an entry of its own', () => {
    const { result } = renderHook(() => useLayoutEditor(page(), undefined, [], []));
    act(() => {
      result.current.apply(table(result.current.root), 'page', undefined, [crews]);
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.tables).toEqual([crews]);
  });

  it('reset puts the tables back and clears the history', () => {
    const { result } = renderHook(() => useLayoutEditor(page(), undefined, [], []));
    act(() => {
      result.current.apply(table(page()), 'page', [list], [crews]);
    });
    act(() => result.current.reset({ root: page(), menu: result.current.menuRoot, sources: [], tables: [] }));
    expect(result.current.tables).toEqual([]);
    expect(result.current.sources).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
