// The handle between two parts side by side on one line (docs/DESIGN.md "Parts side by side"). It sits in the middle of the gap
// at the right edge of the left block and steps both widths through the pair table, so the pair keeps filling its row.
// Keyboard: ArrowLeft and ArrowRight move it one step. Pointer: the canvas previews the widths during the drag and the tree
// changes once, on release (one Undo step); Escape or a cancelled pointer drops the preview.
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { readSizing } from '@local-app-studio/runtime/spec/sizing';
import { WIDTH_UNITS, findLayer, handleCandidates, isShareWidth, resizePair } from '../lib/layoutTree';
import { WIDTH_LABELS, pairChange } from '../lib/sizingWords';
import { ChromePortal } from './ChromeLayer';
import { blockName } from './designLabels';
import { useDesign } from './DesignContext';

interface Props {
  left: LayoutLayer;
  right: LayoutLayer;
  parent: LayoutLayer;
}

interface Drag {
  pointerId: number;
  x: number;
  width: number;
  steps: number;
}

export default function ResizeHandle({ left, right, parent }: Props) {
  const { root, apply, tell, resizing, previewResize } = useDesign();
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const l = readSizing(left.sizing).width;
  const r = readSizing(right.sizing).width;
  const shown = resizing !== null && resizing.leftId === left.id ? resizing : null;
  const leftName = blockName(left, parent);
  const rightName = blockName(right, parent);

  // A preview never outlives the handle (the pair can be removed by Undo while the pointer is down).
  useEffect(() => () => {
    if (drag.current !== null) previewResize(null);
  }, [previewResize]);

  const resize = useCallback(
    (steps: number): void => {
      const result = resizePair(root, left.id, steps);
      // A refusal ("The handle cannot go further this way.") is shown by apply in the status line.
      if (apply(result) !== null || !result.ok || result.root === root) return;
      const nl = readSizing(findLayer(result.root, left.id)?.layer.sizing).width;
      const nr = readSizing(findLayer(result.root, right.id)?.layer.sizing).width;
      if (isShareWidth(nl) && isShareWidth(nr)) tell(pairChange(leftName, nl, rightName, nr), true);
    },
    [root, left, right.id, apply, tell, leftName, rightName],
  );

  // Only the positions that keep every part of the row on its line (a step that would wrap the next part is not offered).
  // The list always holds the current position, so fewer than two means the handle has nowhere to go and is not drawn.
  const candidates = handleCandidates(root, left.id);
  if (!isShareWidth(l) || !isShareWidth(r) || candidates.length < 2) return null;
  const showLeft = shown !== null && isShareWidth(shown.left.width) ? shown.left.width : l;
  const showRight = shown !== null && isShareWidth(shown.right.width) ? shown.right.width : r;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      resize(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Escape' && drag.current !== null) {
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      previewResize(null);
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const row = box.current?.closest<HTMLElement>('[data-sizing-row]');
    const width = row?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { pointerId: e.pointerId, x: e.clientX, width, steps: 0 };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    const wanted = ((e.clientX - d.x) / d.width) * 12;
    let best = candidates[0];
    for (const c of candidates) {
      if (Math.abs(WIDTH_UNITS[c.left] - WIDTH_UNITS[l] - wanted) < Math.abs(WIDTH_UNITS[best.left] - WIDTH_UNITS[l] - wanted)) best = c;
    }
    if (best.steps === d.steps) return;
    d.steps = best.steps;
    previewResize(best.steps === 0 ? null : { leftId: left.id, rightId: right.id, left: { width: best.left, grow: false }, right: { width: best.right, grow: false } });
  };

  const end = (e: PointerEvent<HTMLDivElement>, commit: boolean): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    previewResize(null);
    if (commit && d.steps !== 0) resize(d.steps);
  };

  return (
    <div ref={box} className="pointer-events-none absolute inset-y-0 -right-4 z-10 w-4">
      <ChromePortal targetRef={box} active className="flex items-center justify-center">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${leftName} and ${rightName}`}
          aria-valuenow={WIDTH_UNITS[showLeft]}
          aria-valuemin={WIDTH_UNITS[candidates[0].left]}
          aria-valuemax={WIDTH_UNITS[candidates[candidates.length - 1].left]}
          aria-valuetext={`${WIDTH_LABELS[showLeft]} and ${WIDTH_LABELS[showRight].toLowerCase()}`}
          tabIndex={0}
          className="group/handle pointer-events-auto flex h-full w-4 cursor-col-resize touch-none items-center justify-center rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => end(e, true)}
          onPointerCancel={(e) => end(e, false)}
          onLostPointerCapture={(e) => end(e, false)}
        >
          <span aria-hidden="true" className={`block h-10 max-h-full w-1 rounded-full ${shown !== null ? 'bg-slate-brand' : 'bg-slate-slate600 group-hover/handle:bg-slate-slate400'}`} />
        </div>
      </ChromePortal>
    </div>
  );
}
