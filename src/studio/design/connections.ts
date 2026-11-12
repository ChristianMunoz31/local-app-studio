// Which table each built-in data part on the Design canvas is connected to, for the badge and the "Data connections" list
// (docs/DESIGN.md "Connect a part to a table"). Pure, no React. Feature blocks and the parts inside them get nothing: their
// tables are feature settings.
import { getPartDefinition } from '@/catalog/definitions';
import type { PartContext } from '@/catalog/types';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { dataBindOf } from '../lib/bindChoice';
import { offerFor } from '../lib/bindOnDrop';
import type { ConnectOffer, Source } from '../lib/bindOnDrop';
import { needWords } from '../lib/partFields';
import { blockName, tableLabel } from './designLabels';

export type ConnectionMode = 'shows records' | 'one record' | 'adds records' | 'edits this record';

export type Connection =
  | { state: 'connected'; table: string; tableLabel: string; mode: ConnectionMode }
  | { state: 'not_connected'; target: 'props.source' | 'props.table' };

export type ConnectionTarget = 'props.source' | 'props.table';

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Null: not a built-in data part, a feature block, or a menu part with no data prop (the menu SearchBox). */
export function connectionOf(layer: LayoutLayer, ctx: PartContext, spec: AppSpec): Connection | null {
  if (layer.feature !== undefined) return null;
  const def = getPartDefinition(layer.type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return null;
  const connected = (table: string, mode: ConnectionMode): Connection => ({ state: 'connected', table, tableLabel: tableLabel(spec, table), mode });
  if (bind.kind === 'source') {
    const id = text(layer.props.source);
    if (id === undefined && def.menuProps !== undefined) return null;
    const source = id !== undefined && Object.hasOwn(ctx.sources, id) ? ctx.sources[id] : undefined;
    if (source === undefined) return { state: 'not_connected', target: 'props.source' };
    return connected(source.table, source.mode === 'record' ? 'one record' : 'shows records');
  }
  const table = text(layer.props.table);
  if (table === undefined || !ctx.tableIds.includes(table)) return { state: 'not_connected', target: 'props.table' };
  const sourceId = text(layer.props.source);
  const editing = sourceId !== undefined && Object.hasOwn(ctx.sources, sourceId) && ctx.sources[sourceId].mode === 'record';
  return connected(table, editing ? 'edits this record' : 'adds records');
}

export interface ConnectionIssue {
  /** `${pageId}|${layerId}|not_connected` or `${pageId}|${layerId}|other_table|${table}`. */
  key: string;
  code: 'not_connected' | 'other_table';
  pageId: string;
  pageTitle: string;
  layerId: string;
  target: ConnectionTarget;
  message: string;
  /** not_connected only: what the part can be offered when no table fits, else null. */
  offer: ConnectOffer | null;
  /** other_table only. */
  dismissible: boolean;
}

function walk(layer: LayoutLayer, parent: LayoutLayer | null, visit: (l: LayoutLayer, p: LayoutLayer | null) => void): void {
  if (layer.feature !== undefined) return;
  visit(layer, parent);
  if (Array.isArray(layer.children)) for (const child of layer.children) walk(child, layer, visit);
}

/** Issues of every page, in page order then tree order; the session's draft replaces the saved layout and sources of its page. */
export function connectionIssues(spec: AppSpec, draft: { pageId: string; layout: LayoutLayer; sources: readonly Source[] } | null): ConnectionIssue[] {
  const issues: ConnectionIssue[] = [];
  for (const saved of spec.pages) {
    const page = draft !== null && draft.pageId === saved.id ? { ...saved, layout: draft.layout, sources: [...draft.sources] } : saved;
    const ctx = partContextFor(spec, page);
    const shown = new Set(page.sources.map((s) => s.table));
    walk(page.layout, null, (layer, parent) => {
      const c = connectionOf(layer, ctx, spec);
      if (c === null) return;
      const part = blockName(layer, parent);
      const base = { pageId: page.id, pageTitle: page.title, layerId: layer.id };
      if (c.state === 'not_connected') {
        const offer = offerFor(layer, spec, { id: page.id, title: page.title, route: page.route, sources: [...page.sources] });
        issues.push({
          ...base,
          key: `${page.id}|${layer.id}|not_connected`,
          code: 'not_connected',
          target: c.target,
          message: `The ${part} on ${page.title} needs ${offer !== null && offer.kind === 'no_field' ? needWords(offer.needs) : 'a table'}.`,
          offer,
          dismissible: false,
        });
      } else if (c.mode === 'adds records' && page.sources.length > 0 && !shown.has(c.table)) {
        issues.push({
          ...base,
          key: `${page.id}|${layer.id}|other_table|${c.table}`,
          code: 'other_table',
          target: 'props.table',
          message: `The ${part} on ${page.title} adds to ${c.tableLabel}, but nothing on this page shows ${c.tableLabel}.`,
          offer: null,
          dismissible: true,
        });
      }
    });
  }
  return issues;
}
