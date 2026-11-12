// What a SearchBox in the app menu bar searches: the first list source of the page that is open. The menu has no sources of
// its own, so the runtime fills `source` and `fields` in at render time. Pure, no zod, type imports only (ADR-006).
import type { LayoutLayer } from '../../spec/schema.ts';
import { titleFieldOf } from './format.ts';

export interface MenuSearchTarget {
  source: string;
  fields: string[];
}

const MAX_FIELDS = 4;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (type: unknown): boolean => type === 'text' || type === 'longtext';

/**
 * The page's first list source (absent mode is list) and its search fields: the title field when it is text or longtext, then
 * the other text and longtext fields in table order, at most 4. Null when the page has no list source or its table has no
 * such field. Tolerant of a spec that was not validated.
 */
export function menuSearchTarget(spec: unknown, pageId: unknown): MenuSearchTarget | null {
  if (!isRecord(spec) || typeof pageId !== 'string') return null;
  const page = (Array.isArray(spec.pages) ? spec.pages : []).find((p): boolean => isRecord(p) && p.id === pageId);
  if (!isRecord(page) || !Array.isArray(page.sources)) return null;
  const source = page.sources.find((s): boolean => isRecord(s) && (s.mode === undefined || s.mode === 'list') && typeof s.id === 'string' && typeof s.table === 'string');
  if (!isRecord(source)) return null;
  const table = (Array.isArray(spec.tables) ? spec.tables : []).find((t): boolean => isRecord(t) && t.id === source.table);
  if (!isRecord(table) || !Array.isArray(table.fields)) return null;
  const fields = table.fields.filter((f): f is { id: string; type: string } => isRecord(f) && typeof f.id === 'string' && typeof f.type === 'string');
  const searchable = fields.filter((f) => isText(f.type));
  if (searchable.length === 0) return null;
  const title = titleFieldOf({
    titleField: typeof table.titleField === 'string' ? table.titleField : undefined,
    fields: fields as Array<{ id: string; type: never }>,
  });
  const ordered = [...searchable.filter((f) => f.id === title), ...searchable.filter((f) => f.id !== title)];
  return { source: source.id as string, fields: ordered.slice(0, MAX_FIELDS).map((f) => f.id) };
}

/**
 * Slot layers ready to render: a SearchBox (also inside a Row) gets `source` and `fields` from the target, or is left out when
 * the target is null; entries that are not objects are dropped. Never mutates its input.
 */
export function resolveMenuLayers(layers: readonly unknown[], target: MenuSearchTarget | null): LayoutLayer[] {
  const out: LayoutLayer[] = [];
  for (const entry of layers) {
    if (!isRecord(entry)) continue;
    const layer = entry as unknown as LayoutLayer;
    if (layer.type === 'SearchBox') {
      if (target === null) continue;
      out.push({ ...layer, props: { ...(isRecord(layer.props) ? layer.props : {}), source: target.source, fields: [...target.fields] }, children: [] });
    } else if (layer.type === 'Row' && Array.isArray(layer.children)) {
      out.push({ ...layer, children: resolveMenuLayers(layer.children, target) });
    } else {
      out.push(layer);
    }
  }
  return out;
}
