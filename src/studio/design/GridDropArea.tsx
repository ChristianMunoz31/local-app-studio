// What a free Grid shows while a part is dragged over it or one of its handles is dragged (docs/DESIGN.md "Parts placed freely on
// a grid", ADR-012): dotted cells (12 columns and one row more than the Grid has), the one droppable of the Grid, and the target
// (a solid line over the cells the part would take) with its pill. Nothing at rest. No motion.
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { Ban } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { COL_START_CLASS, ROW_START_CLASS, gridAreaClass } from '@local-app-studio/runtime/catalog/parts/gridClasses';
import { GRID_LIMITS, readGridProps } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { TARGET_WORDS } from '../lib/gridWords';
import { ChromePortal } from './ChromeLayer';
import { useDesign } from './DesignContext';
import { dropRowsTemplate, measureGrid } from './gridMetrics';

/** One dotted cell: an outer line that softens the look and an inner outline held at 3:1 against the surfaces (gridOverlayContrast.test.ts). */
const GRID_CELL_CLASS = 'pointer-events-none rounded-sm border border-dotted border-slate-slate500 outline outline-1 outline-dotted -outline-offset-2 outline-slate-slate300';

// text-white on bg-slate-brand is the one pair the theme guarantees (the engine solves the brand fill for 4.5:1 against white; docs/THEMES.md).
/** The cells' own layer: out of the content grid (so unplaced parts never move for it), with the Grid's columns, row template and gap. */
const CELLS_LAYER = 'pointer-events-none absolute inset-x-0 top-0 hidden md:grid md:grid-cols-12 md:auto-rows-[minmax(calc(var(--spacing)*10),auto)]';
const CELLS_GAP: Readonly<Record<string, string>> = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' };
/** The gap of each size in rem (the same as CELLS_GAP): the droppable reaches one empty row (10 spacing units) plus one gap below the Grid. */
const GAP_REM: Readonly<Record<string, number>> = { sm: 0.5, md: 1, lg: 1.5 };

const FREE_PILL = 'rounded-full bg-slate-brand px-2.5 py-0.5 text-sm font-semibold text-white';
const TAKEN_PILL = 'inline-flex items-center gap-1 rounded-full border-2 border-accent-red bg-slate-slate800 px-2.5 py-0.5 text-sm font-semibold text-accent-red';

export default function GridDropArea({ grid }: { grid: LayoutLayer }) {
  const { drag, gridZones, gridHover, gridPreview } = useDesign();
  const accepting = drag !== null && gridZones.has(grid.id);
  const active = accepting || gridPreview?.gridId === grid.id;
  const { setNodeRef, isOver } = useDroppable({ id: `grid:${grid.id}`, data: { kind: 'grid', gridId: grid.id, tree: 'page' }, disabled: !accepting });
  const area = useRef<HTMLDivElement | null>(null);
  const setArea = useCallback(
    (el: HTMLDivElement | null): void => {
      area.current = el;
      setNodeRef(el);
    },
    [setNodeRef],
  );
  const target = useRef<HTMLDivElement | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  // The row sizes the content grid resolved, read when the layer shows (its parent is the Grid); the dotted rows are those rows.
  const [tracks, setTracks] = useState<number[] | null>(null);
  const gridRows = readGridProps(grid.props).rows;
  const gridGap = typeof grid.props?.gap === 'string' ? grid.props.gap : 'md';
  // The margin below moves everything under the Grid after dnd-kit measured its droppables (at drag start), so they are measured
  // again once it is on. The context is read through a ref so the effect below does not run again for each of its updates.
  const { measureDroppableContainers, droppableContainers } = useDndContext();
  const remeasure = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    remeasure.current = (): void => measureDroppableContainers(droppableContainers.toArray().map((c) => c.id));
  });
  useLayoutEffect(() => {
    const gridEl = layer.current?.parentElement ?? null;
    const measured = active ? measureGrid(gridEl) : null;
    setTracks(measured === null ? null : measured.rows);
    // One empty row plus a gap of room below the Grid while it is drawn, so the extra dotted row stays inside the page panel. The
    // runtime Grid forwards no style or class from layer data (editorProps.ts), so the Studio sets it on the element, and only here.
    if (measured === null || gridEl === null) return;
    gridEl.style.marginBottom = `calc(var(--spacing) * 10 + ${GAP_REM[gridGap] ?? GAP_REM.md}rem)`;
    remeasure.current();
    // The rows can change while it is drawn (a part grows, the window is resized): the dotted rows follow, and so do the droppables.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const again = measureGrid(gridEl);
            const rows = again === null ? null : again.rows;
            setTracks((prev) => (prev !== null && rows !== null && prev.length === rows.length && prev.every((n, i) => n === rows[i]) ? prev : rows));
            remeasure.current();
          });
    observer?.observe(gridEl);
    return () => {
      observer?.disconnect();
      gridEl.style.marginBottom = '';
    };
  }, [active, gridRows, gridGap, gridPreview]);
  const rowCount = tracks === null ? gridRows : tracks.length;
  const dotRows = Math.min(rowCount + 1, GRID_LIMITS.maxRow);
  // Up to 720 cells: built again only when the Grid or its row count changes, not on every hover change.
  const cells = useMemo(() => {
    const list: ReactNode[] = [];
    for (let r = 1; r <= dotRows; r += 1) {
      for (let c = 1; c <= GRID_LIMITS.columns; c += 1) {
        list.push(<div key={`${c}:${r}`} aria-hidden="true" data-grid-cell={`${grid.id}:${c}:${r}`} className={`${GRID_CELL_CLASS} ${COL_START_CLASS[c]} ${ROW_START_CLASS[r]}`} />);
      }
    }
    return list;
  }, [grid.id, dotRows]);
  if (!active) return null;
  // The row the cells layer draws below the Grid is a place too, so the droppable (a box the size of the Grid) reaches down over it.
  const extraRow = rowCount < GRID_LIMITS.maxRow;
  const areaStyle = extraRow ? { bottom: `calc(-1 * (var(--spacing) * 10 + ${GAP_REM[gridGap] ?? GAP_REM.md}rem))` } : undefined;

  const template = dropRowsTemplate(tracks);
  const rowStyle = template === null ? undefined : { gridTemplateRows: template };

  const hover = gridHover !== null && gridHover.gridId === grid.id ? gridHover : null;

  return (
    <>
      <div ref={layer} aria-hidden="true" data-grid-cells="" style={rowStyle} className={`${CELLS_LAYER} ${CELLS_GAP[gridGap] ?? CELLS_GAP.md}`}>
        {cells}
      </div>
      {accepting && (
        <div ref={setArea} data-grid-area={grid.id} data-grid-area-extra={extraRow ? '' : undefined} style={areaStyle} className="pointer-events-none absolute inset-0 z-10">
          {hover === null && isOver && (
            <ChromePortal targetRef={area} active className="flex items-center justify-center">
              <span className={FREE_PILL} style={{ boxShadow: '0 0 0 2px var(--focus-ring)' }}>
                {TARGET_WORDS.free}
              </span>
            </ChromePortal>
          )}
        </div>
      )}
      {hover !== null && (
        <div
          ref={target}
          data-grid-target=""
          data-state={hover.free ? 'free' : 'taken'}
          className={`pointer-events-none z-10 rounded-md outline-2 outline-solid ${hover.free ? 'outline-slate-brandLight' : 'outline-accent-red'} ${gridAreaClass(hover.place)}`}
        >
          <ChromePortal targetRef={target} active className="flex items-center justify-center">
            {hover.free ? (
              <span className={FREE_PILL} style={{ boxShadow: '0 0 0 2px var(--focus-ring)' }}>
                {TARGET_WORDS.free}
              </span>
            ) : (
              <span data-grid-taken="" className={TAKEN_PILL}>
                <Ban size={14} aria-hidden="true" />
                {TARGET_WORDS.taken}
              </span>
            )}
          </ChromePortal>
        </div>
      )}
    </>
  );
}
