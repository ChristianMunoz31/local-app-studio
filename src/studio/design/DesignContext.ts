// What the canvas, its blocks, drop zones and the settings popover share. One provider (DesignSession), no store.
import { createContext, useContext } from 'react';
import type { CatalogData } from '@/catalog/context';
import type { FeatureLibrary } from '@/catalog/features';
import type { PartContext } from '@/catalog/types';
import type { AppSpec, LayoutLayer, Page, Table } from '@local-app-studio/runtime/spec/schema';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayerSizing } from '@local-app-studio/runtime/spec/sizing';
import type { ConnectChoice, Source } from '../lib/bindOnDrop';
import type { DropTarget, SideTarget, TreeResult } from '../lib/layoutTree';

/** Which tree a scope edits: the page, or the app menu bar above or beside it. */
export type Tree = 'page' | 'menu';

export interface DragInfo {
  /** The part type being dragged. */
  type: string;
  /** The layer being moved, or null for a new part from the shelf. */
  movingId: string | null;
  /** The tree the moved layer comes from; 'page' for a new part. */
  tree: Tree;
  /** Why the menu bar refuses this drag whatever the place, or null/absent when it is not refused for a reason of its own. */
  refusal?: string | null;
}

/** A place chosen with "Add here": the tree it is in is carried, because layer ids are unique only within one tree. */
export interface PlacedTarget extends DropTarget {
  tree: Tree;
}

/** "Beside" was pressed on a block: the next part picked on the shelf goes to its right, with the side drop widths. */
export interface BesideTarget {
  kind: 'side';
  tree: Tree;
  targetId: string;
  side: 'right';
}

/** What waits for a pick on the shelf: a place chosen with "Add here", or a block chosen with "Beside". */
export type Pending = PlacedTarget | BesideTarget;

/** What the New table or Add a field dialog was asked for: the part it is for, and for a field the table, the setting and the pending choice. */
export type TableRequest =
  | { kind: 'new_table'; layerId: string }
  | { kind: 'add_field'; layerId: string; table: string | null; target: string | null; choice: ConnectChoice | null };

/** Where a drag over a free Grid would land: the cells the part would take and whether they are free. */
export interface GridHover {
  gridId: string;
  place: GridPlace;
  free: boolean;
}

/** While a grid resize handle is dragged: the place drawn for that part. */
export interface GridPreview {
  gridId: string;
  id: string;
  place: GridPlace;
}

/** How a grid message is shown and spoken: see announceGrid. */
export type GridSpeechKind = 'step' | 'quiet' | 'refusal';

/** A place in the other tree a block can move to, with its plain name ("Menu bar, left, place 1"). */
export interface CrossPlace {
  tree: Tree;
  at: DropTarget;
  label: string;
}

/**
 * One scope of the session. The page scope is `useDesign()` on the page canvas; its `menu` member is the menu bar's scope (same
 * shape, `root` the menu tree, `ctx` the menu's context, `tree` 'menu'), which MenuCanvas provides to the blocks in the bar.
 */
export interface DesignContextValue {
  /** The tree this scope edits. */
  tree: Tree;
  /** The menu bar's scope while the bar is on, else null. Null inside the menu scope itself. */
  menu: DesignContextValue | null;
  /** Where the menu sits ('top' or 'side'); the zones of its parts are bars or lines by it. */
  menuPosition: 'top' | 'side';
  root: LayoutLayer;
  spec: AppSpec;
  page: Page;
  ctx: PartContext;
  library: FeatureLibrary;
  data: CatalogData;
  selectedId: string | null;
  select(id: string | null): void;
  drag: DragInfo | null;
  /** While dragging: the places that accept the dragged part, as "parentId:index". */
  zones: ReadonlySet<string>;
  /** While dragging: the sides of blocks that accept the dragged part, as sideKey(targetId, side). */
  sideZones: ReadonlySet<string>;
  /** While the resize handle is dragged: the widths the canvas shows for the pair (the tree changes on release). */
  resizing: { leftId: string; rightId: string; left: LayerSizing; right: LayerSizing } | null;
  previewResize(p: DesignContextValue['resizing']): void;
  /** While dragging: the free Grids that accept the dragged part (page tree only). */
  gridZones: ReadonlySet<string>;
  /** While dragging over a free Grid: the cells the part would take and whether they are free. */
  gridHover: GridHover | null;
  /** While a grid resize handle is dragged: the place drawn for that part (the tree changes on release). */
  gridPreview: GridPreview | null;
  previewGrid(p: GridPreview | null): void;
  /**
   * The one way grid keys, grid handles and Place report. 'step': shown in the status line with Undo and spoken politely
   * GRID_SPEAK_DELAY_MS after the last step, so a held key speaks only the final place. 'quiet': shown with Undo, not spoken
   * (a move that re-sorted the DOM: the refocused block's description says the new place). 'refusal': shown as a problem and
   * spoken at once through the alert region; an identical refusal is spoken again. Words are used as given.
   */
  announceGrid(message: string, kind: GridSpeechKind): void;
  /** The place chosen with "Add here" (or the block chosen with "Beside"), waiting for a pick on the shelf. */
  pending: Pending | null;
  addHere(target: DropTarget): void;
  /** Puts the next part picked on the shelf beside this block (to its right). */
  beside(targetId: string): void;
  settingsId: string | null;
  /** Opens the settings of a block; `focus` names the control that gets the focus first ("props.source" or "props.table"). */
  openSettings(id: string | null, focus?: string): void;
  /** The control the open settings start on, or null for the first one. */
  settingsFocus: string | null;
  /** The app being designed (keys for what Design keeps in this browser). */
  appId: string;
  /** Applies a tree result, with the page's next sources and the draft tables when the result also changed them. Returns the refusal message or null. */
  apply(result: TreeResult, sources?: Source[], tables?: Table[]): string | null;
  /** Opens the New table or Add a field dialog for a part of the page. */
  askTable(req: TableRequest): void;
  /** Reports a refusal or a short result to the status line. */
  tell(message: string, undo?: boolean): void;
  /** Asks for the keyboard focus to go to a block after the next render (in this scope's tree). */
  focusBlock(id: string): void;
  remove(id: string): void;
  move(id: string, delta: -1 | 1): void;
  /** The places in the other tree the block may move to (Move to...): menu places from the page, page places from the menu. Empty without a menu bar. */
  otherPlaces(type: string, movingId: string): CrossPlace[];
  /** Moves a block to a place in the other tree, as one Undo step, and tells it in the status line. */
  moveAcross(id: string, to: CrossPlace): void;
  /** Set only by the Feature builder host (section 4): connected parts read "Uses slot <Label>", the shelf has no Look tab and hides what a feature cannot hold. */
  builder?: { hidesEntry(key: string): boolean };
}

export const DesignContext = createContext<DesignContextValue | null>(null);

export function useDesign(): DesignContextValue {
  const value = useContext(DesignContext);
  if (value === null) throw new Error('useDesign needs a DesignContext provider.');
  return value;
}

export const zoneKey = (parentId: string, index: number): string => `${parentId}:${index}`;
export const sideKey = (targetId: string, side: SideTarget['side']): string => `side:${targetId}:${side}`;
