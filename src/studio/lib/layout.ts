import type { FeatureMarker, JsonValue, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { canHold } from './layoutTree';
import type { DropTarget } from './layoutTree';

/** A layout layer as a plain deep JSON copy, keeping the name and the feature marker (the renderer and the build ignore the marker, Design needs it). */
export function toLayoutLayer(layer: LayoutLayer): LayoutLayer {
  const out: LayoutLayer = {
    id: layer.id,
    type: layer.type,
    props: JSON.parse(JSON.stringify(layer.props)) as Record<string, JsonValue>,
    children: Array.isArray(layer.children) ? layer.children.map(toLayoutLayer) : typeof layer.children === 'string' ? layer.children : '',
  };
  if (layer.name) out.name = layer.name;
  if (layer.feature) out.feature = JSON.parse(JSON.stringify(layer.feature)) as FeatureMarker;
  if (layer.sizing) out.sizing = { width: layer.sizing.width, grow: layer.sizing.grow };
  if (layer.grid) out.grid = { col: layer.grid.col, span: layer.grid.span, row: layer.grid.row, rowSpan: layer.grid.rowSpan };
  return out;
}

/** What a new page opens with: a heading with the page title on a Page whose root id is `root_<pageId>`. */
export function starterLayout(pageId: string, title: string): LayoutLayer {
  return {
    id: `root_${pageId}`,
    type: 'Page',
    props: {},
    children: [{ id: 'heading_1', type: 'Heading', props: { size: 'lg' }, children: title }],
  };
}

/** The layers under a layer (empty for text children). */
export const childLayers = (layer: LayoutLayer): LayoutLayer[] => (Array.isArray(layer.children) ? layer.children : []);

/** Root to layer, both included; null when the id is not in the tree. Iterative. */
export function pathTo(root: LayoutLayer, id: string): LayoutLayer[] | null {
  const stack: LayoutLayer[][] = [[root]];
  for (let path = stack.pop(); path !== undefined; path = stack.pop()) {
    const last = path[path.length - 1];
    if (last.id === id) return path;
    for (const child of childLayers(last)) stack.push([...path, child]);
  }
  return null;
}

/** Every layer id in a tree. */
export function layerIds(root: LayoutLayer): Set<string> {
  const ids = new Set<string>();
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    ids.add(l.id);
    stack.push(...childLayers(l));
  }
  return ids;
}

export interface Block {
  layer: LayoutLayer;
  marker: FeatureMarker;
  parent: LayoutLayer;
  index: number;
}

/** The outermost feature block that holds the layer (the layer itself or an ancestor), or null. Nested markers are informational. */
export function outermostBlock(root: LayoutLayer, id: string): Block | null {
  const path = pathTo(root, id);
  if (path === null) return null;
  for (let i = 1; i < path.length; i += 1) {
    const marker = path[i].feature;
    if (marker) {
      const parent = path[i - 1];
      return { layer: path[i], marker, parent, index: childLayers(parent).findIndex((c) => c.id === path[i].id) };
    }
  }
  return null;
}

/**
 * Where a new part of this type goes: at the end of the selected container, else right after the selected part in the
 * nearest container that accepts it, else at the end of the page. Never inside a feature block. Null when nothing accepts it.
 */
export function insertionTarget(root: LayoutLayer, selectedId: string | null, type: string): DropTarget | null {
  const path = selectedId === null ? null : pathTo(root, selectedId);
  const usable = (i: number): boolean => path !== null && !path.slice(0, i + 1).some((l) => l.feature !== undefined) && canHold(path[i], type);
  if (path !== null) {
    if (usable(path.length - 1)) return { parentId: path[path.length - 1].id, index: childLayers(path[path.length - 1]).length };
    for (let i = path.length - 2; i >= 0; i -= 1) {
      if (usable(i)) return { parentId: path[i].id, index: childLayers(path[i]).indexOf(path[i + 1]) + 1 };
    }
  }
  return canHold(root, type) ? { parentId: root.id, index: childLayers(root).length } : null;
}

/** The id of the container insertionTarget picks, or null. */
export function insertionParent(root: LayoutLayer, selectedId: string | null, type: string): string | null {
  return insertionTarget(root, selectedId, type)?.parentId ?? null;
}
