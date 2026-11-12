// A plain-language summary of an AppSpec for the Describe review (DESIGN-phase5.md section 5). Pure, no React.
// Code computes every number here; the model supplies none of them.
import type { AppSpec, LayoutLayer, Page } from '@local-app-studio/runtime/spec/schema';
import { MENU_SLOTS, slotLayers } from '@local-app-studio/runtime/spec/menuSlots';
import { readSizing } from '@local-app-studio/runtime/spec/sizing';
import { sanitizeTheme, themeLabel } from '@local-app-studio/runtime/theme';
import { partLabel } from '../showcase/entries';
import { summarySuffix } from './sizingWords';

const SHOWN = 6;
const UNKNOWN_TABLE = 'your data';

export interface TableSummary {
  id: string;
  label: string;
  fieldCount: number;
  /** The first 6 field labels, in spec order. */
  fieldLabels: string[];
  moreFields: number;
}

export interface PageSummary {
  id: string;
  title: string;
  inMenu: boolean;
  /** True when the page opens from a list (its address holds a record number). */
  opensFromList: boolean;
  /** Distinct plain sentences about what the page shows, first 6. */
  parts: string[];
  moreParts: number;
}

export interface SpecSummary {
  headline: string;
  tables: TableSummary[];
  pages: PageSummary[];
  /** Distinct names of the features used (from the markers), in document order across pages. */
  features: string[];
  /** The look's name ('Forest'), or null while the app has no theme (the standard look). */
  theme: string | null;
  /** The menu bar in words ('across the top, icons and words'), or null when the app has none (Classic). */
  menu: string | null;
}

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

function tableOfLayer(spec: AppSpec, page: Page, layer: LayoutLayer): string {
  const { table, source } = layer.props;
  const id =
    typeof table === 'string' ? table : typeof source === 'string' ? page.sources.find((s) => s.id === source)?.table : undefined;
  if (id === undefined) return UNKNOWN_TABLE;
  return spec.tables.find((t) => t.id === id)?.label ?? UNKNOWN_TABLE;
}

/** The name of a feature block: its layer name, else the marker id. */
const featureName = (layer: LayoutLayer): string | null =>
  layer.feature === undefined ? null : (layer.name ?? layer.feature.id);

/** The sentence of a layer with its width when it is not the whole row: "a number: Total (half the row)". */
function sentenceOf(spec: AppSpec, page: Page, layer: LayoutLayer): string | null {
  const sentence = baseSentence(spec, page, layer);
  return sentence === null ? null : `${sentence}${summarySuffix(readSizing(layer.sizing))}`;
}

function baseSentence(spec: AppSpec, page: Page, layer: LayoutLayer): string | null {
  const feature = featureName(layer);
  if (feature !== null) return `the feature ${feature}`;
  switch (layer.type) {
    case 'DataTable':
    case 'RecordList':
      return `a list of ${tableOfLayer(spec, page, layer)}`;
    case 'RecordForm':
      return `a form for ${tableOfLayer(spec, page, layer)}`;
    case 'RecordDetail':
      return `the details of one ${tableOfLayer(spec, page, layer)} record`;
    case 'StatCard': {
      const label = layer.props.label;
      return typeof label === 'string' && label.trim() !== '' ? `a number: ${label}` : `a number about ${tableOfLayer(spec, page, layer)}`;
    }
    case 'FilterBar':
      return `filters for ${tableOfLayer(spec, page, layer)}`;
    case 'SearchBox':
      return `a search box for ${tableOfLayer(spec, page, layer)}`;
    default:
      return null;
  }
}

/** Calls `visit` for every layer of a page in document order, iteratively; a feature block's subtree is skipped. */
function walkPage(page: Page, visit: (layer: LayoutLayer) => void): void {
  const stack: LayoutLayer[] = [page.layout];
  for (let layer = stack.pop(); layer !== undefined; layer = stack.pop()) {
    visit(layer);
    if (featureName(layer) !== null) continue;
    if (Array.isArray(layer.children)) {
      for (let i = layer.children.length - 1; i >= 0; i -= 1) stack.push(layer.children[i]);
    }
  }
}

/** True when a layer on the page reads the source (a source with no layer shows nothing). */
export function pageUsesSource(page: Page, sourceId: string): boolean {
  let used = false;
  walkPage(page, (layer) => {
    if (layer.props.source === sourceId) used = true;
  });
  return used;
}

/** The distinct sentences and feature names of a page (the walk of `walkPage`). */
function partsOf(spec: AppSpec, page: Page): { parts: string[]; features: string[] } {
  const seen = new Set<string>();
  const features: string[] = [];
  walkPage(page, (layer) => {
    const sentence = sentenceOf(spec, page, layer);
    if (sentence !== null) seen.add(sentence);
    const feature = featureName(layer);
    if (feature !== null) features.push(feature);
  });
  return { parts: [...seen], features };
}

export type PartKind = 'list' | 'form' | 'record' | 'number' | 'filters' | 'search' | 'feature' | 'data';
export interface PartPhrase {
  kind: PartKind;
  /** The table label, or null when the part names no table that exists. */
  table: string | null;
  /** A number tile's label or a feature's name, else null. */
  label: string | null;
  /** `partLabel(type)`; for `data`, the part that draws the rows (Chart, Checklist, Timeline). */
  part: string;
}

const KIND_BY_TYPE: Readonly<Record<string, PartKind>> = {
  DataTable: 'list',
  RecordList: 'list',
  RecordForm: 'form',
  RecordDetail: 'record',
  StatCard: 'number',
  FilterBar: 'filters',
  SearchBox: 'search',
};

function tableLabelOf(spec: AppSpec, page: Page, layer: LayoutLayer): string | null {
  const label = tableOfLayer(spec, page, layer);
  return label === UNKNOWN_TABLE ? null : label;
}

function phraseOf(spec: AppSpec, page: Page, layer: LayoutLayer): PartPhrase | null {
  const feature = featureName(layer);
  if (feature !== null) return { kind: 'feature', table: null, label: feature, part: partLabel(layer.type) };
  const kind = KIND_BY_TYPE[layer.type];
  if (kind !== undefined) {
    const label = layer.props.label;
    return {
      kind,
      table: tableLabelOf(spec, page, layer),
      label: kind === 'number' && typeof label === 'string' && label.trim() !== '' ? label : null,
      part: partLabel(layer.type),
    };
  }
  const { table, source } = layer.props;
  if (typeof table === 'string' || typeof source === 'string') {
    return { kind: 'data', table: tableLabelOf(spec, page, layer), label: null, part: partLabel(layer.type) };
  }
  return null;
}

/** Distinct parts of a page in document order, a feature block's subtree skipped (the same walk as `summarizeSpec`). */
export function pagePhrases(spec: AppSpec, page: Page): PartPhrase[] {
  const seen = new Set<string>();
  const out: PartPhrase[] = [];
  walkPage(page, (layer) => {
    const phrase = phraseOf(spec, page, layer);
    if (phrase === null) return;
    const key = `${phrase.kind}|${phrase.table ?? ''}|${phrase.label ?? ''}|${phrase.part}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(phrase);
  });
  return out;
}

/** How many parts a menu block holds in its slots, Rows and their parts included. Tolerant of a block that was not validated. */
export function countMenuLayers(menu: unknown): number {
  let count = 0;
  const stack: unknown[] = MENU_SLOTS.flatMap((slot) => [...slotLayers(menu, slot)]);
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (typeof item !== 'object' || item === null) continue;
    count += 1;
    const children = (item as { children?: unknown }).children;
    if (Array.isArray(children)) stack.push(...children);
  }
  return count;
}

/** The menu block in words. Anything the schema does not know falls back to its default, like the runtime does. */
function menuWords(menu: AppSpec['menu']): string | null {
  if (menu === undefined || menu === null || typeof menu !== 'object') return null;
  const where = menu.position === 'side' ? 'down the side' : 'across the top';
  const parts = countMenuLayers(menu);
  const extra = parts === 0 ? '' : `, with ${parts} ${parts === 1 ? 'part' : 'parts'}`;
  return `${where}, ${menu.style === 'labels' ? 'words only' : 'icons and words'}${extra}`;
}

export function summarizeSpec(spec: AppSpec): SpecSummary {
  const tableCount = spec.tables.length;
  const pageCount = spec.pages.length;
  const headline = `${tableCount === 0 ? 'No tables yet' : plural(tableCount, 'table')} and ${plural(pageCount, 'page')}.`;
  const tables = spec.tables.map((t) => ({
    id: t.id,
    label: t.label,
    fieldCount: t.fields.length,
    fieldLabels: t.fields.slice(0, SHOWN).map((f) => f.label),
    moreFields: Math.max(0, t.fields.length - SHOWN),
  }));
  const featureNames = new Set<string>();
  const pages = spec.pages.map((page) => {
    const { parts: all, features } = partsOf(spec, page);
    for (const name of features) featureNames.add(name);
    return {
      id: page.id,
      title: page.title,
      inMenu: spec.nav.some((n) => n.pageId === page.id),
      opensFromList: page.route.includes('/:'),
      parts: all.slice(0, SHOWN),
      moreParts: Math.max(0, all.length - SHOWN),
    };
  });
  const look = sanitizeTheme(spec.theme);
  return { headline, tables, pages, features: [...featureNames], theme: look.id === null ? null : themeLabel(look), menu: menuWords(spec.menu) };
}

/** "a, b and c"; with a remainder: "a, b and 2 more". */
function joinWords(items: readonly string[], more: number): string {
  if (more > 0) return `${items.join(', ')} and ${more} more`;
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "Name, Size, Lead, Status"; with a remainder: "Name, Size and 2 more". */
function joinList(items: readonly string[], more: number): string {
  return more > 0 ? `${items.join(', ')} and ${more} more` : items.join(', ');
}

/** 'Crews: 4 fields (Name, Size, Lead, Status)'. */
export function tableLine(t: TableSummary): string {
  const fields = t.fieldCount === 0 ? '' : ` (${joinList(t.fieldLabels, t.moreFields)})`;
  return `${t.label}: ${plural(t.fieldCount, 'field')}${fields}`;
}

/** 'Home: a list of Crews and a form for Crews'; no parts: 'Home: words only, nothing that shows or adds records'. */
export function pageLine(p: PageSummary): string {
  return `${p.title}: ${p.parts.length === 0 ? 'words only, nothing that shows or adds records' : joinWords(p.parts, p.moreParts)}`;
}

/** 'Look: Forest.' for the review, or null when the look is the same as before (or standard). */
export function lookLine(proposed: string | null, before: string | null): string | null {
  if (proposed === null || proposed === before) return null;
  return `Look: ${proposed}.`;
}

/** 'Menu: across the top, icons and words.' for the review, or null when there is no menu bar or it is the same as before. */
export function menuLine(proposed: string | null, before: string | null): string | null {
  if (proposed === null || proposed === before) return null;
  return `Menu: ${proposed}.`;
}

/** 'Uses your features: A, B and C.' for the review, or null when no feature is used. */
export function featuresLine(features: readonly string[]): string | null {
  if (features.length === 0) return null;
  return `Uses your features: ${joinWords(features, 0)}.`;
}
