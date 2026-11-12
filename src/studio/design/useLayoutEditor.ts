// The layout trees of one page and of the app menu bar, with one undo and redo history for both. The trees change only through
// apply() and applyPair(), which take the result of a layoutTree.ts or menuTree.ts helper: a refusal changes nothing and comes back as
// a message in plain words. One applied result is one history entry, also when it moves a part between the page and the menu.
import { useCallback, useRef, useState } from 'react';
import type { LayoutLayer, Table } from '@local-app-studio/runtime/spec/schema';
import type { Source } from '../lib/bindOnDrop';
import { gotNoCell, syncGrids } from '../lib/gridLayout';
import { GRID_FULL_WORDS } from '../lib/gridWords';
import { findLayer } from '../lib/layoutTree';
import type { TreeResult } from '../lib/layoutTree';
import { menuTreeOf } from '../lib/menuTree';
import type { PairResult } from '../lib/menuTree';

export const HISTORY_LIMIT = 50;

export type TreeName = 'page' | 'menu';

/** What one history entry holds: both trees, the sources of the page and the tables (a list or table made on drop is one step with its part). */
export interface Doc {
  root: LayoutLayer;
  menu: LayoutLayer;
  sources: Source[];
  tables: Table[];
}

interface Selection {
  tree: TreeName;
  id: string;
}

/** One step of the history: the document on the other side of the step, and what the step did in words ("moved Tabs down"). */
interface Entry {
  doc: Doc;
  label: string;
}

interface State extends Doc {
  past: Entry[];
  future: Entry[];
  selected: Selection | null;
}

/** The words of a step that was applied without a label of its own. */
export const DEFAULT_LABEL = 'the last change';

export interface LayoutEditor {
  root: LayoutLayer;
  /** The menu bar's tree (the bar over its two slots). */
  menuRoot: LayoutLayer;
  /** The draft sources of the page. */
  sources: Source[];
  /** The draft tables of the app. */
  tables: Table[];
  /** The selected layer of the page, null when nothing or a part of the menu is selected. */
  selectedId: string | null;
  /** The selected layer of the menu bar, null when nothing or a part of the page is selected. */
  selectedMenuId: string | null;
  select(id: string | null, tree?: TreeName): void;
  /** Applies a result to one tree (the page by default), with the page's next sources and the next tables when the result also changed them (each one left out keeps its current value). `label` says what the step did, in lower case without a full stop ("moved Tabs down"): Undo and Redo repeat it. Returns the refusal message, or null when it was applied (or changed nothing). */
  apply(result: TreeResult, tree?: TreeName, sources?: Source[], tables?: Table[], label?: string): string | null;
  /** Applies a result that changed both trees (a part moved between the page and the menu bar). */
  applyPair(result: PairResult, label?: string): string | null;
  /** Gives the newest history step another label (the words said after a step that was applied with a generic one). */
  relabel(label: string): void;
  /** How many steps were put in the history so far: it changes when, and only when, an apply made a new step. */
  changeCount(): number;
  /** Puts both trees, the sources and the tables back to a saved document and clears the history (Discard). */
  reset(doc: Doc): void;
  /** Steps back; returns what the undone step did (its label), or null when there was nothing to undo. */
  undo(): string | null;
  /** Steps forward; returns what the redone step did, or null when there was nothing to redo. */
  redo(): string | null;
  canUndo: boolean;
  canRedo: boolean;
}

const sameDoc = (a: Doc, b: Doc): boolean => a.root === b.root && a.menu === b.menu && a.sources === b.sources && a.tables === b.tables;

/** The initial load is not an undo step. */
export function useLayoutEditor(initial: LayoutLayer, initialMenu?: LayoutLayer, initialSources: Source[] = [], initialTables: Table[] = []): LayoutEditor {
  const [state, setState] = useState<State>(() => ({ root: initial, menu: initialMenu ?? menuTreeOf(null), sources: initialSources, tables: initialTables, past: [], future: [], selected: null }));
  // Handlers read the latest state here, so two calls in one event see each other's result.
  const latest = useRef(state);
  const changes = useRef(0);
  const commit = useCallback((next: State): void => {
    latest.current = next;
    setState(next);
  }, []);

  const select = useCallback(
    (id: string | null, tree: TreeName = 'page'): void => commit({ ...latest.current, selected: id === null ? null : { tree, id } }),
    [commit],
  );

  /** One entry for a changed document, none for the same one; the selection goes to `focus`. */
  const change = useCallback(
    (doc: Doc, focus: Selection, label: string): void => {
      const cur = latest.current;
      if (sameDoc(doc, cur)) {
        commit({ ...cur, selected: focus });
        return;
      }
      changes.current += 1;
      commit({ ...doc, past: [...cur.past, { doc: { root: cur.root, menu: cur.menu, sources: cur.sources, tables: cur.tables }, label }].slice(-HISTORY_LIMIT), future: [], selected: focus });
    },
    [commit],
  );

  const apply = useCallback(
    (result: TreeResult, tree: TreeName = 'page', sources?: Source[], tables?: Table[], label = DEFAULT_LABEL): string | null => {
      if (!result.ok) return result.message;
      const cur = latest.current;
      const nextSources = sources ?? cur.sources;
      const nextTables = tables ?? cur.tables;
      // syncGrids keeps the free Grids consistent whatever the edit was (a part moved out loses its place, one moved in gets a cell).
      const next = syncGrids(result.root);
      // A part added to a free Grid with no 3x1 cell left would sit unplaced: refuse it in words, with no history entry.
      if (gotNoCell(tree === 'menu' ? cur.menu : cur.root, next)) return GRID_FULL_WORDS;
      change(
        tree === 'menu' ? { root: cur.root, menu: next, sources: nextSources, tables: nextTables } : { root: next, menu: cur.menu, sources: nextSources, tables: nextTables },
        { tree, id: result.focusId },
        label,
      );
      return null;
    },
    [change],
  );

  const applyPair = useCallback(
    (result: PairResult, label = DEFAULT_LABEL): string | null => {
      if (!result.ok) return result.message;
      // The part now sits in the tree that holds its new id.
      const tree: TreeName = findLayer(result.menu, result.focusId) !== null && findLayer(result.page, result.focusId) === null ? 'menu' : 'page';
      const cur = latest.current;
      const page = syncGrids(result.page);
      const menu = syncGrids(result.menu);
      if (gotNoCell(cur.root, page) || gotNoCell(cur.menu, menu)) return GRID_FULL_WORDS;
      change({ root: page, menu, sources: latest.current.sources, tables: latest.current.tables }, { tree, id: result.focusId }, label);
      return null;
    },
    [change],
  );

  const step = useCallback(
    (direction: 'undo' | 'redo'): string | null => {
      const cur = latest.current;
      const from = direction === 'undo' ? cur.past : cur.future;
      if (from.length === 0) return null;
      const entry = from[from.length - 1];
      const target = entry.doc;
      const rest = from.slice(0, -1);
      const sel = cur.selected;
      const kept = sel !== null && findLayer(sel.tree === 'menu' ? target.menu : target.root, sel.id) !== null ? sel : null;
      const now: Entry = { doc: { root: cur.root, menu: cur.menu, sources: cur.sources, tables: cur.tables }, label: entry.label };
      commit(
        direction === 'undo'
          ? { ...target, past: rest, future: [...cur.future, now], selected: kept }
          : { ...target, past: [...cur.past, now].slice(-HISTORY_LIMIT), future: rest, selected: kept },
      );
      return entry.label;
    },
    [commit],
  );
  const relabel = useCallback(
    (label: string): void => {
      const cur = latest.current;
      if (cur.past.length === 0) return;
      commit({ ...cur, past: [...cur.past.slice(0, -1), { ...cur.past[cur.past.length - 1], label }] });
    },
    [commit],
  );
  const changeCount = useCallback((): number => changes.current, []);
  const reset = useCallback((doc: Doc): void => commit({ ...doc, past: [], future: [], selected: null }), [commit]);
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  const { selected } = state;
  return {
    root: state.root,
    menuRoot: state.menu,
    sources: state.sources,
    tables: state.tables,
    selectedId: selected !== null && selected.tree === 'page' ? selected.id : null,
    selectedMenuId: selected !== null && selected.tree === 'menu' ? selected.id : null,
    select,
    apply,
    applyPair,
    relabel,
    changeCount,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
