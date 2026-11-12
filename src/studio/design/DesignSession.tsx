// One Design session: a page's layout in memory with undo and redo, the draft look, the shelf, the canvas and the drag and
// drop between them. Nothing reaches the server until Save (or until the person moves on: the tab registers the draft's save with
// the workspace, which saves before any move). The tab remounts this when the page or its context changes.
import { DndContext, DragOverlay, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors } from '@dnd-kit/core';
import type { Active, CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent, Over } from '@dnd-kit/core';
import { PanelLeftClose, PanelLeftOpen, Redo2, Undo2 } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { btnSecondary } from '@/components/shared/formStyles.js';
import CanvasFrame from '../components/CanvasFrame';
import type { CatalogData, CatalogDataSource } from '@/catalog/context';
import { getPartDefinition } from '@/catalog/definitions';
import { checkLayer, menuPartContext, partContextFor } from '@/catalog/validateLayout';
import type { GridCell } from '@local-app-studio/runtime/spec/gridPlacement';
import type { FeatureDefinition, FeatureLibrary } from '@/catalog/features';
import type { AppSpec, Field, FieldType, LayoutLayer, Menu, Page, SpecIssue, Table, Theme } from '@local-app-studio/runtime/spec/schema';
import { FOCUS_RING, HINT_CLASS, NOTICE_CLASS, POPOVER_CLASS, PROBLEM_NOTICE_CLASS } from '../components/ui';
import { useDraftStore } from '../hooks/useDraftStore';
import { useStepChrome } from '../hooks/useStepChrome';
import { asDesignDraft, DRAFT_RESTORED } from '../lib/draftPayload';
import { DRAFT_DISCARD, DRAFT_RESTORE } from '../lib/draftStore';
import type { SaveOutcome, StepDraft } from '../hooks/useStepChrome';
import StudioConfirm from '../components/StudioConfirm';
import { dataBindOf, tablePreference } from '../lib/bindChoice';
import { REMOVE_DATA, dataRemovals } from '../lib/dataRemovals';
import { fieldNeedsOf, newTableDraft } from '../lib/partFields';
import { connectToNewTable, connectWithNewField, connectedTableOf, offerFor, planDrop, withPageSources } from '../lib/bindOnDrop';
import type { ConnectOffer, Source } from '../lib/bindOnDrop';
import { featureTableDraft, needsNewTable, placeFeatureOnNewTable } from '../lib/featureOnDrop';
import { withOwnWords } from '../lib/featureWords';
import { dropUnusedLists, settleOnFirstTable } from '../lib/featureFromSelection';
import { sampleDataSource } from '../lib/sampleDataSource';
import type { SampleRecords } from '../lib/sampleData';
import { dropPlace, gridDropIds, insertAtCell, isFreeGrid, moveToCell, placeOf } from '../lib/gridLayout';
import { addedLabel as addedAtLabel, gridPlaceName, movedLabel } from '../lib/gridWords';
import { insertionTarget, layerIds, toLayoutLayer } from '../lib/layout';
import { readSizing } from '@local-app-studio/runtime/spec/sizing';
import {
  autoValues,
  dropTargets,
  findLayer,
  insertBeside,
  insertLayer,
  moveBeside,
  moveBy,
  moveLayer,
  newFeatureLayer,
  removeLayer,
  replaceLayer,
  sideTargets,
} from '../lib/layoutTree';
import type { DropTarget, SideTarget, TreeResult } from '../lib/layoutTree';
import {
  MENU_FEATURE_REFUSAL,
  MENU_SLOT_IDS,
  adaptForPlace,
  composeMenu,
  menuSubtreeProblem,
  menuTreeOf,
  newMenuLayer,
  slotsOfTree,
  transferLayer,
} from '../lib/menuTree';
import { plainIssue, plainMessage } from '../lib/issueWords';
import { widthPhrase } from '../lib/sizingWords';
import { countMenuLayers } from '../lib/specSummary';
import { stableJson } from '../lib/stableJson';
import { recordRecent } from '../showcase/recent';
import { sampleBackedRows } from '../showcase/samples';
import { CONFLICT_MESSAGE } from '../types';
import type { FeatureRecord, SaveResult } from '../types';
import type { ShowcaseEntry } from '../showcase/entries';
import { offerWordsFor } from './offerWords';
import ConnectionIssues from './ConnectionIssues';
import WaysInLine from './WaysInLine';
import { fixAllConnections, fixAllLabel, fixAllOutcome } from '../lib/fixAllConnections';
import { addWaysIn, waysIn, waysInLabel, waysInOutcome } from '../lib/waysIn';
import { connectionIssues, connectionOf } from './connections';
import { blockName, needsWords, tableLabel } from './designLabels';
import { DRAG_INSTRUCTIONS, dragAnnouncements } from './dragWords';
import type { DragPlace } from './dragWords';
import { DesignContext, sideKey, zoneKey } from './DesignContext';
import type { CrossPlace, DesignContextValue, DragInfo, GridHover, GridSpeechKind, Pending, TableRequest, Tree } from './DesignContext';
import DesignCanvas from './DesignCanvas';
import { cellAt, measureGrid } from './gridMetrics';
import type { GridMetrics } from './gridMetrics';
import { useGridSpeech } from './useGridSpeech';
import type { NewTableDialogProps } from './NewTableDialog';
import { useViewMode } from '../theme/viewMode';
import FeatureShelf from './FeatureShelf';
import { useShelfFold } from './shelfFold';
import MenuPicker from './MenuPicker';
import { readKept, writeKept } from './keptConnections';
import { shelfEntries } from './shelfEntries';
import type { ShelfFilters, ShelfTab } from './FeatureShelf';
import { firstFieldChoice, hasFieldChoice } from './settingsModel';
import { useLayoutEditor } from './useLayoutEditor';
import { REDID, UNDID, addedLabel, historyLine, labelOf, sentenceOf } from './designWords';
import { placeNumber } from './movePlaces';
import type { Doc } from './useLayoutEditor';

const SaveFeatureDialog = lazy(() => import('../components/SaveFeatureDialog'));
const NewTableDialog = lazy(() => import('./NewTableDialog'));
const AddFieldDialog = lazy(() => import('./AddFieldDialog'));

const SAVE_HINT = 'Connect the parts that need a table, or delete them, to save.';
const NEXT_HINT = 'Connect the parts that need a table, or delete them, before you move on.';
const SAVE_FEATURE_FIRST = 'Select a part on the page first, then press Save as feature.';
const EMPTY_PAGE_HINT = 'Add parts from the shelf: drag one onto the page, or press its Add button.';
const LIVE_MARK_MS = 300;
/** A problem path that names the table or list of a part. */
const STALE_REF_PATH = /\.props\.(source|table)$/;
const NOTHING_TO_SAVE = 'Nothing to save.';
/** A modal dialog or alert dialog on screen: the session's keys wait for it. The settings popover is a dialog too, but not modal, so it does not count. */
const MODAL_OPEN = '[aria-modal="true"], [role="alertdialog"]';
const PREVIEW_API = '/api/preview';

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string; issues: SpecIssue[] };

/** What a session holds that a save sends: the page, its sources, the tables, the look and the menu bar. */
interface Working {
  root: LayoutLayer;
  sources: Source[];
  tables: Table[];
  theme: Theme;
  menu: Menu | null;
  menuRoot: LayoutLayer;
}
/** The same, as text, to compare with what is saved. */
interface Snapshot {
  layout: string;
  sources: string;
  tables: string;
  theme: string;
  menu: string;
}
const snapshotOf = (w: Working): Snapshot => ({
  layout: stableJson(w.root),
  sources: stableJson(w.sources),
  tables: stableJson(w.tables),
  theme: stableJson(w.theme),
  menu: stableJson(composeMenu(w.menu, w.menuRoot) ?? null),
});
/** The app with the working copy put into it (the page being edited, the tables, the look and the menu bar). */
function specOfWorking(from: AppSpec, now: Working, pageId: string): AppSpec {
  const layout = toLayoutLayer(now.root);
  const updated: AppSpec = { ...from, tables: now.tables, theme: now.theme, pages: from.pages.map((p) => (p.id === pageId ? { ...p, layout, sources: now.sources } : p)) };
  // No menu bar is the absence of the key (Classic), never a null; the parts on the bar are saved with its look.
  const composed = composeMenu(now.menu, now.menuRoot);
  if (composed === undefined) delete updated.menu;
  else updated.menu = composed;
  return updated;
}
const sameSnapshot = (a: Snapshot, b: Snapshot): boolean => a.layout === b.layout && a.sources === b.sources && a.tables === b.tables && a.theme === b.theme && a.menu === b.menu;
/** The "Save and remove data?" question, asked from inside a save: answer(true) lets it go on, `finished` settles when it is over. */
interface PendingSave {
  sentences: string[];
  answer(yes: boolean): void;
  finished: Promise<void>;
}
interface Notice {
  text: string;
  undo: boolean;
  /** Shows Redo in the line (after an Undo). */
  redo?: boolean;
  problem: boolean;
  /** Not spoken by the workspace announcer: the drag announcements already said it. */
  silent?: boolean;
}

/** How a step is worded: its label (lower case, no full stop) and whether the drag announcements already spoke it. */
interface Say {
  label?: string;
  silent?: boolean;
}

const isGridBox = (id: string | number): boolean => String(id).startsWith('grid:');

/**
 * Pointer position first (the zone under the cursor), the nearest zone otherwise. The box of a free Grid covers the whole Grid, so
 * a zone inside a part on the grid, or the Page zone at the Grid's edge, wins over it; the nearest-zone fallback ignores it.
 */
const collide: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) {
    const inner = within.filter((hit) => !isGridBox(hit.id));
    return inner.length > 0 ? inner : within;
  }
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => !isGridBox(c.id)) });
};

/** The refusals of a pointer drop or resize on a free Grid: spoken at once through the alert region. */
const GRID_REASONS: ReadonlySet<string> = new Set(['grid_overlap', 'grid_edge', 'grid_full', 'not_free']);

const EMPTY_ZONES: ReadonlySet<string> = new Set<string>();

interface OverData {
  kind?: 'side' | 'refuse' | 'grid';
  gridId?: string;
  parentId?: string;
  index?: number;
  tree?: Tree;
  targetId?: string;
  side?: SideTarget['side'];
}

/** True when the layout holds a built-in data part or a feature (its parts show rows): the canvas then says which rows it shows. */
function showsData(layer: LayoutLayer): boolean {
  if (layer.feature !== undefined) return true;
  const def = getPartDefinition(layer.type);
  if (def !== undefined && dataBindOf(def) !== null) return true;
  return Array.isArray(layer.children) && layer.children.some(showsData);
}

/** The layer a problem path points into (`pages.N.layout.children.i...`), or null. */
function layerAtPath(root: LayoutLayer, base: string, path: string): LayoutLayer | null {
  if (!path.startsWith(base)) return null;
  const rest = path.slice(base.length).split('.').filter((part) => part !== '');
  let layer = root;
  for (let i = 0; i + 1 < rest.length && rest[i] === 'children'; i += 2) {
    const next = Array.isArray(layer.children) ? layer.children[Number(rest[i + 1])] : undefined;
    if (next === undefined) return null;
    layer = next;
  }
  return layer;
}

/** What the status line says after a drop that left a part not connected with an offer. */
function offerNotice(offer: ConnectOffer, part: string, builder: boolean): string {
  if (offer.kind === 'full') return offerWordsFor(offer, builder);
  const newTable = builder ? 'Add a table slot' : 'New table';
  const press = offer.kind === 'no_field' && offer.tables.length > 0 ? `Add a field or ${newTable}` : newTable;
  return `${offerWordsFor(offer, builder)} Press ${press} on the ${part}.`;
}

/** A problem sentence in plain words, or null. */
const SAVE_THROWN = 'Could not save. Your changes are still here. Try again.';
const plainOrNull = (message: string | null): string | null => (message === null ? null : plainMessage(message));

const isTyping = (target: EventTarget): boolean => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** What a host sees of the session's document: the page layout, its lists and the tables (the bench of the Feature builder). */
export interface HostDoc {
  root: LayoutLayer;
  sources: Source[];
  tables: Table[];
}
/** Applies a change to the session's doc as one Undo step labelled `label`; returns the refusal in plain words or null. A `make` that returns null changes nothing. */
export type HostEdit = (make: (doc: HostDoc) => HostDoc | null, label: string) => string | null;

/** A screen that uses the session for something other than an app page (the Feature builder, section 4 of DESIGN-phase16.md). */
export interface DesignHost {
  kind: 'feature';
  /** Shown at the right end of the toolbar instead of Save as feature and Save. */
  toolbarEnd: ReactNode;
  /** The slot panel: a third column from 1280 px, below the canvas from 1024 to 1279 px, after the canvas under 1024 px. */
  aside: ReactNode;
  /** What New table opens here (Add a table slot). Same props as NewTableDialog. */
  NewTableDialog: ComponentType<NewTableDialogProps>;
  /** Words of the Add a field dialog here. */
  addFieldWords: { title: string; submit: string };
  /** The shelf rule (DesignContext.builder.hidesEntry). */
  hidesEntry(key: string): boolean;
  /** Said when Ctrl+S is pressed while a part is not connected. */
  blockedWords: string;
  /** Ctrl+S and the host's Save button end here instead of the workspace save; ok marks the session clean. */
  save(next: AppSpec): Promise<SaveOutcome>;
  /** Receives the session's edit function when it mounts, and null when it goes. */
  bindEdit(edit: HostEdit | null): void;
  /** Receives the document when the session mounts and after every change to it. */
  onDoc(doc: HostDoc): void;
}

/** A feature that was dropped where no table fits: New table is open for it. */
interface FeatureAsk {
  entry: ShowcaseEntry;
  at: DropTarget | SideTarget;
  byKeyboard: boolean;
}

export interface DesignSessionProps {
  spec: AppSpec;
  /** The revision of `spec`. */
  revision: number;
  page: Page;
  pageIndex: number;
  /** The app being designed: what Design keeps in this browser (kept connections) is keyed by it. */
  appId: string;
  /** The key the unsaved draft is kept under, when it is not `appId` (the Feature builder moves it once the feature has a record). */
  draftKey?: string;
  /** Opens another page in the Design step (the Data connections list). */
  onShowPage(pageId: string): void;
  features: readonly FeatureRecord[];
  library: FeatureLibrary;
  reloadFeatures(): Promise<void>;
  /** Rows of the running preview, read only; without it the canvas shows sample rows. */
  liveSource: CatalogDataSource | undefined;
  /** The example records stored with the app, shown when Preview shows no rows; null when it has none. */
  sample?: SampleRecords | null;
  onDirty(dirty: boolean): void;
  /** The session's draft for the workspace (its save and why it is blocked), or null when the session goes away. */
  onDraft(draft: StepDraft | null): void;
  /** Called when a newer record arrived from elsewhere and the session holds no unsaved edit: the tab starts the session again from it. */
  onStale(): void;
  /** The workspace save: the session passes the revision of the spec its draft is based on. */
  save(next: AppSpec, opts: { baseRevision: number }): Promise<SaveResult>;
  /** The shelf tab the session starts on (Change look opens the Look tab). */
  initialTab: ShelfTab;
  /** The showcase tile the user came with (Use in app). Unknown keys are ignored. */
  addEntryKey: string | null;
  /** The page picker and the page actions. */
  toolbarStart: ReactNode;
  /** Set by the Feature builder: the session then edits the bench and ends in the host's save. */
  host?: DesignHost;
}

export default function DesignSession({
  spec,
  revision,
  page,
  pageIndex,
  appId,
  draftKey,
  onShowPage,
  features,
  library,
  reloadFeatures,
  liveSource,
  sample = null,
  onDirty,
  onDraft,
  onStale,
  save,
  initialTab,
  addEntryKey,
  toolbarStart,
  host,
}: DesignSessionProps) {
  const [initial] = useState<LayoutLayer>(page.layout);
  const [initialMenu] = useState<LayoutLayer>(() => menuTreeOf(spec.menu ?? null));
  const [initialSources] = useState<Source[]>(page.sources);
  const [initialTables] = useState<Table[]>(spec.tables);
  const editor = useLayoutEditor(initial, initialMenu, initialSources, initialTables);
  const { root, menuRoot, selectedId, selectedMenuId, sources, tables } = editor;
  const [theme, setTheme] = useState<Theme>(spec.theme);
  const view = useViewMode(appId, theme);
  const shelf = useShelfFold(appId);
  const { setFolded: setShelfFolded } = shelf;
  // The look of the bar (position and style); the parts on it live in the menu tree and are put back together by composeMenu.
  const [menu, setMenu] = useState<Menu | null>(spec.menu ?? null);
  const [saved, setSaved] = useState<Snapshot>(() => snapshotOf({ root: initial, sources: initialSources, tables: initialTables, theme: spec.theme, menu: spec.menu ?? null, menuRoot: initialMenu }));
  // The same as `saved`, for isDirty() and for saves: read at once, also after the session has gone.
  const savedSnap = useRef<Snapshot>(saved);
  // Lists a feature placement added: dropped again when the feature's settings move to another table and nothing reads them (L-15).
  const featureLists = useRef(new Set<string>());
  // The spec this session was loaded from, with its revision. Only its own saves move it on; a save reads it when it runs. A newer
  // record from elsewhere never changes it: a clean session is started again from that record (onStale, below), and a session with
  // unsaved edits keeps its base, so its next save gets a conflict and says so, and never overwrites the other change.
  const base = useRef<{ revision: number; spec: AppSpec }>({ revision, spec });
  // False once the session has gone: the save the shell runs for a draft it kept (a move it could not hold back, such as the command
  // palette) works from the values it captured and must not set state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // What the last save (or the load) put on the server: Discard goes back to it.
  const savedDoc = useRef<Doc>({ root: initial, menu: initialMenu, sources: initialSources, tables: initialTables });
  const savedLook = useRef<{ theme: Theme; menu: Menu | null }>({ theme: spec.theme, menu: spec.menu ?? null });
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [marks, setMarks] = useState<SpecIssue[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null);
  const [kept, setKept] = useState<ReadonlySet<string>>(() => readKept(appId));
  const [drag, setDrag] = useState<(DragInfo & { label: string; fromFeature?: boolean }) | null>(null);
  const [resizing, setResizing] = useState<DesignContextValue['resizing']>(null);
  const [gridPreview, setGridPreview] = useState<DesignContextValue['gridPreview']>(null);
  const [gridHover, setGridHover] = useState<GridHover | null>(null);
  const [shelfTab, setShelfTab] = useState<ShelfTab>(initialTab);
  const [filters, setFilters] = useState<ShelfFilters>({ category: 'all', query: '' });
  const [filtersTouched, setFiltersTouched] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(addEntryKey);
  const hintId = useId();
  const { announce, go } = useStepChrome();
  const hostRef = useRef(host);
  useLayoutEffect(() => {
    hostRef.current = host;
  });
  const announceRef = useRef(announce);
  // What the grid says: step words after a quiet moment, refusals at once through a role="alert" line (useGridSpeech.ts).
  const gridSpeech = useGridSpeech((text) => announceRef.current(text));
  const { step: speechStep, refusal: speechRefusal, cancel: speechCancel } = gridSpeech;
  const lastSearchTick = useRef(0);
  const lastPending = useRef<Pending | null>(null);
  const [introDismissed, setIntroDismissed] = useState(false);
  const [saveDialog, setSaveDialog] = useState<LayoutLayer | null>(null);
  const [tableAsk, setTableAsk] = useState<TableRequest | null>(null);
  const [featureAsk, setFeatureAsk] = useState<FeatureAsk | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [searchTick, setSearchTick] = useState(0);
  const focusId = useRef<{ id: string; tree: Tree } | null>(null);
  // The part just added that needs a table: its settings are scrolled into view once they are drawn.
  const scrollChooser = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const wantSearch = useRef(false);
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const foldFocus = useRef(false);
  const shelfId = useId();
  const markTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const entries = useMemo(() => shelfEntries(features), [features]);
  const selectedEntry = selectedKey === null ? undefined : entries.find((e) => e.key === selectedKey);

  // The page as the session has it: the saved sources plus the ones made on drop (they are saved with the layout).
  const draftPage = useMemo<Page>(() => ({ ...page, sources }), [page, sources]);
  const draftSpec = useMemo(() => withPageSources({ ...spec, tables }, page.id, sources), [spec, tables, page.id, sources]);
  const ctx = useMemo(() => partContextFor(draftSpec, draftPage), [draftSpec, draftPage]);
  const menuCtx = useMemo(() => menuPartContext({ ...spec, tables }), [spec, tables]);
  const slotCount = useMemo(() => countMenuLayers(slotsOfTree(menuRoot)), [menuRoot]);

  const dirty = useMemo(
    () => !sameSnapshot(snapshotOf({ root, sources, tables, theme, menu, menuRoot }), saved),
    [root, sources, tables, theme, menu, menuRoot, saved],
  );
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  // What is on screen now, for isDirty() and for a save that runs after the session has gone.
  const current = useRef<Working>({ root, sources, tables, theme, menu, menuRoot });
  useLayoutEffect(() => {
    current.current = { root, sources, tables, theme, menu, menuRoot };
  });
  const isDirty = useCallback((): boolean => !sameSnapshot(snapshotOf(current.current), savedSnap.current), []);
  // Read when a newer record arrives, to say that Redo went with the history (the session is started again, so its history goes).
  const redoRef = useRef(editor.canRedo);
  useLayoutEffect(() => {
    redoRef.current = editor.canRedo;
  });
  const staleChrome = useStepChrome();
  const staleAnnounce = useRef(staleChrome.announce);
  useEffect(() => {
    staleAnnounce.current = staleChrome.announce;
  });
  useEffect(() => {
    if (revision <= base.current.revision || isDirty()) return;
    if (redoRef.current) staleAnnounce.current('Started again from the latest saved version. Redo is cleared.');
    onStale();
  }, [revision, dirty, isDirty, onStale]);

  // Live marks, as before: the layout is checked against the page 300 ms after an edit.
  useEffect(() => {
    if (root === initial) return;
    clearTimeout(markTimer.current);
    markTimer.current = setTimeout(() => setMarks(checkLayer(root, ctx, `pages.${pageIndex}.layout`, 20)), LIVE_MARK_MS);
    return () => clearTimeout(markTimer.current);
  }, [root, initial, ctx, pageIndex]);

  // Keyboard focus goes back to a block after it moved or changed (the browser drops focus when a node is re-parented).
  useEffect(() => {
    const want = focusId.current;
    if (want === null) return;
    focusId.current = null;
    const inMenu = (el: HTMLElement): boolean => el.closest('[data-menu-canvas]') !== null;
    const blocks = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>(`[data-canvas-block][data-layer-id="${want.id}"]`) ?? []);
    // A slot is not a block: after the last part of a slot is removed the focus goes to the slot's box.
    const slot = canvasRef.current?.querySelector<HTMLElement>(`[data-menu-slot-id="${want.id}"]`);
    (blocks.find((el) => inMenu(el) === (want.tree === 'menu')) ?? slot ?? null)?.focus();
  }, [focusTick, root, menuRoot]);

  useEffect(() => {
    if (scrollChooser.current === null || settingsId !== scrollChooser.current) return;
    scrollChooser.current = null;
    const frame = requestAnimationFrame(() => canvasRef.current?.querySelector<HTMLElement>('[role="dialog"]')?.scrollIntoView?.({ block: 'center', behavior: 'auto' }));
    return () => cancelAnimationFrame(frame);
  }, [settingsId]);

  // "Add here" and "Beside" send the keyboard to the shelf search, and so does "/" (from anywhere that is not a box to type in).
  // Only a new place (or a new press of "/") moves the focus: changing the shelf tab afterwards leaves it on the tabs.
  useEffect(() => {
    const newPlace = pending !== null && pending !== lastPending.current;
    lastPending.current = pending;
    const newSearch = searchTick !== lastSearchTick.current;
    lastSearchTick.current = searchTick;
    if (newPlace || newSearch) wantSearch.current = true;
    // A folded shelf is not mounted yet: the wish stays until the search box exists (this runs again when the shelf opens).
    if (wantSearch.current && searchRef.current !== null) {
      wantSearch.current = false;
      searchRef.current.focus();
    }
  }, [pending, shelfTab, searchTick, shelf.folded]);

  // Every notice is also spoken once, by the workspace announcer (the notice box itself is not a live region).
  useEffect(() => {
    announceRef.current = announce;
  }, [announce]);
  useEffect(() => {
    if (notice !== null && notice.silent !== true) announceRef.current(notice.text);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isTyping(e.target ?? document.body)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) return;
      e.preventDefault();
      setShelfFolded(false);
      setShelfTab('features');
      setSearchTick((n) => n + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setShelfFolded]);

  // Folding or opening the shelf with its own button keeps the keyboard on the button that takes its place.
  useEffect(() => {
    if (!foldFocus.current) return;
    foldFocus.current = false;
    (shelf.folded ? showRef.current : hideRef.current)?.focus();
  }, [shelf.folded]);

  // Use in app: the tile that was picked is the first thing on the shelf (its name is in the search) until the person types
  // or picks something else. A saved feature may arrive after the session starts, so the entry is looked up on every render.
  const pickedEntry = addEntryKey === null ? undefined : entries.find((e) => e.key === addEntryKey);
  const shelfFilters = !filtersTouched && pickedEntry !== undefined ? { category: 'all' as const, query: pickedEntry.name } : filters;

  // The running preview does not know a list or table made in this session, so the canvas shows sample rows until it is saved.
  const draftData = stableJson(sources) !== saved.sources || stableJson(tables) !== saved.tables;
  const live = liveSource !== undefined && !draftData;
  // The rows when Preview shows none: the stored example records where there are some, else the made-up ones.
  const rows = useMemo(() => sampleBackedRows(draftSpec, sample), [draftSpec, sample]);
  const recordTable = sources.find((s) => s.mode === 'record')?.table;
  // A record page shows the first real row of the live source (never a made-up id, which Preview answers with 404).
  const [liveId, setLiveId] = useState<{ table: string; id: string | null } | null>(null);
  useEffect(() => {
    if (!live || liveSource === undefined || recordTable === undefined) return undefined;
    let stop = false;
    const done = (id: string | null): void => {
      if (!stop) setLiveId({ table: recordTable, id });
    };
    liveSource.list(recordTable, { limit: 1 }).then(
      (r) => done(typeof r.rows[0]?.id === 'string' ? r.rows[0].id : null),
      // A source with no kept answer yet (Preview is starting) never settles, so the last id stays until the next source asks again.
      () => done(null),
    );
    return () => {
      stop = true;
    };
  }, [live, liveSource, recordTable]);
  const data = useMemo<CatalogData>(() => {
    const first = recordTable !== undefined && Object.hasOwn(rows, recordTable) ? rows[recordTable][0]?.id : undefined;
    const recordId = live ? (liveId !== null && liveId.table === recordTable ? liveId.id : null) : typeof first === 'string' ? first : null;
    return { apiBase: PREVIEW_API, spec: draftSpec, pageId: page.id, recordId, dataSource: live ? liveSource : sampleDataSource(rows, draftSpec) };
  }, [draftSpec, page.id, recordTable, rows, live, liveSource, liveId]);

  const treeRoot = useCallback((tree: Tree): LayoutLayer => (tree === 'menu' ? menuRoot : root), [root, menuRoot]);

  /** Why the layer cannot be moved to the other tree at all (what its place there would refuse whatever the position), or null. */
  const crossProblem = useCallback(
    (layer: LayoutLayer, from: Tree): string | null => {
      const adapted = adaptForPlace(layer, from === 'page' ? 'menu' : 'page', from === 'page' ? menuCtx : ctx);
      if (!adapted.ok) return adapted.message;
      return from === 'page' ? menuSubtreeProblem(adapted.layer) : null;
    },
    [ctx, menuCtx],
  );

  /** The drop places of one tree for the part being dragged, as "parentId:index". A block of the other tree only where it could really go. */
  const zonesFor = useCallback(
    (tree: Tree): ReadonlySet<string> => {
      if (drag === null) return EMPTY_ZONES;
      let targets: DropTarget[];
      if (drag.movingId === null) {
        // A saved feature is never put on the menu bar, whatever type its fragment has: no menu places for it.
        targets = tree === 'menu' && drag.fromFeature === true ? [] : dropTargets(treeRoot(tree), drag.type);
      } else if (drag.tree === tree) {
        targets = dropTargets(treeRoot(tree), drag.type, drag.movingId);
      } else {
        const moving = findLayer(treeRoot(drag.tree), drag.movingId);
        const blocked = moving === null || moving.parent === null || moving.inBlock || crossProblem(moving.layer, drag.tree) !== null || !removeLayer(treeRoot(drag.tree), drag.movingId).ok;
        targets = blocked ? [] : dropTargets(treeRoot(tree), drag.type);
      }
      // A free Grid has no bar places: its cells are the places (gridZones).
      return new Set(targets.filter((t) => !isFreeGrid(findLayer(treeRoot(tree), t.parentId)?.layer)).map((t) => zoneKey(t.parentId, t.index)));
    },
    [drag, treeRoot, crossProblem],
  );
  const zones = useMemo(() => zonesFor('page'), [zonesFor]);
  // The free Grids that take the dragged part: one droppable each, the cell comes from the pointer (gridMetrics.ts).
  const gridZones = useMemo<ReadonlySet<string>>(
    () => (drag === null || drag.tree !== 'page' ? EMPTY_ZONES : gridDropIds(root, drag.type, drag.movingId ?? undefined)),
    [root, drag],
  );
  const menuZones = useMemo(() => (menu === null ? EMPTY_ZONES : zonesFor('menu')), [menu, zonesFor]);
  const sideZones = useMemo<ReadonlySet<string>>(
    () => (drag === null || drag.tree !== 'page' ? EMPTY_ZONES : new Set(sideTargets(root, drag.type, drag.movingId ?? undefined).map((t) => sideKey(t.targetId, t.side)))),
    [root, drag],
  );

  // Whether the newest history step was worded by its caller ('explicit') or only by report ('default'): tell(text, true) in the same
  // event then gives a default step the words of that line. Cleared as soon as the event is over.
  const fresh = useRef<'none' | 'default' | 'explicit'>('none');
  const { relabel } = editor;
  /** Applies a result as one history step, and notes whether it made one. Returns the refusal (as the validator wrote it) or null. */
  const applyEdit = useCallback(
    (result: TreeResult, tree: Tree, nextSources?: Source[], nextTables?: Table[], label?: string): string | null => {
    const before = editor.changeCount();
    const refusal = editor.apply(result, tree, nextSources, nextTables, label);
    if (refusal === null && editor.changeCount() !== before) {
      fresh.current = label === undefined ? 'default' : 'explicit';
      queueMicrotask(() => {
        fresh.current = 'none';
      });
    }
    return refusal;
  },
    [editor],
  );

  const report = useCallback(
    (result: TreeResult, tree: Tree = 'page', nextSources?: Source[], nextTables?: Table[], say?: Say): string | null => {
    const before = editor.changeCount();
    speechCancel();
    const found = result.ok ? findLayer(result.root, result.focusId) : null;
    const label = say?.label ?? (found === null ? undefined : `changed ${blockName(found.layer, found.parent)}`);
    const refusal = applyEdit(result, tree, nextSources, nextTables, say?.label);
    // A refusal is shown and returned in plain words (the menu bar's list of parts, part names), never as the validator wrote it.
    if (refusal !== null) {
      const message = plainMessage(refusal);
      // A refused pointer drop or resize on a grid is spoken at once, not politely.
      if (!result.ok && GRID_REASONS.has(result.reason)) {
        setNotice({ text: message, undo: false, problem: true, silent: true });
        speechRefusal(message);
        return message;
      }
      setNotice({ text: message, undo: false, problem: true });
      return message;
    }
    // Every step says what it did, with Undo; one that changed nothing says nothing.
    if (editor.changeCount() === before || label === undefined) setNotice(null);
    else setNotice({ text: sentenceOf(label), undo: true, problem: false, silent: say?.silent });
    return null;
  },
    [editor, applyEdit, speechCancel, speechRefusal],
  );

  const tell = useCallback(
    (text: string, undo = false) => {
      speechCancel();
      if (undo && fresh.current === 'default') {
        relabel(labelOf(text));
        fresh.current = 'none';
      }
      setNotice({ text, undo, problem: !undo });
    },
    [relabel, speechCancel],
  );
  /** The one way grid keys, handles and Place report (DesignContext.announceGrid). */
  const announceGrid = useCallback(
    (text: string, kind: GridSpeechKind): void => {
      if (kind === 'refusal') {
        setNotice({ text, undo: false, problem: true, silent: true });
        speechRefusal(text);
        return;
      }
      // A step made by apply in this event carries a default label: it takes these words, like tell(text, true).
      if (fresh.current === 'default') {
        relabel(labelOf(text));
        fresh.current = 'none';
      }
      setNotice({ text, undo: true, problem: false, silent: true });
      if (kind === 'step') speechStep(text);
      else speechCancel();
    },
    [relabel, speechRefusal, speechStep, speechCancel],
  );
  const focusBlock = useCallback((id: string, tree: Tree = 'page') => {
    focusId.current = { id, tree };
    setFocusTick((n) => n + 1);
  }, []);

  const removeIn = useCallback(
    (tree: Tree, id: string) => {
      const found = findLayer(treeRoot(tree), id);
      if (found === null) return;
      const name = blockName(found.layer, found.parent);
      const result = removeLayer(treeRoot(tree), id);
      if (report(result, tree, undefined, undefined, { label: `removed ${name}` }) !== null) return;
      setSettingsId(null);
      if (result.ok) focusBlock(result.focusId, tree);
    },
    [treeRoot, report, focusBlock],
  );

  const moveIn = useCallback(
    (tree: Tree, id: string, delta: -1 | 1) => {
      const found = findLayer(treeRoot(tree), id);
      if (found === null) return;
      const result = moveBy(treeRoot(tree), id, delta);
      if (report(result, tree, undefined, undefined, { label: `moved ${blockName(found.layer, found.parent)} ${delta < 0 ? 'up' : 'down'}` }) !== null) return;
      focusBlock(id, tree);
    },
    [treeRoot, report, focusBlock],
  );

  /** The name of a place, as Move to... lists it: "Menu bar, left, place 1" or "Page, place 3". */
  const placeName = useCallback(
    (tree: Tree, at: DropTarget): string => {
      const holder = findLayer(treeRoot(tree), at.parentId);
      return `${holder === null ? 'Page' : blockName(holder.layer, holder.parent, menu?.position ?? 'top')}, place ${at.index + 1}`;
    },
    [treeRoot, menu],
  );

  const otherPlacesFrom = useCallback(
    (from: Tree) =>
      (type: string, movingId: string): CrossPlace[] => {
        const to: Tree = from === 'page' ? 'menu' : 'page';
        if (to === 'menu' && menu === null) return [];
        const found = findLayer(treeRoot(from), movingId);
        if (found === null || found.parent === null || found.inBlock || crossProblem(found.layer, from) !== null || !removeLayer(treeRoot(from), movingId).ok) return [];
        return dropTargets(treeRoot(to), type).map((at) => ({ tree: to, at, label: placeName(to, at) }));
      },
    [menu, treeRoot, crossProblem, placeName],
  );

  /** Moves a block to a place of the other tree: one result for both trees, so one Undo step, then the focus follows it. */
  const moveAcrossFrom = useCallback(
    (from: Tree) =>
      (id: string, to: CrossPlace): void => {
        const found = findLayer(treeRoot(from), id);
        const name = found === null ? 'the part' : blockName(found.layer, found.parent);
        const result = transferLayer(root, menuRoot, from, id, to.at, { page: ctx, menu: menuCtx });
        const refusal = editor.applyPair(result, `moved ${name} to ${to.tree === 'menu' ? 'the menu bar' : 'the page'}`);
        if (refusal !== null) {
          setNotice({ text: plainMessage(refusal), undo: false, problem: true });
          return;
        }
        setSettingsId(null);
        if (result.ok) focusBlock(result.focusId, to.tree);
        setNotice({ text: `Moved ${name} to ${to.tree === 'menu' ? 'the menu bar' : 'the page'}.`, undo: true, problem: false });
      },
    [treeRoot, root, menuRoot, ctx, menuCtx, editor, focusBlock],
  );

  const openSettings = useCallback((id: string | null, focus?: string): void => {
    setSettingsId(id);
    setSettingsFocus(id === null ? null : (focus ?? null));
  }, []);

  /** What the status line says when a drop made a new source for the page. */
  const addedWords = (source: Source): string =>
    source.mode === 'record' ? `This page now shows one ${tableLabel(draftSpec, source.table)} record from its address.` : `Added a list of ${tableLabel(draftSpec, source.table)} to this page.`;

  const addHere = useCallback((target: DropTarget, tree: Tree) => {
    setPending({ ...target, tree });
    setShelfFolded(false);
    setShelfTab('features');
    setIntroDismissed(true);
  }, [setShelfFolded]);

  /** Beside: the next part picked on the shelf goes to the right of this one, with the side drop widths. */
  const beside = useCallback((targetId: string) => {
    setPending({ kind: 'side', tree: 'page', targetId, side: 'right' });
    setShelfFolded(false);
    setShelfTab('features');
    setIntroDismissed(true);
  }, [setShelfFolded]);

  /** "Put Number tile beside Table of records. Both take half the row." after a side drop that applied (`before` is the tree before it). */
  const tellBeside = (before: LayoutLayer, after: LayoutLayer, at: SideTarget, droppedId: string): void => {
    const target = findLayer(after, at.targetId);
    const dropped = findLayer(after, droppedId);
    if (target === null || dropped === null) return;
    const wasWhole = readSizing(findLayer(before, at.targetId)?.layer.sizing).width === 'full';
    const lead = `Put ${blockName(dropped.layer, dropped.parent)} beside ${blockName(target.layer, target.parent)}.`;
    tell(wasWhole ? `${lead} Both take half the row.` : `${lead} It takes ${widthPhrase(readSizing(dropped.layer.sizing).width)}.`, true);
  };

  /** Every layer id of the page and of the menu bar: a new part takes an id that neither tree uses. */
  const takenIds = (): Set<string> => new Set([...layerIds(root), ...layerIds(menuRoot)]);

  /** Puts an entry of the shelf into a slot or Row of the menu bar. Saved features are refused; so is any part the bar does not take. */
  const placeInMenu = (entry: ShowcaseEntry, at: DropTarget, byKeyboard: boolean): void => {
    if (entry.kind !== 'part') return tell(MENU_FEATURE_REFUSAL);
    const made = newMenuLayer(entry.id, menuCtx, takenIds(), { prefer: tablePreference(ctx, false), tables: draftSpec.tables });
    if ('refusal' in made) return tell(plainMessage(made.refusal));
    if (report(insertLayer(menuRoot, at, made), 'menu') !== null) return;
    recordRecent(entry.key);
    setPending(null);
    setIntroDismissed(true);
    if (byKeyboard) focusBlock(made.id, 'menu');
    // The bar can be out of sight on a long page, so the status line says where the part went.
    tell(`Added ${blockName(made)} to the menu bar.`, true);
  };

  /** "Add a button to the menu bar" in Look: a new Button at the end of the right (or bottom) side, with Undo. */
  const addMenuButton = (): void => {
    const end = (menuRoot.children as LayoutLayer[]).find((s) => s.id === MENU_SLOT_IDS.end);
    if (end === undefined) return;
    const made = newMenuLayer('Button', menuCtx, takenIds(), { prefer: tablePreference(ctx, false), tables: draftSpec.tables });
    if ('refusal' in made) return tell(plainMessage(made.refusal));
    const at: DropTarget = { parentId: end.id, index: Array.isArray(end.children) ? end.children.length : 0 };
    if (report(insertLayer(menuRoot, at, made), 'menu') !== null) return;
    recordRecent('part:Button');
    focusBlock(made.id, 'menu');
    tell('Added Button to the menu bar.', true);
  };

  /** Puts an entry of the shelf at a place, or beside a block. `byKeyboard` moves the focus to the new block. */
  const place = (key: string, at: DropTarget | SideTarget, byKeyboard: boolean, tree: Tree, grid?: { gridId: string; cell: GridCell | null }): void => {
    const entry = entries.find((e) => e.key === key);
    if (entry === undefined) return;
    if (!('targetId' in at) && tree === 'menu') return placeInMenu(entry, at, byKeyboard);
    let layer: LayoutLayer;
    let configure = false;
    // A part bound on drop may bring a new page source (one history step with the part); a part that needs a choice has none yet.
    let nextSources: Source[] | undefined;
    let added: Source | null = null;
    let choose: 'props.source' | 'props.table' | null = null;
    let offered: ConnectOffer | null = null;
    // The part tied itself to a table: the line says which ("Connected the Form to People.").
    let connectedTable: string | null = null;
    if (entry.kind === 'part') {
      const plan = planDrop(entry.id, draftSpec, draftPage, takenIds());
      if (plan.kind === 'refused') return tell(plainMessage(plan.refusal));
      layer = plan.layer;
      if (plan.kind === 'bound') {
        nextSources = plan.sources;
        added = plan.added;
        connectedTable = connectedTableOf(layer, plan.sources);
      } else if (plan.kind === 'offer') {
        // Placed not connected: the box on the page offers New table and Add a field.
        offered = plan.offer;
        nextSources = plan.sources;
      } else {
        choose = plan.target;
      }
    } else {
      const def = library.get(entry.id);
      if (def === undefined) return tell('This feature is not in your library any more.');
      let values = autoValues(def, ctx);
      let featureCtx = ctx;
      if (values === null) {
        // The app has tables but this page has no list of one: the feature takes the first table and the page gets a list of it.
        const settled = settleOnFirstTable(def, ctx, entry.name, draftSpec);
        if (settled !== null) {
          values = settled.values;
          featureCtx = settled.ctx;
          nextSources = [...draftPage.sources, ...settled.made];
          added = settled.made[0] ?? null;
          for (const m of settled.made) featureLists.current.add(m.id);
        }
      }
      if (values === null) {
        // No table fits and the app has none: New table opens for the feature (the builder: Add a table slot), and the feature goes in connected to it.
        if (needsNewTable(def)) {
          setFeatureAsk({ entry, at, byKeyboard });
          setPending(null);
          setIntroDismissed(true);
          return;
        }
        return tell(`This feature needs ${needsWords(entry)} on this page. Add one in Page settings.`);
      }
      const worded = withOwnWords(def, values, featureCtx, draftSpec);
      const made = newFeatureLayer(worded.def, worded.values, featureCtx, library, takenIds());
      if (!made.ok) return tell('This feature could not be added to this page.');
      layer = made.value;
      configure = def.params.length > 0;
    }
    const isBeside = 'targetId' in at;
    const result = isBeside ? insertBeside(root, at, layer) : grid !== undefined ? insertAtCell(root, grid.gridId, layer, grid.cell) : insertLayer(root, at, layer);
    let stepLabel: string | undefined;
    if (result.ok) {
      const besideTarget = isBeside ? findLayer(result.root, at.targetId) : null;
      const cell = grid === undefined ? null : placeOf(result.root, layer.id);
      stepLabel = besideTarget !== null ? `put ${blockName(layer)} beside ${blockName(besideTarget.layer, besideTarget.parent)}` : cell !== null ? addedAtLabel(blockName(layer), cell) : addedLabel(result.root, layer.id);
    }
    if (report(result, 'page', nextSources, undefined, { label: stepLabel }) !== null) return;
    recordRecent(entry.key);
    setPending(null);
    setIntroDismissed(true);
    if (offered !== null) {
      tell(offerNotice(offered, blockName(layer), host !== undefined), true);
      if (byKeyboard) focusBlock(layer.id);
      return;
    }
    if (choose !== null) {
      // Not connected yet: the settings open on the table choice, so the person picks before anything else.
      openSettings(layer.id, choose);
      scrollChooser.current = layer.id;
      tell(`Pick a table for the new ${blockName(layer)}.`, true);
      return;
    }
    if (byKeyboard) focusBlock(layer.id);
    const lead = connectedTable === null ? null : `Connected the ${blockName(layer)} to ${tableLabel(draftSpec, connectedTable)}.`;
    if (added !== null) tell(lead === null ? addedWords(added) : `${lead} ${addedWords(added)}`, true);
    else if (isBeside && result.ok) tellBeside(root, result.root, at, layer.id);
    else if (lead !== null) tell(lead, true);
    // A feature opens its settings so the first values can be checked.
    if (configure) openSettings(layer.id);
  };

  const add = (entry: ShowcaseEntry): void => {
    if (entry.status === 'needs_repair') return tell('This feature is damaged, so it cannot be added.');
    const type = entry.kind === 'part' ? entry.id : library.get(entry.id)?.fragment.type;
    if (type === undefined) return tell('This feature is not in your library any more.');
    if (pending !== null && 'kind' in pending) return place(entry.key, { targetId: pending.targetId, side: pending.side }, true, 'page');
    const at = pending ?? insertionTarget(root, selectedId, type);
    if (at === null) return tell('There is no place for this on the page right now.');
    place(entry.key, at, true, pending?.tree ?? 'page');
  };

  /** After a part was connected to a table made here: its settings open on the first field that has more than one choice, else the focus goes to the block. */
  const afterConnect = (layerId: string, out: { result: TreeResult; sources: Source[]; tables: Table[] }): void => {
    if (out.result.ok) {
      const nextSpec = withPageSources({ ...spec, tables: out.tables }, page.id, out.sources);
      const nextPage: Page = { ...page, sources: out.sources };
      if (hasFieldChoice(out.result.root, layerId, nextSpec, nextPage)) {
        openSettings(layerId, firstFieldChoice(out.result.root, layerId, nextSpec, nextPage) ?? undefined);
        return;
      }
    }
    focusBlock(layerId);
  };

  /** New table: the table, the page list and the connection are one history step. Returns a refusal in plain words, or null (the dialog closes). */
  const makeTable = (layerId: string, table: Table): string | null => {
    const out = connectToNewTable(root, layerId, table, draftSpec, draftPage, takenIds());
    const refusal = applyEdit(out.result, 'page', out.sources, out.tables);
    if (refusal !== null) return plainMessage(refusal);
    setTableAsk(null);
    const found = findLayer(root, layerId);
    const part = found === null ? 'part' : blockName(found.layer, found.parent);
    if (!out.connected) {
      // The table is in, the part is not connected (a Linked record picker needs a link field, so a second table): the next step is told.
      const nextSpec = withPageSources({ ...draftSpec, tables: out.tables }, draftPage.id, out.sources);
      const offer = found === null ? null : offerFor(found.layer, nextSpec, { ...draftPage, sources: out.sources });
      const second = offer !== null && offer.kind === 'no_field' && offer.tables.length === 0 && offer.needs.some((n) => n.types[0] === 'reference');
      const canAdd = offer !== null && offer.kind === 'no_field' && offer.tables.length > 0;
      const lead = `Made the table ${table.label}.`;
      tell(second ? `${lead} Make a second table, then the ${part} connects to it.` : canAdd ? `${lead} The ${part} is not connected to it yet. Press Add a field on the ${part}.` : `${lead} The ${part} is not connected to it yet.`, true);
      focusBlock(layerId);
      return null;
    }
    tell(out.added !== null ? `Made the table ${table.label} and added a list of ${table.label} to this page.` : `Made the table ${table.label}. The ${part} adds to it.`, true);
    afterConnect(layerId, out);
    return null;
  };

  /** Add a field: the field and the connection are one history step. Returns a refusal in plain words, or null (the dialog closes). */
  const addFieldTo = (req: Extract<TableRequest, { kind: 'add_field' }>, tableId: string, field: Field): string | null => {
    const out = connectWithNewField(root, req.layerId, tableId, field, req.target, req.choice, draftSpec, draftPage, takenIds());
    const refusal = applyEdit(out.result, 'page', out.sources, out.tables);
    if (refusal !== null) return plainMessage(refusal);
    setTableAsk(null);
    const into = out.tables.find((t) => t.id === tableId)?.label ?? tableId;
    tell(out.added !== null ? `Added the field ${field.label} to ${into} and a list of ${into} to this page.` : `Added the field ${field.label} to ${into}.`, true);
    focusBlock(req.layerId);
    return null;
  };

  /** New table for a feature: the table, its lists and the feature are one history step. Returns a refusal in plain words, or null (the dialog closes). */
  const makeFeatureTable = (ask: FeatureAsk, def: FeatureDefinition, table: Table): string | null => {
    const now: AppSpec = { ...draftSpec, pages: draftSpec.pages.map((p) => (p.id === page.id ? { ...p, layout: root } : p)) };
    const out = placeFeatureOnNewTable(def, table, now, draftPage, ask.at, takenIds(), library);
    if ('refusal' in out) return plainMessage(out.refusal);
    const refusal = applyEdit(out.result, 'page', out.sources, out.tables, out.result.ok ? addedLabel(out.result.root, out.result.focusId) : undefined);
    if (refusal !== null) return plainMessage(refusal);
    setFeatureAsk(null);
    recordRecent(ask.entry.key);
    tell(`Made the table ${table.label} and added ${ask.entry.name} to this page.`, true);
    if (out.result.ok) {
      if (ask.byKeyboard) focusBlock(out.result.focusId);
      if (def.params.length > 0) openSettings(out.result.focusId);
    }
    return null;
  };

  // The host changes the document through this: one Undo step with its own words.
  const hostEdit = useCallback<HostEdit>(
    (make, label) => {
      const cur = current.current;
      const doc: HostDoc = { root: cur.root, sources: cur.sources, tables: cur.tables };
      const next = make(doc);
      if (next === null || (next.root === doc.root && next.sources === doc.sources && next.tables === doc.tables)) return null;
      const kids = Array.isArray(next.root.children) ? next.root.children : [];
      const refusal = applyEdit({ ok: true, root: next.root, focusId: kids[0]?.id ?? next.root.id }, 'page', next.sources, next.tables, label);
      if (refusal !== null) return plainMessage(refusal);
      setNotice({ text: sentenceOf(label), undo: true, problem: false });
      return null;
    },
    [applyEdit],
  );
  const bindEdit = host?.bindEdit;
  useEffect(() => {
    bindEdit?.(hostEdit);
    return () => bindEdit?.(null);
  }, [bindEdit, hostEdit]);
  const onHostDoc = host?.onDoc;
  useEffect(() => {
    onHostDoc?.({ root, sources, tables });
  }, [onHostDoc, root, sources, tables]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // The pointer while a part is dragged: its last client point (before the first move, where the drag began), the part being moved
  // and the free Grid it is over. Refs, so the window listener and the announcements read them without a render.
  const dragPoint = useRef<{ x: number; y: number } | null>(null);
  const dragMoving = useRef<string | null>(null);
  const overGrid = useRef<string | null>(null);
  const pointerListener = useRef<((e: PointerEvent) => void) | null>(null);
  // One measure per frame: moves only store the point, and the Grid's tracks are read once per hovered Grid (and again after a
  // scroll or resize), not on every move.
  const frame = useRef<number | null>(null);
  const tracks = useRef<{ gridId: string; metrics: GridMetrics } | null>(null);
  const invalidateTracks = useCallback((): void => {
    tracks.current = null;
  }, []);

  /** The cells the dragged part would take in a free Grid, from the pointer and the Grid's resolved tracks; null without metrics (below md). */
  const computeHover = useCallback((gridId: string): GridHover | null => {
    let m = tracks.current !== null && tracks.current.gridId === gridId ? tracks.current.metrics : null;
    if (m === null) {
      const area = document.querySelector(`[data-grid-area="${CSS.escape(gridId)}"]`);
      m = measureGrid(area?.parentElement ?? null);
      // A missing measure is not kept: the area may simply not be drawn yet.
      if (m !== null) tracks.current = { gridId, metrics: m };
    }
    const point = dragPoint.current;
    if (m === null || point === null) return null;
    const found = dropPlace(current.current.root, gridId, cellAt(m, point.x, point.y), dragMoving.current);
    return found === null ? null : { gridId, place: found.place, free: found.free };
  }, []);
  const showHover = useCallback((next: GridHover | null): void => {
    setGridHover((prev) => {
      if (prev === next) return prev;
      if (prev !== null && next !== null && prev.gridId === next.gridId && prev.free === next.free && prev.place.col === next.place.col && prev.place.span === next.place.span && prev.place.row === next.place.row && prev.place.rowSpan === next.place.rowSpan) return prev;
      return next;
    });
  }, []);
  const stopPointer = useCallback((): void => {
    if (pointerListener.current !== null) window.removeEventListener('pointermove', pointerListener.current, true);
    pointerListener.current = null;
    window.removeEventListener('scroll', invalidateTracks, true);
    window.removeEventListener('resize', invalidateTracks);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    tracks.current = null;
    overGrid.current = null;
    setGridHover(null);
  }, [invalidateTracks]);
  useEffect(() => stopPointer, [stopPointer]);
  // The drag announcements name the cell under the pointer when they are spoken, so they read it through this (set after each render).
  const gridPlaceRef = useRef<(gridId: string) => DragPlace | null>(() => null);
  useEffect(() => {
    gridPlaceRef.current = (gridId) => {
      const grid = findLayer(root, gridId);
      if (grid === null) return null;
      const gridName = blockName(grid.layer, grid.parent);
      const hover = computeHover(gridId);
      // No metrics (below md): the part goes to the next free cell, so only the grid is named. A taken cell is not a place.
      if (hover === null) return { kind: 'zone', name: gridName };
      return hover.free ? { kind: 'zone', name: gridPlaceName(gridName, hover.place) } : null;
    };
  });

  const onDragStart = (e: DragStartEvent): void => {
    const info = e.active.data.current as { kind?: string; key?: string; id?: string; tree?: Tree } | undefined;
    setSettingsId(null);
    setPending(null);
    const began = e.activatorEvent as Partial<PointerEvent> | undefined;
    dragPoint.current = typeof began?.clientX === 'number' && typeof began.clientY === 'number' ? { x: began.clientX, y: began.clientY } : null;
    dragMoving.current = info?.kind === 'block' && info.id !== undefined ? info.id : null;
    stopPointer();
    const onMove = (ev: PointerEvent): void => {
      dragPoint.current = { x: ev.clientX, y: ev.clientY };
      if (overGrid.current === null || frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (overGrid.current !== null) showHover(computeHover(overGrid.current));
      });
    };
    pointerListener.current = onMove;
    window.addEventListener('scroll', invalidateTracks, true);
    window.addEventListener('resize', invalidateTracks);
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    if (info?.kind === 'palette' && info.key !== undefined) {
      const entry = entries.find((x) => x.key === info.key);
      const type = entry === undefined ? undefined : entry.kind === 'part' ? entry.id : library.get(entry.id)?.fragment.type;
      if (entry !== undefined && type !== undefined) setDrag({ type, movingId: null, tree: 'page', label: entry.name, fromFeature: entry.kind === 'feature', refusal: entry.kind === 'feature' ? plainMessage(MENU_FEATURE_REFUSAL) : null });
    } else if (info?.kind === 'block' && info.id !== undefined) {
      const tree: Tree = info.tree === 'menu' ? 'menu' : 'page';
      const found = findLayer(treeRoot(tree), info.id);
      if (found !== null) {
        editor.select(found.layer.id, tree);
        setDrag({ type: found.layer.type, movingId: found.layer.id, tree, label: blockName(found.layer, found.parent), refusal: tree === 'page' ? plainOrNull(crossProblem(found.layer, 'page')) : null });
      }
    }
  };

  const onDragOver = (e: DragOverEvent): void => {
    const raw = e.over?.data.current as OverData | undefined;
    const gridOver = raw?.kind === 'grid' && raw.gridId !== undefined ? raw.gridId : null;
    if (gridOver !== overGrid.current) invalidateTracks();
    overGrid.current = gridOver;
    showHover(overGrid.current === null ? null : computeHover(overGrid.current));
  };

  const onDragEnd = (e: DragEndEvent): void => {
    const info = e.active.data.current as { kind?: string; key?: string; id?: string; tree?: Tree } | undefined;
    const raw = e.over?.data.current as OverData | undefined;
    // The cell is read before the listener goes (the pointer stays where the drop happened).
    const gridId = raw?.kind === 'grid' ? raw.gridId : undefined;
    invalidateTracks();
    const hover = gridId === undefined ? null : computeHover(gridId);
    stopPointer();
    setDrag(null);
    if (raw === undefined) return;
    if (gridId !== undefined) {
      const cell = hover === null ? null : { col: hover.place.col, row: hover.place.row };
      if (info?.kind === 'palette' && info.key !== undefined) {
        const holder = findLayer(root, gridId);
        const count = holder !== null && Array.isArray(holder.layer.children) ? holder.layer.children.length : 0;
        place(info.key, { parentId: gridId, index: count }, false, 'page', { gridId, cell });
      } else if (info?.kind === 'block' && info.id !== undefined && info.tree !== 'menu') {
        const moving = findLayer(root, info.id);
        const name = moving === null ? 'the part' : blockName(moving.layer, moving.parent);
        const result = moveToCell(root, info.id, gridId, cell);
        const landed = result.ok ? placeOf(result.root, info.id) : null;
        report(result, 'page', undefined, undefined, { label: landed === null ? undefined : movedLabel(name, landed), silent: true });
      }
      return;
    }
    const destTree: Tree = raw.tree === 'menu' ? 'menu' : 'page';
    let over: DropTarget | SideTarget;
    if (raw.kind === 'side') over = { targetId: raw.targetId as string, side: raw.side as SideTarget['side'] };
    else if (raw.kind === 'refuse') over = { parentId: raw.parentId as string, index: (findLayer(menuRoot, raw.parentId as string)?.layer.children as LayoutLayer[] | undefined)?.length ?? 0 };
    else over = { parentId: raw.parentId as string, index: raw.index as number };
    if (info?.kind === 'palette' && info.key !== undefined) {
      place(info.key, over, false, destTree);
    } else if (info?.kind === 'block' && info.id !== undefined) {
      const fromTree: Tree = info.tree === 'menu' ? 'menu' : 'page';
      if ('targetId' in over) {
        if (fromTree !== 'page') return;
        const result = moveBeside(root, info.id, over);
        // A side drop that changes nothing (A already left of B at B's width) adds no history entry: no Undo to offer.
        if (report(result) === null && result.ok && result.root !== root) tellBeside(root, result.root, over, info.id);
      } else if (fromTree !== destTree) {
        moveAcrossFrom(fromTree)(info.id, { tree: destTree, at: over, label: '' });
      } else {
        const moving = findLayer(treeRoot(destTree), info.id);
        const own = moving === null || moving.parent === null ? null : { parentId: moving.parent.id, index: moving.index };
        const where = placeName(destTree, over).replace(/place \d+$/, `place ${placeNumber(over, own)}`);
        report(moveLayer(treeRoot(destTree), info.id, over), destTree, undefined, undefined, { label: `moved ${moving === null ? 'the part' : blockName(moving.layer, moving.parent)} to ${where}`, silent: true });
      }
    }
  };

  // What a screen reader hears while a part is dragged: the part and the place in plain words, never dnd-kit's ids.
  // eslint-disable-next-line react-hooks/refs -- dnd-kit calls place() when it speaks, not during render; the cell is read then
  const announcements = dragAnnouncements<Active, Over>({
    label: (active) => {
      const info = active.data.current as { kind?: string; key?: string; id?: string; tree?: Tree } | undefined;
      if (info?.kind === 'palette') return entries.find((x) => x.key === info.key)?.name ?? 'the part';
      if (info?.kind === 'block' && info.id !== undefined) {
        const found = findLayer(treeRoot(info.tree === 'menu' ? 'menu' : 'page'), info.id);
        if (found !== null) return blockName(found.layer, found.parent);
      }
      return 'the part';
    },
    place: (over): DragPlace | null => {
      const raw = over.data.current as OverData | undefined;
      if (raw === undefined || raw.kind === 'refuse') return null;
      if (raw.kind === 'grid') return gridPlaceRef.current(raw.gridId as string);
      if (raw.kind === 'side') {
        const target = findLayer(root, raw.targetId as string);
        return target === null ? null : { kind: 'side', name: blockName(target.layer, target.parent) };
      }
      return { kind: 'zone', name: placeName(raw.tree === 'menu' ? 'menu' : 'page', { parentId: raw.parentId as string, index: raw.index as number }) };
    },
  });

  const menuScope: DesignContextValue | null =
    menu === null
      ? null
      : {
          tree: 'menu',
          menu: null,
          menuPosition: menu.position,
          root: menuRoot,
          spec: draftSpec,
          page: draftPage,
          ctx: menuCtx,
          library,
          data,
          selectedId: selectedMenuId,
          select: (id) => editor.select(id, 'menu'),
          drag: drag === null ? null : { type: drag.type, movingId: drag.movingId, tree: drag.tree, refusal: drag.refusal },
          zones: menuZones,
          sideZones: EMPTY_ZONES,
          resizing: null,
          previewResize: () => {},
          gridZones: EMPTY_ZONES,
          gridHover: null,
          gridPreview: null,
          previewGrid: () => {},
          announceGrid: () => {},
          pending,
          addHere: (target) => addHere(target, 'menu'),
          beside: () => {},
          settingsId,
          openSettings,
          settingsFocus,
          appId,
          apply: (result) => report(result, 'menu'),
          askTable: () => {},
          tell,
          focusBlock: (id) => focusBlock(id, 'menu'),
          remove: (id) => removeIn('menu', id),
          move: (id, delta) => moveIn('menu', id, delta),
          otherPlaces: otherPlacesFrom('menu'),
          moveAcross: moveAcrossFrom('menu'),
          ...(host === undefined ? {} : { builder: { hidesEntry: host.hidesEntry } }),
        };

  const context: DesignContextValue = {
    tree: 'page',
    menu: menuScope,
    menuPosition: menu?.position ?? 'top',
    root,
    spec: draftSpec,
    page: draftPage,
    ctx,
    library,
    data,
    selectedId,
    select: editor.select,
    drag: drag === null ? null : { type: drag.type, movingId: drag.movingId, tree: drag.tree, refusal: drag.refusal },
    zones,
    sideZones,
    resizing,
    previewResize: setResizing,
    gridZones,
    gridHover,
    gridPreview,
    previewGrid: setGridPreview,
    announceGrid,
    pending,
    addHere: (target) => addHere(target, 'page'),
    beside,
    settingsId,
    openSettings,
    settingsFocus,
    appId,
    apply: (result, nextSources, nextTables) => {
      const kept = nextSources === undefined || !result.ok ? { sources: nextSources, gone: [] } : dropUnusedLists(nextSources, featureLists.current, result.root);
      for (const id of kept.gone) featureLists.current.delete(id);
      const sources = kept.sources;
      return report(result, 'page', sources, nextTables);
    },
    askTable: setTableAsk,
    tell,
    focusBlock: (id) => focusBlock(id, 'page'),
    remove: (id) => removeIn('page', id),
    move: (id, delta) => moveIn('page', id, delta),
    otherPlaces: otherPlacesFrom('page'),
    moveAcross: moveAcrossFrom('page'),
    ...(host === undefined ? {} : { builder: { hidesEntry: host.hidesEntry } }),
  };

  const pendingName = pending === null ? null : findLayer(treeRoot(pending.tree), 'kind' in pending ? pending.targetId : pending.parentId);
  const menuPosition = menu?.position ?? 'top';
  const selectedLayer = selectedId === null ? null : findLayer(root, selectedId);
  // Where a plain Add goes now: inside the selected part when it holds the new one, else after it.
  const addInto = selectedLayer === null || selectedLayer.parent === null ? null : insertionTarget(root, selectedId, selectedEntry?.kind === 'part' ? selectedEntry.id : 'Text');
  const note =
    pending !== null && pendingName !== null
      ? 'kind' in pending
        ? `Pick a part to put beside ${blockName(pendingName.layer, pendingName.parent, menuPosition)}. Press Escape to cancel.`
        : `Pick a part to add in ${blockName(pendingName.layer, pendingName.parent, menuPosition)}. Press Escape to cancel.`
      : selectedLayer !== null && selectedLayer.parent !== null
        ? `Add puts it ${addInto !== null && addInto.parentId === selectedLayer.layer.id ? 'inside' : 'after'} ${blockName(selectedLayer.layer, selectedLayer.parent)}.`
        : selectedEntry !== undefined && !introDismissed
          ? `Drag ${selectedEntry.name} onto the page, or use Add here.`
          : null;

  // The saves of this session, one after the other: each starts from the base the one before it left.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const onSave = useCallback((): Promise<SaveOutcome> => {
    const now = current.current;
    const run = async (): Promise<SaveOutcome> => {
      const snap = snapshotOf(now);
      // An earlier save of this session already sent these edits.
      if (hostRef.current === undefined && sameSnapshot(snap, savedSnap.current)) return { ok: true };
      const from = base.current;
      const updated = specOfWorking(from.spec, now, page.id);
      // A host ends the save in its own place (the Feature builder asks for a name and one line): no revision, no data question.
      const hosted = hostRef.current;
      if (hosted !== undefined) {
        try {
          if (mounted.current) setSaveState({ kind: 'saving' });
          const out = await hosted.save(updated);
          if (out.ok) {
            savedSnap.current = snap;
            savedDoc.current = { root: now.root, menu: now.menuRoot, sources: now.sources, tables: now.tables };
            savedLook.current = { theme: now.theme, menu: now.menu };
            if (mounted.current) setSaved(snap);
          }
          if (mounted.current) setSaveState({ kind: 'idle' });
          return out;
        } catch {
          if (mounted.current) setSaveState({ kind: 'error', message: SAVE_THROWN, issues: [] });
          return { ok: false, reason: SAVE_THROWN };
        }
      }
      // A save that removes a table, a field or its data asks the Data step's question first. The session is gone: there is no one to ask.
      const removals = dataRemovals(from.spec, updated);
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      try {
        if (removals.length > 0) {
          if (!mounted.current) return { ok: false, reason: REMOVE_DATA.needsAnswer };
          const yes = await new Promise<boolean>((answer) => {
            setPendingSave({ sentences: removals, answer, finished });
          });
          if (!yes) return { ok: false, cancelled: true };
        }
        if (mounted.current) setSaveState({ kind: 'saving' });
        const result = await save(updated, { baseRevision: from.revision });
        if (result.ok) {
          // The base keeps the tables as sent (the server's copy may be in its own normal form), like the Data step's.
          if (result.record.revision >= base.current.revision) base.current = { revision: result.record.revision, spec: { ...(result.record.spec ?? updated), tables: now.tables } };
          savedSnap.current = snap;
          savedDoc.current = { root: now.root, menu: now.menuRoot, sources: now.sources, tables: now.tables };
          savedLook.current = { theme: now.theme, menu: now.menu };
          if (mounted.current) {
            setSaved(snap);
            setSaveState({ kind: 'idle' });
          }
          return { ok: true };
        }
        if (result.code === 'revision_conflict') {
          // The edits stay on screen with the message; the latest record is already loaded, and Discard or Undo brings this session to it.
          if (mounted.current) setSaveState({ kind: 'error', message: CONFLICT_MESSAGE, issues: [] });
          return { ok: false, reason: CONFLICT_MESSAGE };
        }
        if (mounted.current) setSaveState({ kind: 'error', message: result.message, issues: result.issues });
        return { ok: false, reason: plainMessage(result.message) };
      } catch {
        if (mounted.current) setSaveState({ kind: 'error', message: SAVE_THROWN, issues: [] });
        return { ok: false, reason: SAVE_THROWN };
      } finally {
        finish();
      }
    };
    const next = chain.current.then(run, run);
    chain.current = next;
    return next;
  }, [page.id, save]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Escape anywhere in the session cancels the place chosen with Add here or Beside (a popover or list that handles its own Escape stops it first).
    if (e.key === 'Escape' && pending !== null) setPending(null);
  };

  // Data connections: a part with no table blocks Save (the server refuses it) and Next; a write part on a table the page does not
  // show blocks Next until it is fixed or kept on purpose.
  const issues = useMemo(() => connectionIssues(draftSpec, { pageId: page.id, layout: root, sources }), [draftSpec, page.id, root, sources]);
  // Only a part that is not connected blocks Next; a write part on a table the page does not show is advice (it can be kept on purpose).
  const blocking = issues.filter((i) => !i.dismissible);
  const notConnectedHere = issues.some((i) => i.code === 'not_connected' && i.pageId === page.id);

  // Fix all and A way to add records: one pure result, one history step each (Undo takes every part and list back at once).
  const fixAll = (): void => {
    const out = fixAllConnections(root, { spec: draftSpec, page: draftPage, takenIds: takenIds(), kept });
    if (out.fixed.length === 0) {
      setNotice({ text: fixAllOutcome(out), undo: false, problem: false });
      return;
    }
    const refusal = applyEdit(out.result, 'page', out.sources, undefined, fixAllLabel(out.fixed.length));
    if (refusal !== null) {
      setNotice({ text: plainMessage(refusal), undo: false, problem: true });
      return;
    }
    tell(fixAllOutcome(out), true);
    focusBlock(out.result.focusId);
  };
  const wayGaps = useMemo(
    () => (host === undefined ? waysIn(specOfWorking(spec, { root, sources, tables, theme, menu, menuRoot }, page.id)) : []),
    [host, spec, root, sources, tables, theme, menu, menuRoot, page.id],
  );
  const addWays = (): void => {
    const out = addWaysIn(specOfWorking(spec, current.current, page.id), { pageId: page.id });
    const next = out.spec.pages.find((p) => p.id === page.id);
    if (out.added.length === 0 || next === undefined) {
      setNotice({ text: waysInOutcome(out), undo: false, problem: false });
      return;
    }
    const first = out.added[0];
    const menuAdded = out.added.some((a) => a.kind === 'menu');
    // With the menu bar off its parts are only parked: they stay unless a menu button was added.
    const refusal = editor.applyPair({ ok: true, page: next.layout, menu: menuAdded ? menuTreeOf(out.spec.menu ?? null) : current.current.menuRoot, focusId: first.layerId }, waysInLabel(out));
    if (refusal !== null) {
      setNotice({ text: plainMessage(refusal), undo: false, problem: true });
      return;
    }
    tell(waysInOutcome(out), true);
    focusBlock(first.layerId, first.kind === 'menu' ? 'menu' : 'page');
  };

  // Ctrl+S, Ctrl+Z and Ctrl+Y belong to the whole Design step, wherever the focus is (after a step change it is on the heading, outside
  // the session). They wait while a modal dialog is open, so the keys never act on the page behind it.
  const { undo: undoStep, redo: redoStep } = editor;
  // Undo and Redo say what they did, in the line above the page, and offer the other way back.
  const undo = useCallback((): void => {
    const label = undoStep();
    if (label !== null) setNotice({ text: historyLine(UNDID, label), undo: false, redo: true, problem: false });
  }, [undoStep]);
  const redo = useCallback((): void => {
    const label = redoStep();
    if (label !== null) setNotice({ text: historyLine(REDID, label), undo: true, problem: false });
  }, [redoStep]);
  useEffect(() => {
    const onDocKey = (e: globalThis.KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      // Ctrl+S never leaves the browser's Save page dialog, not even while a modal dialog is open.
      if (key === 's') e.preventDefault();
      if (document.querySelector(MODAL_OPEN) !== null) return;
      if (key === 's') {
        // Ctrl+S saves, also while typing in a box.
        if (saveState.kind === 'saving') return;
        if (notConnectedHere) announce(host?.blockedWords ?? SAVE_HINT);
        else if (!dirty && host === undefined) announce(NOTHING_TO_SAVE);
        else void onSave();
        return;
      }
      if (e.defaultPrevented || isTyping(e.target ?? document.body)) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onDocKey);
    return () => document.removeEventListener('keydown', onDocKey);
  }, [dirty, notConnectedHere, saveState.kind, onSave, announce, undo, redo, host]);
  const keep = (key: string, on: boolean): void => {
    const nextKept = new Set(kept);
    if (on) nextKept.add(key);
    else nextKept.delete(key);
    setKept(nextKept);
    writeKept(appId, nextKept);
  };
  const fixIssue = (issue: { layerId: string; target: string }): void => {
    editor.select(issue.layerId);
    openSettings(issue.layerId, issue.target);
  };
  const dataNote = showsData(root)
    ? host !== undefined
      ? 'Showing sample rows.'
      : live
      ? 'Showing your Preview data (read only).'
      : draftData && liveSource !== undefined
        ? 'Showing sample rows until you save the new list.'
        : sample !== null && Object.values(sample.tables).some((list) => list.length > 0)
          ? 'Showing the sample records of this example. Your Preview data shows here while Preview runs.'
          : 'Showing sample rows. Your Preview data shows here while Preview runs.'
    : null;

  // The workspace saves this draft before any move, so it needs the save and the reasons it may be blocked.
  const blockingCount = blocking.length;
  const saveDraft = useCallback(async (): Promise<SaveOutcome> => (hostRef.current !== undefined || isDirty() ? onSave() : { ok: true }), [isDirty, onSave]);
  // Discard in the shell's "cannot be saved yet" question: the page, the sources, the look and the menu bar go back to what is saved.
  const { reset: resetEditor } = editor;
  const resetDraft = useCallback((): void => {
    // Clean at once, also when the session is gone or the render that follows never comes (Discard, then the step closes).
    const doc = savedDoc.current;
    current.current = { root: doc.root, sources: doc.sources, tables: doc.tables, theme: savedLook.current.theme, menu: savedLook.current.menu, menuRoot: doc.menu };
    if (!mounted.current) return;
    resetEditor(savedDoc.current);
    setTheme(savedLook.current.theme);
    setMenu(savedLook.current.menu);
    setSettingsId(null);
    setPending(null);
    setTableAsk(null);
    setSaveState({ kind: 'idle' });
    setNotice(null);
  }, [resetEditor]);
  // The session goes while the "Save and remove data?" question is open: settle it, or the shell's move would wait for ever.
  const pendingSaveRef = useRef<PendingSave | null>(null);
  useEffect(() => {
    pendingSaveRef.current = pendingSave;
  });
  useEffect(
    () => () => {
      pendingSaveRef.current?.answer(false);
      pendingSaveRef.current = null;
    },
    [],
  );
  const resetRef = useRef(resetDraft);
  useEffect(() => {
    resetRef.current = resetDraft;
  });
  useEffect(() => {
    onDraft({
      scope: page.id,
      isDirty,
      save: saveDraft,
      saveBlocked: notConnectedHere ? SAVE_HINT : null,
      nextBlocked: blockingCount > 0 ? NEXT_HINT : null,
      reset: () => resetRef.current(),
      exportSpec: () => specOfWorking(base.current.spec, current.current, page.id),
    });
  }, [onDraft, isDirty, saveDraft, notConnectedHere, blockingCount, page.id]);
  useEffect(() => () => onDraft(null), [onDraft]);

  // Unsaved edits are kept in browser storage; a stored draft from an earlier visit is offered back (Restore / Discard), never applied silently.
  const offer = useDraftStore({
    appId: draftKey ?? appId,
    step: 'design',
    scope: page.id,
    revision,
    baseRevision: () => base.current.revision,
    dirty,
    isDirty,
    payload: () => ({ pageId: page.id, ...current.current }),
    isSaved: (payload) => {
      const stored = asDesignDraft(payload, page.id);
      return stored === null || sameSnapshot(snapshotOf(stored), savedSnap.current);
    },
  });
  const offerText = offer?.text ?? null;
  useEffect(() => {
    if (offerText !== null) announceRef.current(offerText);
  }, [offerText]);
  const restoreDraft = (): void => {
    if (offer === null) return;
    const stored = asDesignDraft(offer.take(), page.id);
    if (stored === null) return;
    // A draft made from another revision keeps that base: its save then meets the revision conflict instead of overwriting newer work.
    if (offer.baseRevision !== base.current.revision) base.current = { ...base.current, revision: offer.baseRevision };
    resetEditor({ root: stored.root, menu: stored.menuRoot, sources: stored.sources, tables: stored.tables });
    setTheme(stored.theme);
    setMenu(stored.menu);
    setNotice({ text: DRAFT_RESTORED, undo: false, problem: false });
  };

  // The part the New table or Add a field dialog is for, and what Add a field offers: the tables that can take the field and its type.
  const askedLayer = tableAsk === null ? null : findLayer(root, tableAsk.layerId);
  const askedName = askedLayer === null ? '' : blockName(askedLayer.layer, askedLayer.parent);
  const askedOffer = askedLayer === null ? null : offerFor(askedLayer.layer, draftSpec, draftPage);
  const askedFieldTables: readonly string[] =
    tableAsk === null || tableAsk.kind !== 'add_field' ? [] : tableAsk.table !== null ? [tableAsk.table] : askedOffer !== null && askedOffer.kind === 'no_field' ? askedOffer.tables : [];
  const askedFieldType: FieldType = (() => {
    if (askedLayer === null || tableAsk === null || tableAsk.kind !== 'add_field') return 'text';
    const target = tableAsk.target;
    const needs = fieldNeedsOf(askedLayer.layer.type);
    const named = target === null ? undefined : needs.find((n) => `props.${n.prop}` === target)?.types[0] ?? getPartDefinition(askedLayer.layer.type)?.binds.find((b) => b.kind === 'field' && `props.${b.prop}` === target)?.fieldTypes?.[0];
    return named ?? (askedOffer !== null && askedOffer.kind === 'no_field' ? askedOffer.needs[0].types[0] : (needs[0]?.types[0] ?? 'text'));
  })();

  // A request whose part is gone, or whose dialog cannot render (Add a field with no table to take it), would reopen later: drop it.
  const askStale = tableAsk !== null && (askedLayer === null || (tableAsk.kind === 'add_field' && askedFieldTables.length === 0));
  if (askStale) setTableAsk(null);

  const TableDialog: ComponentType<NewTableDialogProps> = host?.NewTableDialog ?? NewTableDialog;
  const featureAskDef = featureAsk === null ? undefined : library.get(featureAsk.entry.id);
  const failed = saveState.kind === 'error';
  const layoutBase = `pages.${pageIndex}.layout`;
  // A part that is not connected says so in its own box, its settings and the Save reason: its problems are not listed again.
  const shown = (failed && saveState.issues.length > 0 ? saveState.issues : marks).filter((issue) => {
    const at = layerAtPath(root, layoutBase, issue.path);
    if (at === null) return true;
    const state = connectionOf(at, ctx, draftSpec)?.state;
    // A mark about a missing table or list is old as soon as the part is connected: it goes in the same render as the badge changes.
    if (state === 'connected' && STALE_REF_PATH.test(issue.path)) return false;
    return state !== 'not_connected';
  });
  const canSaveFeature = selectedLayer !== null && selectedLayer.parent !== null && selectedLayer.layer.type !== 'Tab';
  const openSaveFeature = (): void => {
    if (canSaveFeature && selectedLayer !== null) setSaveDialog(selectedLayer.layer);
    else setNotice({ text: SAVE_FEATURE_FIRST, undo: false, problem: false });
  };
  /** "Go to the page": the first part of the page, else the page itself. */
  const skipToPage = (e: MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    const target = canvasRef.current?.querySelector<HTMLElement>('[data-canvas-block][tabindex="0"]') ?? canvasRef.current?.querySelector<HTMLElement>('[data-canvas-block]');
    target?.focus();
  };
  // One part: say what to do next. An empty page says it on the page itself ("Drop a feature here").
  const sparse = Array.isArray(root.children) && root.children.length === 1;
  const gridColumns =
    host === undefined
      ? shelf.folded
        ? 'lg:grid-cols-[auto_1fr]'
        : 'lg:grid-cols-[300px_1fr]'
      : shelf.folded
        ? 'lg:grid-cols-[auto_1fr] 2xl:grid-cols-[auto_1fr_280px]'
        : 'lg:grid-cols-[300px_1fr] 2xl:grid-cols-[300px_1fr_280px]';
  const dividerClass = 'hidden h-5 w-px bg-slate-slate700 sm:block';

  return (
    <DesignContext.Provider value={context}>
      <div onKeyDown={onKeyDown} className="mx-auto w-full max-w-screen-2xl">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-slate700/60 px-4 py-2">
          <a
            href="#design-page"
            onClick={skipToPage}
            className={`sr-only focus:not-sr-only focus:rounded-md focus:bg-slate-brand focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-white ${FOCUS_RING}`}
          >
            Go to the page
          </a>
          {toolbarStart}
          <span aria-hidden="true" className={dividerClass} />
          <button type="button" className={btnSecondary} onClick={undo} disabled={!editor.canUndo}>
            <span className="inline-flex items-center gap-1.5">
              <Undo2 size={14} aria-hidden="true" />
              Undo
            </span>
          </button>
          <button type="button" className={btnSecondary} onClick={redo} disabled={!editor.canRedo}>
            <span className="inline-flex items-center gap-1.5">
              <Redo2 size={14} aria-hidden="true" />
              Redo
            </span>
          </button>
          {host === undefined && (
            <button type="button" className={btnSecondary} onClick={openSaveFeature}>
              Save as feature
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {shown.length > 0 && (
              <div className="max-h-24 max-w-md overflow-y-auto text-xs text-accent-red">
                <p>{shown.length === 1 ? '1 problem on this page.' : `${shown.length} problems on this page.`}</p>
                <ul className="list-disc pl-4">
                  {shown.slice(0, 3).map((issue) => (
                    <li key={`${issue.path}:${issue.code}`}>{plainIssue(issue, draftSpec)}</li>
                  ))}
                </ul>
              </div>
            )}
            {failed && (
              <span role="alert" className="max-w-md text-xs text-accent-red">
                {plainMessage(saveState.message)}
              </span>
            )}
            {host !== undefined ? (
              host.toolbarEnd
            ) : (
              <>
                {notConnectedHere && (
                  <span id={`${hintId}-save`} className={`max-w-xs ${HINT_CLASS}`}>
                    {SAVE_HINT}
                  </span>
                )}
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => void onSave()}
                  disabled={saveState.kind === 'saving' || pendingSave !== null || !dirty || notConnectedHere}
                  title={notConnectedHere ? SAVE_HINT : dirty ? undefined : 'No changes to save.'}
                  aria-describedby={notConnectedHere ? `${hintId}-save` : undefined}
                >
                  {saveState.kind === 'saving' ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={collide}
          accessibility={{ announcements, screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS } }}
          onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
          onDragCancel={() => {
            stopPointer();
            setDrag(null);
          }}
        >
          <div className={`grid gap-3 p-3 ${gridColumns}`}>
            <aside id={shelfId} aria-label={shelf.folded ? 'Features, hidden' : 'Features'} className="max-h-[45dvh] min-w-0 overflow-y-auto p-1 lg:max-h-[calc(100dvh-10rem)] lg:pr-1">
              {shelf.folded ? (
                <button
                  ref={showRef}
                  type="button"
                  aria-expanded={false}
                  aria-controls={shelfId}
                  className={`${btnSecondary} inline-flex items-center gap-1.5 forced-colors:border lg:h-auto lg:py-3 lg:[writing-mode:vertical-rl]`}
                  onClick={() => {
                    foldFocus.current = true;
                    setShelfFolded(false);
                  }}
                >
                  <PanelLeftOpen size={14} aria-hidden="true" />
                  Add parts
                </button>
              ) : (
                <>
                  <div className="mb-2 flex justify-end">
                    <button
                      ref={hideRef}
                      type="button"
                      aria-expanded={true}
                      aria-controls={shelfId}
                      className={`${btnSecondary} inline-flex items-center gap-1.5`}
                      onClick={() => {
                        foldFocus.current = true;
                        setShelfFolded(true);
                      }}
                    >
                      <PanelLeftClose size={14} aria-hidden="true" />
                      Hide the shelf
                    </button>
                  </div>
                  <FeatureShelf
                    features={features}
                    library={library}
                    theme={theme}
                    tab={shelfTab}
                    onTab={setShelfTab}
                    onTheme={setTheme}
                    lookExtra={<MenuPicker value={menu} onChange={setMenu} slotCount={slotCount} onAddButton={addMenuButton} onShowParts={() => setShelfTab('features')} />}
                    filters={shelfFilters}
                    onFilters={(next) => {
                      setFiltersTouched(true);
                      setFilters(next);
                    }}
                    selectedKey={selectedKey}
                    onSelect={(key) => {
                      setSelectedKey(key);
                      setIntroDismissed(true);
                    }}
                    onAdd={add}
                    searchRef={searchRef}
                    note={note}
                  />
                </>
              )}
            </aside>
            <section aria-label="Page layout" className="flex min-w-0 flex-col gap-2 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto">
              {gridSpeech.alert !== null && (
                <p key={gridSpeech.alert.n} role="alert" className="sr-only">
                  {gridSpeech.alert.text}
                </p>
              )}
              <div className="shrink-0 space-y-2 empty:hidden">
                {offer !== null && (
                  <div role="status" aria-live="off" className={NOTICE_CLASS}>
                    <span>{offer.text}</span>
                    <button type="button" className={btnSecondary} onClick={restoreDraft}>
                      {DRAFT_RESTORE}
                    </button>
                    <button type="button" className={btnSecondary} onClick={offer.discard}>
                      {DRAFT_DISCARD}
                    </button>
                  </div>
                )}
                {notice !== null && (
                  <div role="status" aria-live="off" className={notice.problem ? PROBLEM_NOTICE_CLASS : NOTICE_CLASS}>
                    <span>{notice.text}</span>
                    {notice.undo && (
                      <button type="button" className={btnSecondary} onClick={undo}>
                        Undo
                      </button>
                    )}
                    {notice.redo === true && (
                      <button type="button" className={btnSecondary} onClick={redo}>
                        Redo
                      </button>
                    )}
                  </div>
                )}
                {host === undefined && (
                  <ConnectionIssues
                    issues={issues}
                    kept={kept}
                    pageId={page.id}
                    onFix={fixIssue}
                    onFixAll={fixAll}
                    onOpenPage={onShowPage}
                    onKeep={(key) => keep(key, true)}
                    onShowAgain={(key) => keep(key, false)}
                  />
                )}
                {host === undefined && <WaysInLine gaps={wayGaps} onAdd={addWays} />}
                {dataNote !== null && (
                  <p data-testid="data-note" className={HINT_CLASS}>
                    {dataNote}
                  </p>
                )}
                {sparse && <p className={HINT_CLASS}>{EMPTY_PAGE_HINT}</p>}
              </div>
              <CanvasFrame name={spec.app.name} mode={view.mode} onModeChange={view.setMode} layout="pane">
                <div id="design-page" ref={canvasRef} className="rounded-lg">
                  <DesignCanvas theme={theme} mode={view.mode} />
                </div>
              </CanvasFrame>
            </section>
            {host !== undefined && <div className="min-w-0 lg:col-span-2 2xl:col-span-1">{host.aside}</div>}
          </div>
          <DragOverlay dropAnimation={null}>
            {drag !== null && <div className={`${POPOVER_CLASS} px-3 py-1.5 text-sm font-semibold text-slate-slate100`}>{drag.label}</div>}
          </DragOverlay>
        </DndContext>
        {saveDialog !== null && (
          <Suspense fallback={null}>
            <SaveFeatureDialog
              selection={saveDialog}
              root={root}
              features={features}
              library={library}
              ctx={ctx}
              spec={draftSpec}
              onSaved={(replacement, record) => {
                setSaveDialog(null);
                if (replacement !== null && report(replaceLayer(root, saveDialog.id, replacement)) === null) {
                  setNotice({ text: `Saved ${record.label} as a feature. This page now uses it. Save keeps the page.`, undo: true, problem: false });
                } else if (replacement === null) {
                  setNotice({ text: `Saved ${record.label} as a feature.`, undo: false, problem: false });
                }
                void reloadFeatures();
              }}
              onCancel={() => setSaveDialog(null)}
              onOpenBuilder={(input) => {
                setSaveDialog(null);
                go('/features/new', { state: { builderStart: input } });
              }}
            />
          </Suspense>
        )}
        {tableAsk !== null && askedLayer !== null && (
          <Suspense fallback={null}>
            {tableAsk.kind === 'new_table' ? (
              <TableDialog
                partName={askedName}
                partType={askedLayer.layer.type}
                spec={draftSpec}
                initial={newTableDraft(askedLayer.layer.type, draftSpec.tables)}
                needsLink={askedLayer.layer.type === 'ReferencePicker' && draftSpec.tables.length === 0}
                onMake={(table) => makeTable(tableAsk.layerId, table)}
                onCancel={() => setTableAsk(null)}
              />
            ) : (
              askedFieldTables.length > 0 && (
                <AddFieldDialog
                  words={host?.addFieldWords}
                  partName={askedName}
                  spec={draftSpec}
                  tables={askedFieldTables}
                  initialTable={tableAsk.table !== null && askedFieldTables.includes(tableAsk.table) ? tableAsk.table : askedFieldTables[0]}
                  type={askedFieldType}
                  onAdd={(table, field) => addFieldTo(tableAsk, table, field)}
                  onCancel={() => setTableAsk(null)}
                />
              )
            )}
          </Suspense>
        )}
        {featureAsk !== null && featureAskDef !== undefined && (
          <Suspense fallback={null}>
            <TableDialog
              partName={featureAsk.entry.name}
              spec={draftSpec}
              initial={featureTableDraft(featureAskDef, draftSpec.tables)}
              onMake={(table) => makeFeatureTable(featureAsk, featureAskDef, table)}
              onCancel={() => setFeatureAsk(null)}
            />
          </Suspense>
        )}
        {pendingSave !== null && (
          <StudioConfirm
            title={REMOVE_DATA.title}
            message={REMOVE_DATA.message(pendingSave.sentences)}
            confirmLabel={REMOVE_DATA.confirm}
            busyLabel={REMOVE_DATA.busy}
            cancelLabel={REMOVE_DATA.cancel}
            onConfirm={async () => {
              pendingSave.answer(true);
              await pendingSave.finished;
              setPendingSave(null);
            }}
            onCancel={() => {
              pendingSave.answer(false);
              setPendingSave(null);
            }}
          />
        )}
      </div>
    </DesignContext.Provider>
  );
}
