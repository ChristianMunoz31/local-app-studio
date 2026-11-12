// Does the app have any part that can add a record? Preview shows a hint when it has tables and no such part.
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { slotLayers } from '@local-app-studio/runtime/spec/menuSlots';
import { buttonKindOf } from './actionKind';

const isLayer = (v: unknown): v is LayoutLayer => typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';

const adds = (layer: LayoutLayer): boolean =>
  layer.type === 'RecordForm' || layer.type === 'QuickAdd' || (layer.type === 'Button' && buttonKindOf(layer) === 'open-form');

/** True when a page layout or the menu bar holds a form, a quick add, or a button that opens a form to add a record. */
export function addsRecords(spec: AppSpec): boolean {
  const stack: LayoutLayer[] = spec.pages.map((p) => p.layout);
  for (const slot of ['start', 'end'] as const) stack.push(...slotLayers(spec.menu, slot).filter(isLayer));
  while (stack.length > 0) {
    const layer = stack.pop();
    if (layer === undefined) continue;
    if (adds(layer)) return true;
    if (Array.isArray(layer.children)) stack.push(...layer.children);
  }
  return false;
}
