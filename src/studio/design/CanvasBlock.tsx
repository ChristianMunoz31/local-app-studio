// One layer on the canvas: an outlined, selectable wrapper around the part. A selected block (or one with focus inside it)
// shows its toolbar: drag handle (Enter or Space on it opens Move to...), Settings, Add a tab (Tabs only), Move up, Move down, Shrink,
// Widen and Beside (a block that can sit side by side), Move to... (the places of the page or the menu bar it is in, and of the other
// one), Delete. Enter or a double click on the block opens its Settings; every tool carries a title equal to its name. While a part is dragged such a block has a drop place at each side, and the left one of two
// blocks side by side carries the resize handle at its right edge (ResizeHandle.tsx). A Column takes part in
// Columns (side by side): its places are named "Column 2 of 3" and it is reordered with Move up and Move down, not dragged. Keys on the block:
// Delete removes it, Alt+ArrowUp and Alt+ArrowDown move it, Escape clears the selection. The toolbar and the settings popover
// are drawn in the chrome layer beside the theme scope (ChromeLayer.tsx), so Studio's controls keep the kit theme.
import { useDraggable } from '@dnd-kit/core';
import { ArrowDown, ArrowUp, ChevronsLeftRight, ChevronsRightLeft, Columns2, CornerDownRight, GripVertical, Plus, Settings, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { FOCUS_RING, POPOVER_CLASS } from '../components/ui';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { readGrid } from '@local-app-studio/runtime/spec/gridPlacement';
import { readSizing, samePlacement } from '@local-app-studio/runtime/spec/sizing';
import type { LayerSizing } from '@local-app-studio/runtime/spec/sizing';
import { addTab, canSize, dropTargets, findLayer, isShareWidth, moveLayer, resizeHandles, stepWidth } from '../lib/layoutTree';
import type { DropTarget } from '../lib/layoutTree';
import { isFreeGrid, placeOf } from '../lib/gridLayout';
import { PLACE_WORDS, placeDescription } from '../lib/gridWords';
import { layerIds } from '../lib/layout';
import { pairChange, sizingChange } from '../lib/sizingWords';
import { placeRows } from './movePlaces';
import { movingWords, noPlaceWords } from './designWords';
import BlockSettings from './BlockSettings';
import ConnectionBadge, { NewerVersionPill } from './ConnectionBadge';
import { isBehind, partIndicator } from './indicator';
import NotConnected from './NotConnected';
import { ChromePortal } from './ChromeLayer';
import { blockName } from './designLabels';
import { useDesign } from './DesignContext';
import DropZone, { SideZone } from './DropZone';
import GridResizeHandle from './GridResizeHandle';
import ResizeHandle from './ResizeHandle';
import { useGridKeys } from './useGridKeys';

interface Props {
  layer: LayoutLayer;
  /** The container this layer sits in, null for the page itself. */
  parent: LayoutLayer | null;
  index: number;
  /** Which edge zones this block hosts. `sides`: it sits in a parent that lays parts side by side, so it may get side drops. */
  zones: { before: boolean; after: boolean; sides: boolean };
  /** The part content is a picture: nothing inside it can be clicked or typed in. */
  inert: boolean;
  children: ReactNode;
}

const TOOL_BASE =
  'inline-flex items-center justify-center rounded text-slate-slate100 hover:bg-slate-slate700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight disabled:opacity-40';
/** An icon tool: 36 px on a small screen, 28 px from the small breakpoint up. */
const TOOL = `${TOOL_BASE} h-9 w-9 sm:h-7 sm:w-7`;
/** A tool with words next to its icon. */
const TOOL_TEXT = `${TOOL_BASE} h-9 gap-1 px-2 text-xs sm:h-7`;

/** One line of the Move to... list: a place of this tree or of the other one, or the place the block is in now (not a button). */
interface PlaceItem {
  key: string;
  label: string;
  here?: boolean;
  onPick(): void;
}

/** A block narrower than this gets a toolbar of icons only, drawn above it, so it never covers the part's own words. */
const NARROW_PX = 480;

interface PlacesProps {
  id: string;
  name: string;
  places: PlaceItem[];
  onClose(): void;
}

/** The places a block can move to, in plain words: the container and the place in it. */
function MovePlaces({ id, name, places, onClose }: PlacesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, []);
  return (
    <div
      ref={ref}
      id={id}
      role="group"
      aria-label={`Move ${name} to`}
      aria-describedby={headingId}
      className={`${POPOVER_CLASS} pointer-events-auto absolute right-2 top-4 z-30 max-h-64 w-72 max-w-[85vw] space-y-1 overflow-y-auto p-2 text-left`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <p id={headingId} className="px-2 pb-1 text-xs text-slate-slate300">
        {movingWords(name)}
      </p>
      {places.map((p) =>
        p.here === true ? (
          <p key={p.key} aria-current="location" className="block w-full rounded px-2 py-1 text-left text-sm font-semibold text-slate-slate300">
            {p.label}
          </p>
        ) : (
          <button
            key={p.key}
            type="button"
            className={`block w-full rounded px-2 py-1 text-left text-sm text-slate-slate100 hover:bg-slate-slate700 ${FOCUS_RING}`}
            onClick={p.onPick}
          >
            {p.label}
          </button>
        ),
      )}
    </div>
  );
}

export default function CanvasBlock({ layer, parent, index, zones, inert, children }: Props) {
  const { root, spec, page, ctx, library, builder, drag, selectedId, select, settingsId, openSettings, remove, move, apply, focusBlock, tell, tree, menuPosition, otherPlaces, moveAcross, beside, askTable } = useDesign();
  const selected = selectedId === layer.id;
  const isRoot = parent === null;
  const name = blockName(layer, parent, menuPosition);
  const open = settingsId === layer.id;
  // A part with a place on a free Grid: its order follows the place, it has resize handles and its place in its description.
  const placed = parent !== null && isFreeGrid(parent) && readGrid(layer.grid) !== null;
  const place = placed ? placeOf(root, layer.id) : null;
  const gridKey = useGridKeys(layer, parent);
  const placeDescId = useId();
  const movable = !isRoot && layer.type !== 'Tab' && layer.type !== 'Column';
  // The parts of a Row sit side by side, and so do those of the menu bar across the top: their drop zones are thin vertical bars.
  const orientation = parent?.type === 'Row' || (parent?.type === 'MenuSlot' && menuPosition === 'top') ? 'inline' : 'block';
  // The menu bar has its own draggable ids and says which tree a block comes from, so a drop knows where to take it.
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useDraggable({
    id: `${tree === 'menu' ? 'menu-block' : 'block'}:${layer.id}`,
    data: { kind: 'block', id: layer.id, tree },
    disabled: !movable,
  });
  const blockRef = useRef<HTMLDivElement | null>(null);
  // Stable on purpose: a new callback ref every render is detached and attached again, and the settings popover (a child) would
  // measure the block in between, when its ref is empty.
  const setBlock = useCallback(
    (el: HTMLDivElement | null): void => {
      blockRef.current = el;
      setNodeRef(el);
    },
    [setNodeRef],
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const moveButton = useRef<HTMLButtonElement>(null);
  const handleButton = useRef<HTMLButtonElement | null>(null);
  const setHandle = useCallback(
    (el: HTMLButtonElement | null): void => {
      handleButton.current = el;
      setActivatorNodeRef(el);
    },
    [setActivatorNodeRef],
  );
  const [choosing, setChoosing] = useState(false);
  const placesId = useId();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) settingsButton.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const showTools = selected && !isRoot;
  // The toolbar sits above the block, off its first line; the menu bar (when on top) and the first part of the page (no room above it) get it below.
  const toolbarBelow = (tree === 'menu' && menuPosition === 'top') || (tree === 'page' && parent !== null && parent.id === root.id && index === 0);
  // A block too narrow for the labelled toolbar gets icons only, drawn above it: one line, off the part's own words.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = blockRef.current;
    if (!showTools || el === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setNarrow(el.getBoundingClientRect().width < NARROW_PX));
    observer.observe(el);
    return () => observer.disconnect();
  }, [showTools]);
  const targets = useMemo(() => (movable && showTools ? dropTargets(root, layer.type, layer.id) : []), [movable, showTools, root, layer.type, layer.id]);
  // Places in the other tree (page to menu bar and back), listed after the places of this one.
  const crossTargets = useMemo(() => (movable && showTools ? otherPlaces(layer.type, layer.id) : []), [movable, showTools, otherPlaces, layer.type, layer.id]);
  const holderName = (parentId: string): string => {
    const holder = findLayer(root, parentId);
    return holder === null ? (tree === 'menu' ? 'Menu bar' : 'Page') : blockName(holder.layer, holder.parent, menuPosition);
  };
  const ownPlace = parent === null ? null : { parentId: parent.id, index };
  const rows = choosing ? placeRows(targets, ownPlace, holderName) : [];
  const moveTo = (t: DropTarget, label: string): void => {
    setChoosing(false);
    if (apply(moveLayer(root, layer.id, t)) !== null) {
      // Refused: the list is gone, so the keyboard goes back to the button that opened it.
      (moveButton.current ?? handleButton.current)?.focus();
      return;
    }
    focusBlock(layer.id);
    tell(`Moved ${name} to ${label}.`, true);
  };
  const chooseCell = (): void => {
    setChoosing(false);
    select(layer.id);
    // The popover reads its first focus when it mounts: when this block's settings are already open the focus goes to Column directly.
    if (open) document.querySelector<HTMLElement>('[data-testid="place-settings"] [data-place-field="col"]')?.focus();
    else openSettings(layer.id, 'place.col');
  };
  const places: PlaceItem[] = choosing
    ? [
        ...(placed ? [{ key: 'choose-cell', label: PLACE_WORDS.chooseCell, onPick: chooseCell }] : []),
        ...rows.map((r) => ({ key: r.key, label: r.label, here: r.here, onPick: () => (r.target === null ? undefined : moveTo(r.target, r.label)) })),
        ...crossTargets.map((c) => ({
          key: `${c.tree}:${c.at.parentId}:${c.at.index}`,
          label: c.label,
          onPick: () => {
            setChoosing(false);
            moveAcross(layer.id, c);
            // A refusal leaves the block here: focus the button that opened the list. A move focuses the block in its new place afterwards.
            (moveButton.current ?? handleButton.current)?.focus();
          },
        })),
      ]
    : [];

  // Shrink and Widen are offered where the Width setting is.
  const sizable = showTools && zones.sides && canSize(root, layer.id);
  const onStep = (delta: -1 | 1): void => {
    const result = stepWidth(root, layer.id, delta);
    // A refusal ("This already takes the whole row.") is shown by apply in the status line.
    // An ok with the same root changed nothing and added no history entry, so there is nothing to announce or undo.
    if (apply(result) !== null || !result.ok || result.root === root || parent === null) return;
    const was = (id: string): LayerSizing => readSizing(findLayer(root, id)?.layer.sizing);
    const now = (id: string): LayerSizing => readSizing(findLayer(result.root, id)?.layer.sizing);
    const siblings = Array.isArray(parent.children) ? parent.children : [];
    const changed = siblings.filter((c) => !samePlacement(was(c.id), now(c.id)));
    const [a, b] = changed;
    const aw = a === undefined ? 'full' : now(a.id).width;
    const bw = b === undefined ? 'full' : now(b.id).width;
    if (changed.length === 2 && isShareWidth(aw) && isShareWidth(bw)) tell(pairChange(blockName(a, parent), aw, blockName(b, parent), bw), true);
    else tell(sizingChange(name, now(layer.id)), true);
    // Leaving or joining a row draws the block in a new place, which drops the keyboard focus: send it back to the block.
    if ((was(layer.id).width === 'full') !== (now(layer.id).width === 'full')) focusBlock(layer.id);
  };

  // The left one of a pair on one line carries the handle between the two.
  const own = readSizing(layer.sizing);
  const pairable = zones.sides && parent !== null && drag === null && isShareWidth(own.width) && !own.grow;
  const handleRight = useMemo(() => {
    if (!pairable || parent === null) return null;
    const pair = resizeHandles(root, parent.id).find((h) => h.leftId === layer.id);
    const siblings = Array.isArray(parent.children) ? parent.children : [];
    return pair === undefined ? null : (siblings.find((c) => c.id === pair.rightId) ?? null);
  }, [pairable, root, parent, layer.id]);

  // Built-in data parts say which table they show; a part with no table yet is not drawn, only this box with Connect.
  // Data parts and feature blocks carry one indicator pill (indicator.ts); a part with no table yet is not drawn, only this box with its offers.
  const isBuilder = builder !== undefined;
  const indicator = useMemo(() => {
    const computed = partIndicator(layer, ctx, spec, page, { library, builder: isBuilder });
    return computed !== null && computed.state === 'needs_table' && tree !== 'page' ? { ...computed, offer: null } : computed;
  }, [layer, ctx, spec, page, library, isBuilder, tree]);
  const behind = isBehind(layer, library);
  const dataTarget = indicator !== null && indicator.state !== 'needs_table' && indicator.state !== 'needs_field' ? (indicator.target ?? undefined) : undefined;

  const canAddTab = layer.type === 'Tabs' && layer.feature === undefined;
  const onAddTab = (): void => {
    const result = addTab(root, layer.id, ctx, layerIds(root));
    if (apply(result) !== null || !result.ok) return;
    focusBlock(result.focusId);
    const added = findLayer(result.root, result.focusId);
    tell(`Added ${added === null ? 'a tab' : blockName(added.layer, added.parent)} to ${name}.`, true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Keys from a control or a part inside this one belong to that one.
    if (e.target !== e.currentTarget || isRoot) return;
    if (e.key === 'Tab' && !e.shiftKey && showTools) {
      // The toolbar is drawn in the chrome layer, so Tab goes into it by hand (and ChromePortal brings it back to the page order).
      const first = toolbarRef.current?.querySelector<HTMLElement>('button:not([disabled])');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (gridKey(e)) {
      return;
    } else if (e.altKey && parent !== null && isFreeGrid(parent) && e.key.startsWith('Arrow')) {
      // A part of a free Grid with no readable place has no flow move, and the browser's Alt+Arrow Back must not run.
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(layer.id);
      openSettings(layer.id);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      remove(layer.id);
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(layer.id, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      select(null);
    }
  };

  /** Enter or Space on the drag handle opens Move to... (a drag needs a pointer). */
  const onHandleKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (placed || targets.length + crossTargets.length > 0) setChoosing(true);
    else tell(noPlaceWords(name));
  };

  const outline = selected
    ? 'outline outline-2 outline-offset-2 outline-slate-brandLight'
    : '[&:hover:not(:has([data-canvas-block]:hover))]:outline [&:hover:not(:has([data-canvas-block]:hover))]:outline-1 [&:hover:not(:has([data-canvas-block]:hover))]:outline-offset-2 [&:hover:not(:has([data-canvas-block]:hover))]:outline-slate-slate500';

  return (
    <div
      ref={setBlock}
      data-canvas-block=""
      data-layer-id={layer.id}
      role="group"
      aria-label={isRoot ? 'Page canvas' : name}
      aria-describedby={place === null ? undefined : placeDescId}
      tabIndex={isRoot ? -1 : 0}
      className={`group/block relative min-w-0 rounded-md ${FOCUS_RING} ${outline} ${isDragging ? 'opacity-40' : ''} ${showTools && toolbarBelow && narrow ? 'mb-10' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        select(layer.id);
      }}
      onDoubleClick={(e) => {
        if (isRoot) return;
        e.stopPropagation();
        select(layer.id);
        openSettings(layer.id);
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !isRoot) select(layer.id);
      }}
      onKeyDown={onKeyDown}
    >
      {place !== null && (
        <span id={placeDescId} data-grid-place-desc="" hidden>
          {placeDescription(place)}
        </span>
      )}
      {parent !== null && zones.before && <DropZone parent={parent} index={index} position="before" orientation={orientation} />}
      <ChromePortal targetRef={blockRef} active={showTools || open} returnRef={blockRef}>
        {showTools && (
          <div
            ref={toolbarRef}
            role="toolbar"
            aria-label={`Actions for ${name}`}
            className={`${POPOVER_CLASS} pointer-events-auto absolute right-2 z-20 flex max-w-[calc(100%-1rem)] flex-nowrap items-center gap-0.5 overflow-x-auto whitespace-nowrap p-1 ${toolbarBelow ? 'top-full mt-1' : 'bottom-full mb-1'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {movable && (
              <button
                type="button"
                ref={setHandle}
                aria-label={`Drag to move ${name}`}
                title={`Drag to move ${name}`}
                className={`${TOOL} cursor-grab touch-none`}
                {...listeners}
                onKeyDown={onHandleKeyDown}
              >
                <GripVertical size={14} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              ref={settingsButton}
              aria-label="Settings"
              title="Settings"
              aria-haspopup="dialog"
              aria-expanded={open}
              className={TOOL}
              onClick={() => openSettings(open ? null : layer.id)}
            >
              <Settings size={14} aria-hidden="true" />
            </button>
            {canAddTab && (
              <button type="button" aria-label="Add a tab" title="Add a tab" className={narrow ? TOOL : TOOL_TEXT} onClick={onAddTab}>
                <Plus size={14} aria-hidden="true" />
                {!narrow && 'Add a tab'}
              </button>
            )}
            {!placed && (
              <>
                <button type="button" aria-label="Move up" title="Move up" className={TOOL} onClick={() => move(layer.id, -1)}>
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label="Move down" title="Move down" className={TOOL} onClick={() => move(layer.id, 1)}>
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
              </>
            )}
            {sizable && (
              <>
                <button type="button" aria-label="Shrink" title="Shrink" className={TOOL} onClick={() => onStep(-1)}>
                  <ChevronsRightLeft size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label="Widen" title="Widen" className={TOOL} onClick={() => onStep(1)}>
                  <ChevronsLeftRight size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label={`Put a part beside ${name}`} title={`Put a part beside ${name}`} className={narrow ? TOOL : TOOL_TEXT} onClick={() => beside(layer.id)}>
                  <Columns2 size={14} aria-hidden="true" />
                  {!narrow && 'Beside'}
                </button>
              </>
            )}
            {(placed || targets.length + crossTargets.length > 0) && (
              <button
                type="button"
                ref={moveButton}
                aria-haspopup="true"
                aria-controls={choosing ? placesId : undefined}
                aria-expanded={choosing}
                aria-label="Move to..."
                title="Move to..."
                className={narrow ? TOOL : TOOL_TEXT}
                onClick={() => setChoosing((v) => !v)}
              >
                <CornerDownRight size={14} aria-hidden="true" />
                {!narrow && 'Move to...'}
              </button>
            )}
            <button type="button" aria-label="Delete" title="Delete" className={TOOL} onClick={() => remove(layer.id)}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        {places.length > 0 && (
          <MovePlaces
            id={placesId}
            name={name}
            places={places}
            onClose={() => {
              setChoosing(false);
              (moveButton.current ?? handleButton.current)?.focus();
            }}
          />
        )}
        {open && <BlockSettings layer={layer} onClose={() => openSettings(null)} />}
      </ChromePortal>
      {(indicator?.state === 'needs_table' || indicator?.state === 'needs_field') && layer.feature === undefined ? (
        <NotConnected
          partName={name}
          indicator={indicator}
          builder={builder !== undefined}
          onConnect={() => {
            select(layer.id);
            openSettings(layer.id, indicator.target);
          }}
          onNewTable={() => {
            select(layer.id);
            askTable({ kind: 'new_table', layerId: layer.id });
          }}
          onAddField={() => {
            select(layer.id);
            askTable({ kind: 'add_field', layerId: layer.id, table: null, target: null, choice: null });
          }}
        />
      ) : (
        <>
          {(indicator !== null || behind) && (
            <div className="mb-1 flex flex-wrap gap-1">
              {indicator !== null && (
                <ConnectionBadge
                  indicator={indicator}
                  onChange={
                    tree === 'page'
                      ? () => {
                          select(layer.id);
                          openSettings(layer.id, dataTarget);
                        }
                      : undefined
                  }
                  // A feature block that needs a table opens its settings, like the connected pill.
                  opensSettings={indicator.state === 'needs_table' || indicator.state === 'needs_field'}
                />
              )}
              {behind && (
                <NewerVersionPill
                  onOpen={
                    tree === 'page'
                      ? () => {
                          select(layer.id);
                          openSettings(layer.id);
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )}
          {inert ? <div inert>{children}</div> : children}
        </>
      )}
      {parent !== null && zones.after && <DropZone parent={parent} index={index + 1} position="after" orientation={orientation} />}
      {zones.sides && drag !== null && (
        <>
          <SideZone target={layer} side="left" />
          <SideZone target={layer} side="right" />
        </>
      )}
      {parent !== null && handleRight !== null && <ResizeHandle left={layer} right={handleRight} parent={parent} />}
      {parent !== null && placed && showTools && drag === null && <GridResizeHandle layer={layer} parent={parent} name={name} />}
    </div>
  );
}
