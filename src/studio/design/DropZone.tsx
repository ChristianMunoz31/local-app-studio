// A place on the canvas where a part can go. At rest it is a small "Add here" button (shown for the container of the selected part,
// for an empty container and when it has the keyboard focus; always in the tab order, and out of the way of the mouse so a short block can still be clicked). While a part is dragged, the places that accept it show a thin "Drop here" bar
// (a thin vertical bar between the parts of a Row, which sit side by side). SideZone is the place at the left or right side of a
// block, shown only while dragging: a part dropped there sits beside the block (docs/DESIGN.md "Parts side by side").
import { useDroppable } from '@dnd-kit/core';
import { useCallback, useId, useRef } from 'react';
import type { RefObject } from 'react';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { ChromePortal } from './ChromeLayer';
import { findLayer } from '../lib/layoutTree';
import type { SideTarget } from '../lib/layoutTree';
import { blockName } from './designLabels';
import { pillAlign } from './designWords';
import { sideKey, useDesign, zoneKey } from './DesignContext';

export type ZonePosition = 'before' | 'after' | 'fill';

interface Props {
  parent: LayoutLayer;
  index: number;
  /** 'before' and 'after' straddle the edge of a block without taking room; 'fill' is the box of an empty container. */
  position: ZonePosition;
  /** 'inline' for the parts of a Row: the zone is a thin vertical bar at the side of a block, not a bar above or below it. */
  orientation?: 'block' | 'inline';
}

const EDGE: Readonly<Record<ZonePosition, string>> = {
  before: 'absolute inset-x-0 -top-5 z-10 h-5',
  after: 'absolute inset-x-0 -bottom-5 z-10 h-6',
  fill: 'relative min-h-12 w-full rounded-md border border-dashed border-slate-slate600',
};

const INLINE_EDGE: Readonly<Record<ZonePosition, string>> = {
  before: 'absolute inset-y-0 -left-2 z-10 w-4',
  after: 'absolute inset-y-0 -right-2 z-10 w-4',
  fill: EDGE.fill,
};

const BUTTON =
  'rounded-full border border-slate-slate600 bg-slate-slate800 px-2.5 py-0.5 text-sm font-semibold text-slate-slate100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';

/** The stable ref of a drop box: the ref is not emptied and set again on every render while the chrome measures it. */
function useDropBox(setNodeRef: (el: HTMLElement | null) => void): [RefObject<HTMLDivElement | null>, (el: HTMLDivElement | null) => void] {
  const box = useRef<HTMLDivElement | null>(null);
  const setBox = useCallback(
    (el: HTMLDivElement | null): void => {
      box.current = el;
      setNodeRef(el);
    },
    [setNodeRef],
  );
  return [box, setBox];
}

/** The thin vertical "Drop here" bar of an inline or side place. */
function InlineBar({ over, label }: { over: boolean; label: string }) {
  return (
    <span className={`block h-full w-1 rounded-full ${over ? 'bg-slate-brand' : 'bg-slate-slate500'}`} style={{ boxShadow: over ? '0 0 0 2px var(--focus-ring)' : undefined }}>
      <span className="sr-only">{label}</span>
    </span>
  );
}

const SIDE_EDGE: Readonly<Record<SideTarget['side'], string>> = {
  left: 'absolute inset-y-0 -left-2 z-10 w-4',
  right: 'absolute inset-y-0 -right-2 z-10 w-4',
};

/** The place at one side of a block while a part is dragged. Nothing at rest: Width, Shrink and Widen are the keyboard way. */
export function SideZone({ target, side }: { target: LayoutLayer; side: SideTarget['side'] }) {
  const { drag, sideZones } = useDesign();
  const key = sideKey(target.id, side);
  const allowed = drag !== null && sideZones.has(key);
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${key}`, data: { kind: 'side', targetId: target.id, side }, disabled: !allowed });
  const [box, setBox] = useDropBox(setNodeRef);
  if (!allowed) return null;
  return (
    <div ref={setBox} data-zone={key} className={`${SIDE_EDGE[side]} pointer-events-none`}>
      <ChromePortal targetRef={box} active className="flex items-center justify-center">
        <InlineBar over={isOver} label="Drop beside" />
      </ChromePortal>
    </div>
  );
}

export default function DropZone({ parent, index, position, orientation = 'block' }: Props) {
  const { root, drag, zones, pending, addHere, tree, menuPosition, selectedId } = useDesign();
  const key = zoneKey(parent.id, index);
  const dragging = drag !== null;
  const allowed = dragging && zones.has(key);
  // The menu bar's places have a droppable id of their own, so a layer id used in both trees (stored data) never makes two droppables one.
  const { setNodeRef, isOver } = useDroppable({ id: `${tree === 'menu' ? 'mzone' : 'zone'}:${key}`, data: { parentId: parent.id, index, tree }, disabled: !allowed });
  const [box, setBox] = useDropBox(setNodeRef);
  const hintId = useId();
  const chosen = pending !== null && !('kind' in pending) && pending.tree === tree && pending.parentId === parent.id && pending.index === index;

  if (dragging && !allowed) return null;
  // The button shows for the places of the container that holds the selected part and for an empty container; the others show on focus.
  const nearSelection = selectedId !== null && Array.isArray(parent.children) && parent.children.some((c) => c.id === selectedId);
  // An empty page says what to do on the page itself, once, in neutral text; its Add here button stays in the tab order (and the shelf
  // Add buttons work as always) but is not drawn over the hint until it has the focus or the place is chosen.
  const emptyPage = position === 'fill' && tree === 'page' && parent.id === root.id && !dragging && !chosen;
  const visible = chosen || (position === 'fill' && !emptyPage) || nearSelection;
  const inline = orientation === 'inline' && position !== 'fill';
  // A column says which one it is ("Column 2 of 3"), so the place is not named only "Column".
  const name = blockName(parent, parent.type === 'Column' ? (findLayer(root, parent.id)?.parent ?? null) : null, menuPosition);

  return (
    // The box stays in the page (it is the drop target and keeps the room of an empty container); its label or button is
    // drawn in the chrome layer, outside the app's theme.
    <div ref={setBox} data-zone={key} className={`${inline ? INLINE_EDGE[position] : EDGE[position]} pointer-events-none`}>
      {emptyPage && (
        <p id={hintId} data-testid="empty-page-hint" className="flex min-h-12 items-center justify-center text-sm text-slate-slate400">
          Drop a feature here
        </p>
      )}
      <ChromePortal targetRef={box} active className={`flex ${pillAlign(position, inline)} justify-center`}>
        {dragging && inline ? (
          <InlineBar over={isOver} label="Drop here" />
        ) : dragging ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${isOver ? 'bg-slate-brand text-white' : 'bg-slate-slate700 text-slate-slate100'}`}
            style={{ boxShadow: isOver ? '0 0 0 2px var(--focus-ring)' : undefined }}
          >
            Drop here
          </span>
        ) : (
          <button
            type="button"
            aria-label={`${chosen ? 'Adding here' : 'Add here'}: ${name}, place ${index + 1}`}
            aria-describedby={emptyPage ? hintId : undefined}
            className={`${BUTTON} whitespace-nowrap ${inline ? '-translate-y-full' : ''} ${visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100'}`}
            onClick={(e) => {
              e.stopPropagation();
              addHere({ parentId: parent.id, index });
            }}
          >
            {chosen ? 'Adding here' : 'Add here'}
          </button>
        )}
      </ChromePortal>
    </div>
  );
}
