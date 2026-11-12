// The one indicator of a data part or a feature block on the Design canvas: connected, needs a table, needs a field, or (in the
// Feature builder) uses a slot. One pure function decides it for the canvas pill, the settings popover, the Data connections list,
// the shelf tiles and the Prompt step's bullets. Pure, no React.
import { getPartDefinition } from '@/catalog/definitions';
import type { FeatureLibrary } from '@/catalog/features';
import type { PartContext } from '@/catalog/types';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { dataBindOf } from '../lib/bindChoice';
import { offerFor } from '../lib/bindOnDrop';
import type { ConnectOffer, DraftPage } from '../lib/bindOnDrop';
import { autoValues } from '../lib/layoutTree';
import { needWords } from '../lib/partFields';
import type { FieldNeed } from '../lib/partFields';
import type { ShowcaseEntry } from '../showcase/entries';
import { entryShowsData } from '../showcase/usesData';
import { connectionOf } from './connections';
import { blockName, tableLabel } from './designLabels';

export type PartIndicator =
  | { state: 'connected'; table: string; tableLabel: string; text: string; target: 'props.source' | 'props.table' | null }
  | { state: 'slot'; table: string; tableLabel: string; text: string; target: 'props.source' | 'props.table' | null }
  | { state: 'needs_table'; text: string; offer: ConnectOffer | null; target: 'props.source' | 'props.table' }
  | { state: 'needs_field'; text: string; needs: readonly FieldNeed[]; tables: readonly string[]; target: 'props.source' | 'props.table' };

export interface IndicatorOptions {
  /** The saved features, so a feature block can name its table. Without it a feature block gets no indicator. */
  library?: FeatureLibrary;
  /** True in the Feature builder: connected reads "Uses slot <Label>". */
  builder?: boolean;
}

export const NEEDS_TABLE = 'Needs a table';
export const connectedText = (label: string): string => `Connected to ${label}`;
export const slotText = (label: string): string => `Uses slot ${label}`;
export const needsFieldText = (needs: readonly FieldNeed[]): string => `Needs ${needWords(needs)}`;

type Target = 'props.source' | 'props.table';

function connectedOf(table: string, spec: AppSpec, target: Target | null, builder: boolean): PartIndicator {
  const label = tableLabel(spec, table);
  return builder ? { state: 'slot', table, tableLabel: label, text: slotText(label), target } : { state: 'connected', table, tableLabel: label, text: connectedText(label), target };
}

const needsTable = (offer: ConnectOffer | null, target: Target): PartIndicator => ({ state: 'needs_table', text: NEEDS_TABLE, offer, target });

/** The first setting of a feature that names a table or a list, in the feature's own order. */
function featureIndicator(layer: LayoutLayer, ctx: PartContext, spec: AppSpec, opts: IndicatorOptions): PartIndicator | null {
  const marker = layer.feature;
  if (marker === undefined) return null;
  const def = opts.library?.get(marker.id);
  if (def === undefined) return null;
  const param = def.params.find((p) => p.type === 'table' || p.type === 'source');
  if (param === undefined) return null;
  const value = Object.hasOwn(marker.params, param.name) ? marker.params[param.name] : undefined;
  if (param.type === 'table') {
    return value !== undefined && ctx.tableIds.includes(value) ? connectedOf(value, spec, null, opts.builder === true) : needsTable(null, 'props.table');
  }
  const source = value !== undefined && Object.hasOwn(ctx.sources, value) ? ctx.sources[value] : undefined;
  return source === undefined ? needsTable(null, 'props.source') : connectedOf(source.table, spec, null, opts.builder === true);
}

/** The indicator of one layer on a page, or null for a part that uses no data. */
export function partIndicator(layer: LayoutLayer, ctx: PartContext, spec: AppSpec, page: DraftPage, opts: IndicatorOptions = {}): PartIndicator | null {
  if (layer.feature !== undefined) return featureIndicator(layer, ctx, spec, opts);
  const connection = connectionOf(layer, ctx, spec);
  if (connection === null) return null;
  if (connection.state === 'connected') {
    const def = getPartDefinition(layer.type);
    const bind = def === undefined ? null : dataBindOf(def);
    return connectedOf(connection.table, spec, bind === null ? null : bind.kind === 'source' ? 'props.source' : 'props.table', opts.builder === true);
  }
  const offer = offerFor(layer, spec, page);
  if (offer !== null && offer.kind === 'no_field') {
    return { state: 'needs_field', text: needsFieldText(offer.needs), needs: offer.needs, tables: offer.tables, target: connection.target };
  }
  return needsTable(offer, connection.target);
}

export interface PartNeed {
  pageId: string;
  pageTitle: string;
  layerId: string;
  /** Plain part name ("Checklist"), from blockName. */
  part: string;
  /** "needs a table" or "needs a yes or no field": the indicator words with a lower-case first letter. */
  text: string;
}

const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** Every part of every page whose indicator is needs_table or needs_field, page order then tree order (Part A's bullets). */
export function specNeeds(spec: AppSpec, library?: FeatureLibrary): PartNeed[] {
  const found: PartNeed[] = [];
  for (const saved of spec.pages) {
    const ctx = partContextFor(spec, saved);
    const page: DraftPage = { id: saved.id, title: saved.title, route: saved.route, sources: [...saved.sources] };
    const visit = (layer: LayoutLayer, parent: LayoutLayer | null): void => {
      const indicator = partIndicator(layer, ctx, spec, page, library === undefined ? {} : { library });
      if (indicator !== null && (indicator.state === 'needs_table' || indicator.state === 'needs_field')) {
        found.push({ pageId: saved.id, pageTitle: saved.title, layerId: layer.id, part: blockName(layer, parent), text: lowerFirst(indicator.text) });
      }
      if (layer.feature !== undefined || !Array.isArray(layer.children)) return;
      for (const child of layer.children) visit(child, layer);
    };
    visit(saved.layout, null);
  }
  return found;
}

/**
 * The tile pill: true when adding the entry here could not connect it. With ctx null (the Features page, no app) it is
 * true for every entry that draws rows (entryShowsData). With a ctx (the Design shelf, the builder shelf): a part with a
 * data bind when ctx.tableIds is empty; a feature with a table or list setting when autoValues(def, ctx) is null.
 */
export function entryNeedsTable(entry: ShowcaseEntry, library: FeatureLibrary, ctx: PartContext | null): boolean {
  if (ctx === null) return entryShowsData(entry, library);
  if (entry.kind === 'part') {
    const def = getPartDefinition(entry.id);
    return def !== undefined && dataBindOf(def) !== null && ctx.tableIds.length === 0;
  }
  const feature = library.get(entry.id);
  if (feature === undefined || !feature.params.some((p) => p.type === 'table' || p.type === 'source')) return false;
  return autoValues(feature, ctx) === null;
}

/** The pill on a feature block that is behind its library, beside the connection pill. */
export const NEWER_VERSION = 'Newer version';
/** The page strip's line: "1 feature on this page has a newer version." */
export const newerVersionLine = (count: number): string => `${count} ${count === 1 ? 'feature on this page has' : 'features on this page have'} a newer version.`;

/** True when the layer is a feature block whose saved version is older than the library's. */
export function isBehind(layer: LayoutLayer, library: FeatureLibrary | undefined): boolean {
  const marker = layer.feature;
  const def = marker === undefined ? undefined : library?.get(marker.id);
  return marker !== undefined && def !== undefined && marker.version < def.version;
}

/** How many feature blocks of a layout are behind the library. */
export function behindCount(root: LayoutLayer, library: FeatureLibrary | undefined): number {
  let count = 0;
  const stack: LayoutLayer[] = [root];
  for (let layer = stack.pop(); layer !== undefined; layer = stack.pop()) {
    if (isBehind(layer, library)) count += 1;
    if (Array.isArray(layer.children)) stack.push(...layer.children);
  }
  return count;
}
