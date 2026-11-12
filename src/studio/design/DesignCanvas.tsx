// The Design canvas: the page drawn with the catalog's own components, inside the app's look, with a selectable block
// around every part and drop zones between them. A saved feature is one block (its parts are drawn but cannot be picked).
// Parts side by side are drawn in rows with the runtime's own class table and grouping (sizingClasses.ts), so the canvas and
// the Preview lay a page out the same way.
import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import { PART_COMPONENTS } from '@/catalog/components';
import { CatalogPageProvider } from '@/catalog/context';
import { getPartDefinition } from '@/catalog/definitions';
import { menuSearchTarget, resolveMenuLayers } from '@local-app-studio/runtime/catalog/parts/menuSearch';
import { ROW_CLASS, SIZED_PARENTS, UNSIZED_TYPES, itemClass, sizingSegments } from '@local-app-studio/runtime/catalog/parts/sizingClasses';
import { gridItemClass } from '@local-app-studio/runtime/catalog/parts/gridClasses';
import SpecRenderer from '@local-app-studio/runtime/runtime/SpecRenderer.jsx';
import { readGrid, readingOrder } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer, Theme } from '@local-app-studio/runtime/spec/schema';
import { readSizing } from '@local-app-studio/runtime/spec/sizing';
import type { LayerSizing } from '@local-app-studio/runtime/spec/sizing';
import { isFreeGrid } from '../lib/gridLayout';
import ThemeScope from '../theme/ThemeScope';
import CanvasBlock from './CanvasBlock';
import { ChromeProvider } from './ChromeLayer';
import { useDesign } from './DesignContext';
import type { DesignContextValue } from './DesignContext';
import DropZone from './DropZone';
import GridDropArea from './GridDropArea';
import MenuCanvas from './MenuCanvas';

const NOTE = 'text-sm text-slate-slate400';

/** One bad layer shows a note instead of taking the canvas down (the runtime renderer does the same). */
class PartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? <p className={NOTE}>This part could not be shown.</p> : this.props.children;
  }
}

interface NodeProps {
  layer: LayoutLayer;
  parent: LayoutLayer | null;
  index: number;
  count: number;
}

function CanvasNode({ layer, parent, index, count }: NodeProps) {
  const { resizing, gridPreview, tree, data } = useDesign();
  const Part = Object.hasOwn(PART_COMPONENTS, layer.type) ? PART_COMPONENTS[layer.type] : null;
  const def = getPartDefinition(layer.type);
  // Tabs and Columns hold only their panels and columns, and a grid lays parts out by position, so none of them offers a place
  // between its parts (a Column is a drop zone of its own, and parts go in it). The parts of a Row get inline zones (DropZone).
  // A free Grid offers no place between its parts either: the cells are its places (GridDropArea).
  const inFree = isFreeGrid(parent);
  const between = parent !== null && parent.type !== 'Tabs' && parent.type !== 'Grid' && parent.type !== 'Columns';
  const zones = {
    before: between && !inFree,
    after: parent !== null && parent.type !== 'Tabs' && parent.type !== 'Columns' && !inFree && index === count - 1,
    // Parts on the menu bar take the room they need: no widths, no side places.
    sides: tree === 'page' && parent !== null && SIZED_PARENTS.has(parent.type) && !UNSIZED_TYPES.has(layer.type),
  };

  if (Part === null || def === undefined) {
    return (
      <CanvasBlock layer={layer} parent={parent} index={index} zones={zones} inert>
        <p className={NOTE}>This part is not available.</p>
      </CanvasBlock>
    );
  }
  // A feature block is one unit: drawn by the runtime renderer, no zones, nothing inside it can be picked.
  if (layer.feature !== undefined) {
    return (
      <CanvasBlock layer={layer} parent={parent} index={index} zones={zones} inert>
        <SpecRenderer layer={layer} />
      </CanvasBlock>
    );
  }
  // A search box on the menu bar has no list of its own: it searches the first list of the page that is open (the runtime's rule).
  if (tree === 'menu' && layer.type === 'SearchBox') {
    const [bound] = resolveMenuLayers([layer], menuSearchTarget(data.spec, data.pageId));
    return (
      <CanvasBlock layer={layer} parent={parent} index={index} zones={zones} inert>
        {bound === undefined ? (
          <p className={NOTE}>Hidden on this page: it has no list.</p>
        ) : (
          <PartBoundary>
            <Part {...bound.props} />
          </PartBoundary>
        )}
      </CanvasBlock>
    );
  }
  if (typeof layer.children === 'string' || def.children !== 'parts') {
    return (
      <CanvasBlock layer={layer} parent={parent} index={index} zones={zones} inert>
        <PartBoundary>
          <Part {...layer.props}>{typeof layer.children === 'string' ? layer.children : undefined}</Part>
        </PartBoundary>
      </CanvasBlock>
    );
  }
  const kids = Array.isArray(layer.children) ? layer.children : [];
  const free = isFreeGrid(layer);
  const emptyZone =
    kids.length === 0 && layer.type !== 'Tabs' && layer.type !== 'Columns' ? (
      free ? (
        <div className="md:col-span-12">
          <DropZone parent={layer} index={0} position="fill" />
        </div>
      ) : (
        <DropZone parent={layer} index={0} position="fill" />
      )
    ) : null;
  return (
    <CanvasBlock layer={layer} parent={parent} index={index} zones={zones} inert={false}>
      <PartBoundary>
        <Part {...layer.props} {...(free ? { className: 'relative' } : {})}>
          {emptyZone}
          {canvasChildren({ parent: layer, kids, resizing, gridPreview })}
          {free && tree === 'page' ? <GridDropArea grid={layer} /> : null}
        </Part>
      </PartBoundary>
    </CanvasBlock>
  );
}

type Resizing = DesignContextValue['resizing'];

/**
 * The blocks of a container: the plain list when nothing is side by side (the same DOM as before rows existed), else rows of
 * sized items like SpecRenderer draws them. An item reads the resize preview first, then its stored width. An array, not a
 * fragment, so a part that counts its children (Columns, PageHeader) still counts the blocks.
 */
function canvasChildren({ parent, kids, resizing, gridPreview }: { parent: LayoutLayer; kids: LayoutLayer[]; resizing: Resizing; gridPreview: DesignContextValue['gridPreview'] }): ReactNode[] {
  const one = (child: LayoutLayer, i: number): ReactNode => <CanvasNode key={child.id} layer={child} parent={parent} index={i} count={kids.length} />;
  // A free Grid: one wrapper per part in reading order (row, then column) with the runtime's own classes; a resize preview wins over the stored place.
  if (isFreeGrid(parent)) {
    return readingOrder(kids).map((child) => {
      const place = gridPreview !== null && gridPreview.id === child.id ? gridPreview.place : child.grid;
      const read = readGrid(place);
      return (
        <div key={child.id} data-grid-item={child.id} data-grid-place={read === null ? '' : `${read.col}:${read.span}:${read.row}:${read.rowSpan}`} className={gridItemClass(place)}>
          {one(child, kids.indexOf(child))}
        </div>
      );
    });
  }
  const segments = sizingSegments(parent.type, kids);
  if (segments.every((s) => s.kind === 'single')) return kids.map(one);
  const sizingOf = (child: LayoutLayer): LayerSizing => {
    if (resizing !== null && resizing.leftId === child.id) return resizing.left;
    if (resizing !== null && resizing.rightId === child.id) return resizing.right;
    return readSizing(child.sizing);
  };
  return segments.map((s) =>
    s.kind === 'single' ? (
      one(kids[s.index], s.index)
    ) : (
      // Layer ids never hold a colon, so a row key cannot collide with a block key (the same keys as SpecRenderer).
      <div key={`row:${kids[s.indexes[0]].id}`} data-sizing-row="" className={ROW_CLASS}>
        {s.indexes.map((i) => (
          <div key={kids[i].id} className={itemClass(sizingOf(kids[i]))}>
            {one(kids[i], i)}
          </div>
        ))}
      </div>
    ),
  );
}

export default function DesignCanvas({ theme, mode }: { theme: Theme; mode?: 'light' | 'dark' }) {
  const { root, data, select } = useDesign();
  // Studio's controls live in this layer, beside the scope and not inside it, so they keep the kit theme (ChromeLayer.tsx).
  const [chrome, setChrome] = useState<HTMLDivElement | null>(null);
  return (
    <div className="relative min-h-full rounded-lg">
      <ChromeProvider layer={chrome}>
        <ThemeScope theme={theme} mode={mode} className="min-h-full rounded-lg" testId="design-canvas">
          <CatalogPageProvider value={data}>
            <div className="min-h-full" onClick={() => select(null)}>
              <MenuCanvas renderNode={(layer, parent, index, count) => <CanvasNode key={layer.id} layer={layer} parent={parent} index={index} count={count} />}>
                <CanvasNode layer={root} parent={null} index={0} count={1} />
              </MenuCanvas>
            </div>
          </CatalogPageProvider>
        </ThemeScope>
      </ChromeProvider>
      <div ref={setChrome} data-testid="design-chrome" className="pointer-events-none absolute inset-0 z-30" />
    </div>
  );
}
