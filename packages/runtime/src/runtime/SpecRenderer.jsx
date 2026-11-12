// The runtime's own layer renderer (phase 2 contract, 9.1). The vendored RenderLayer pulls in the editor stores and the
// drag and drop context, so a built app would load the editor chunk. This one maps a layer to its catalog component and
// nothing else: no variables, no zod parse, no editor.
import { Component } from 'react';
import { PART_COMPONENTS } from '@/catalog/components';
import { ROW_CLASS, itemClass, sizingSegments } from '../catalog/parts/sizingClasses';
import { gridItemClass } from '../catalog/parts/gridClasses';
import { isFreeGridLayer, readingOrder } from '../spec/gridPlacement';
import { readSizing } from '../spec/sizing';

const NOTE = 'text-sm text-slate-slate400';

class LayerBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <p className={NOTE}>This part could not be shown.</p>;
    return this.props.children;
  }
}

/**
 * The rendered children of a layer: the plain list when nothing is side by side, else rows of sized items
 * (docs/CATALOG.md "Rows of parts"). The raw `sizing` is read with readSizing, never spread.
 */
function renderChildren(layer, components) {
  const kids = layer.children ?? [];
  const one = (child) => <SpecRenderer key={child.id} layer={child} components={components} />;
  if (isFreeGridLayer(layer)) {
    return readingOrder(kids).map((child) => (
      <div key={child.id} className={gridItemClass(child.grid)}>
        {one(child)}
      </div>
    ));
  }
  const segments = sizingSegments(layer.type, kids);
  if (segments.every((s) => s.kind === 'single')) return kids.map(one);
  return segments.map((s) =>
    s.kind === 'single' ? (
      one(kids[s.index])
    ) : (
      // Layer ids never hold a colon (LAYER_ID_RE), so a row key cannot collide with a layer key.
      <div key={`row:${kids[s.indexes[0]].id}`} className={ROW_CLASS}>
        {s.indexes.map((i) => (
          <div key={kids[i].id} className={itemClass(readSizing(kids[i].sizing))}>
            {one(kids[i])}
          </div>
        ))}
      </div>
    ),
  );
}

/**
 * Renders a layout layer and its children.
 * @param {{ layer: { id: string, type: string, sizing?: unknown, grid?: unknown, props: Record<string, unknown>, children: unknown[] | string }, components?: Record<string, import('react').ComponentType<Record<string, unknown>>> }} props
 */
export function SpecRenderer({ layer, components = PART_COMPONENTS }) {
  const Part = Object.hasOwn(components, layer.type) ? components[layer.type] : null;
  if (!Part) return <p className={NOTE}>This part is not available.</p>;
  const children = typeof layer.children === 'string' ? layer.children : renderChildren(layer, components);
  return (
    <LayerBoundary>
      <Part {...layer.props} data-testid={layer.id} data-layer-id={layer.id}>
        {children}
      </Part>
    </LayerBoundary>
  );
}

export default SpecRenderer;
