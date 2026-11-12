// The two handles of a part placed freely on a grid (docs/DESIGN.md "Parts placed freely on a grid", ADR-012): width at the right
// edge, height at the bottom edge, each a focusable separator (APG window splitter). Keyboard: arrows change the size by one cell,
// Home makes it smallest, End as large as the free room allows. Pointer: the canvas previews the place during the drag and the tree
// changes once, on release (one Undo step); Escape or a cancelled pointer drops the preview.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { clampPlace, readGrid } from '@local-app-studio/runtime/spec/gridPlacement';
import type { GridDirection, GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { placeOf, setPlace, stepInGrid } from '../lib/gridLayout';
import { HANDLE_WORDS, columnsSpan, heightWords, rowsSpan, widthWords, withNarrow } from '../lib/gridWords';
import { ChromePortal } from './ChromeLayer';
import { blockName } from './designLabels';
import { useDesign } from './DesignContext';
import { cellAt, measureGrid, narrowGrid } from './gridMetrics';
import { gridReach, placeRefusal, stepRefusal } from './gridSteps';

type Axis = 'width' | 'height';

interface Props {
  layer: LayoutLayer;
  parent: LayoutLayer;
  name: string;
}

interface Drag {
  pointerId: number;
  previewed: GridPlace;
}

const nameOf = (layer: LayoutLayer, parent: LayoutLayer | null): string => blockName(layer, parent);
const sameSize = (a: GridPlace, b: GridPlace): boolean => a.span === b.span && a.rowSpan === b.rowSpan;
const KEY_DIRECTION: Readonly<Record<string, GridDirection>> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/** The 24 px hit areas: one spacing step past the edge, corners left out so the two handles never overlap. */
const BOX: Readonly<Record<Axis, string>> = {
  width: 'pointer-events-none absolute top-0 bottom-6 -right-1 z-10 min-h-6 w-6',
  height: 'pointer-events-none absolute left-0 right-6 -bottom-1 z-10 h-6 min-w-6',
};

const SEPARATOR =
  'group/handle pointer-events-auto flex h-full w-full touch-none items-center justify-center rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';

/** The Grid element a handle's block sits in: the parent of its [data-grid-item] wrapper. */
function gridElement(box: HTMLElement | null): Element | null {
  return box?.closest('[data-grid-item]')?.parentElement ?? null;
}

function Handle({ axis, layer, parent, name, place }: Props & { axis: Axis; place: GridPlace }) {
  const { root, apply, announceGrid, previewGrid, gridPreview } = useDesign();
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const reach = useMemo(() => gridReach(root, layer.id), [root, layer.id]);
  const shown = gridPreview !== null && gridPreview.id === layer.id ? gridPreview.place : null;
  const wide = axis === 'width';

  // A preview never outlives the handle (Undo can remove the part while the pointer is down).
  useEffect(
    () => () => {
      if (drag.current !== null) previewGrid(null);
    },
    [previewGrid],
  );

  const words = useCallback((next: GridPlace): string => withNarrow(wide ? widthWords(next) : heightWords(next), narrowGrid()), [wide]);

  /** Applies a place; a refusal is spoken with the blocker named, a change with its new extent. */
  const commit = useCallback(
    (next: GridPlace): void => {
      if (sameSize(next, place)) return;
      const result = setPlace(root, layer.id, next);
      if (!result.ok) {
        announceGrid(placeRefusal(root, layer.id, next, nameOf) ?? result.message, 'refusal');
        return;
      }
      const refusal = apply(result);
      if (refusal !== null) {
        announceGrid(refusal, 'refusal');
        return;
      }
      announceGrid(words(next), 'step');
    },
    [root, layer.id, place, apply, announceGrid, words],
  );

  const arrow = (dir: GridDirection): void => {
    const result = stepInGrid(root, layer.id, dir, 'resize');
    if (!result.ok) {
      announceGrid(stepRefusal(root, layer.id, dir, 'resize', nameOf) ?? result.message, 'refusal');
      return;
    }
    if (result.root === root) return;
    const refusal = apply(result);
    if (refusal !== null) {
      announceGrid(refusal, 'refusal');
      return;
    }
    const next = placeOf(result.root, layer.id);
    if (next !== null) announceGrid(words(next), 'step');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Alt, Ctrl or Meta with an arrow belongs to the block's keys (move, resize), not to this handle.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape' && drag.current !== null) {
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      previewGrid(null);
      return;
    }
    const dir = KEY_DIRECTION[e.key];
    const own: readonly GridDirection[] = wide ? ['left', 'right'] : ['up', 'down'];
    if (dir !== undefined && own.includes(dir)) {
      e.preventDefault();
      e.stopPropagation();
      arrow(dir);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const size = e.key === 'Home' ? 1 : wide ? reach.span : reach.rowSpan;
      commit(wide ? { ...place, span: size } : { ...place, rowSpan: size });
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { pointerId: e.pointerId, previewed: place };
    previewGrid({ gridId: parent.id, id: layer.id, place });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    const m = measureGrid(gridElement(box.current));
    if (m === null) return;
    const cell = cellAt(m, e.clientX, e.clientY);
    const next = clampPlace(wide ? { ...place, span: cell.col - place.col + 1 } : { ...place, rowSpan: cell.row - place.row + 1 });
    if (sameSize(next, d.previewed)) return;
    d.previewed = next;
    previewGrid({ gridId: parent.id, id: layer.id, place: next });
  };

  const end = (e: PointerEvent<HTMLDivElement>, release: boolean): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    previewGrid(null);
    if (release) commit(d.previewed);
  };

  const current = shown ?? place;
  return (
    <div ref={box} className={BOX[axis]}>
      <ChromePortal targetRef={box} active className="flex items-center justify-center">
        <div
          role="separator"
          aria-orientation={wide ? 'vertical' : 'horizontal'}
          aria-label={wide ? HANDLE_WORDS.width(name) : HANDLE_WORDS.height(name)}
          aria-valuenow={wide ? current.span : current.rowSpan}
          aria-valuemin={1}
          aria-valuemax={wide ? reach.span : reach.rowSpan}
          aria-valuetext={wide ? columnsSpan(current) : rowsSpan(current)}
          tabIndex={0}
          data-grid-handle={axis}
          className={`${SEPARATOR} ${wide ? 'cursor-col-resize' : 'cursor-row-resize'}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => end(e, true)}
          onPointerCancel={(e) => end(e, false)}
          onLostPointerCapture={(e) => end(e, false)}
        >
          <span
            aria-hidden="true"
            className={`block rounded-full ${wide ? 'h-10 max-h-full w-1' : 'h-1 w-10 max-w-full'} ${shown !== null ? 'bg-slate-brand' : 'bg-slate-slate300 group-hover/handle:bg-slate-brandLight'}`}
          />
        </div>
      </ChromePortal>
    </div>
  );
}

export default function GridResizeHandle({ layer, parent, name }: Props) {
  const place = readGrid(layer.grid);
  if (place === null) return null;
  return (
    <>
      <Handle axis="width" layer={layer} parent={parent} name={name} place={place} />
      <Handle axis="height" layer={layer} parent={parent} name={name} place={place} />
    </>
  );
}
