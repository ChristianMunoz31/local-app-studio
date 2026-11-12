// The Features showcase list: built-in parts and saved features as one kind of entry, with plain names, one line of
// description, a category and the settings a feature asks for. Pure (no React); the Design palette imports it too.
import { PART_DEFINITIONS } from '@/catalog/definitions';
import type { FeatureParam } from '@/catalog/features';
import { shownParams } from '../lib/featureParams';
import type { FeatureRecord } from '../types';

export type ShowcaseCategory = 'layout' | 'navigation' | 'data' | 'input' | 'action' | 'custom';

/** A smaller heading inside Layout and Data. Other categories have none. */
export type ShowcaseSubgroup = 'structure' | 'text' | 'show' | 'summarize' | 'charts';

/** Fixed display order. */
export const CATEGORY_ORDER: readonly ShowcaseCategory[] = ['layout', 'navigation', 'data', 'input', 'action', 'custom'];

export const SUBGROUP_LABELS: Readonly<Record<ShowcaseSubgroup, string>> = {
  structure: 'Structure',
  text: 'Text',
  show: 'Show',
  summarize: 'Summarize',
  charts: 'Charts',
};

export const CATEGORY_LABELS: Readonly<Record<ShowcaseCategory, string>> = {
  layout: 'Layout',
  navigation: 'Navigation',
  data: 'Records',
  input: 'Input',
  action: 'Actions',
  custom: 'Your features',
};

export interface ParamChip {
  /** The name the feature gives the setting, for example "List". */
  label: string;
  /** What kind of value it takes, in plain words, for example "Number field". */
  words: string;
}

export interface ShowcaseEntry {
  /** 'part:DataTable' or 'feature:kpi_row'. */
  key: string;
  kind: 'part' | 'feature';
  /** The part type or the feature id. */
  id: string;
  name: string;
  description: string;
  category: ShowcaseCategory;
  /** Null for a feature and for a category with no sub-groups. */
  subgroup: ShowcaseSubgroup | null;
  /** Other words people may type to find it; empty for a feature. */
  keywords: readonly string[];
  params: ParamChip[];
  status: 'ok' | 'needs_repair';
  /** 0 for parts. */
  version: number;
  /** When a feature was saved; null for a part. */
  createdAt: string | null;
  /** How many apps use a feature; null for a part. */
  usedInApps: number | null;
  feature?: FeatureRecord;
}

interface PartInfo {
  type: string;
  name: string;
  category: Exclude<ShowcaseCategory, 'custom'>;
  subgroup: ShowcaseSubgroup | null;
  description: string;
  keywords: readonly string[];
}

/** In display order. Page, Tab and Column are never shown. */
const PART_INFO: readonly PartInfo[] = [
  { type: 'Section', name: 'Section', category: 'layout', subgroup: 'structure', description: 'A titled box that groups other parts.', keywords: ['group', 'box', 'panel', 'area'] },
  { type: 'Card', name: 'Card', category: 'layout', subgroup: 'structure', description: 'A framed box for related parts.', keywords: ['box', 'frame', 'tile', 'panel'] },
  { type: 'Columns', name: 'Columns', category: 'layout', subgroup: 'structure', description: 'Two to four columns side by side. You choose what goes in each.', keywords: ['side by side', 'split', 'left', 'right', 'sidebar', 'divs'] },
  { type: 'Row', name: 'Row', category: 'layout', subgroup: 'structure', description: 'Small parts in one line, like a search box next to a button.', keywords: ['inline', 'toolbar', 'horizontal', 'next to'] },
  { type: 'Grid', name: 'Auto grid', category: 'layout', subgroup: 'structure', description: 'Parts that fill even columns, row by row.', keywords: ['grid', 'tiles', 'wrap', 'gallery'] },
  { type: 'Tabs', name: 'Tabs', category: 'layout', subgroup: 'structure', description: 'Splits a page into tabs, one panel for each.', keywords: ['panels', 'switch', 'sections'] },
  { type: 'Collapsible', name: 'Show and hide section', category: 'layout', subgroup: 'structure', description: 'A titled box that opens and closes.', keywords: ['accordion', 'expand', 'fold', 'details'] },
  { type: 'Divider', name: 'Divider line', category: 'layout', subgroup: 'structure', description: 'A thin line that separates parts.', keywords: ['separator', 'rule', 'line'] },
  { type: 'Heading', name: 'Heading', category: 'layout', subgroup: 'text', description: 'A title for a page or a part of it.', keywords: ['title', 'header', 'label'] },
  { type: 'Text', name: 'Text', category: 'layout', subgroup: 'text', description: 'A paragraph of plain text.', keywords: ['paragraph', 'words', 'note'] },
  { type: 'Callout', name: 'Callout', category: 'layout', subgroup: 'text', description: 'A colored box with a note, a tip or a warning.', keywords: ['alert', 'banner', 'tip', 'warning', 'notice'] },
  { type: 'NavLinks', name: 'Page links', category: 'navigation', subgroup: null, description: 'Links to the pages of your app, in a row or a list.', keywords: ['menu', 'nav', 'navigation', 'tabs', 'links'] },
  { type: 'Breadcrumb', name: 'Breadcrumb', category: 'navigation', subgroup: null, description: 'Shows where you are and links back to the list.', keywords: ['trail', 'path', 'back', 'where'] },
  { type: 'BackLink', name: 'Back link', category: 'navigation', subgroup: null, description: 'One link back to another page.', keywords: ['return', 'previous', 'go back'] },
  { type: 'PageHeader', name: 'Page header', category: 'navigation', subgroup: null, description: 'A page title with up to three buttons, links or quick adds beside it.', keywords: ['title bar', 'header', 'top', 'actions'] },
  { type: 'DataTable', name: 'Table of records', category: 'data', subgroup: 'show', description: 'Your records in rows and columns, with paging.', keywords: ['table', 'grid', 'rows', 'spreadsheet', 'list', 'columns'] },
  { type: 'RecordList', name: 'List of records', category: 'data', subgroup: 'show', description: 'Your records as a simple list.', keywords: ['list', 'items', 'rows'] },
  { type: 'RecordDetail', name: 'Record details', category: 'data', subgroup: 'show', description: 'Every field of one record.', keywords: ['detail', 'view', 'profile', 'fields'] },
  { type: 'Timeline', name: 'Timeline', category: 'data', subgroup: 'show', description: 'Records in date order, grouped by day.', keywords: ['history', 'log', 'activity', 'dates', 'schedule'] },
  { type: 'Checklist', name: 'Checklist', category: 'data', subgroup: 'show', description: 'Records with a box to tick when done.', keywords: ['todo', 'tasks', 'done', 'check off'] },
  { type: 'StatCard', name: 'Number tile', category: 'data', subgroup: 'summarize', description: 'One big number, like a count or a total.', keywords: ['kpi', 'metric', 'total', 'count', 'stat'] },
  { type: 'ProgressBar', name: 'Progress bar', category: 'data', subgroup: 'summarize', description: 'How close a number is to a goal.', keywords: ['goal', 'target', 'percent', 'meter'] },
  { type: 'Chart', name: 'Chart', category: 'data', subgroup: 'charts', description: 'Bars or a line that count or add up records by group.', keywords: ['graph', 'bar chart', 'line chart', 'plot', 'report'] },
  { type: 'SearchBox', name: 'Search box', category: 'input', subgroup: null, description: 'A box people type in to find records.', keywords: ['find', 'filter', 'lookup'] },
  { type: 'FilterBar', name: 'Filters', category: 'input', subgroup: null, description: 'Choices that narrow down a list.', keywords: ['filter', 'narrow', 'refine'] },
  { type: 'SortControl', name: 'Sort choice', category: 'input', subgroup: null, description: 'Lets people choose how a list is sorted.', keywords: ['order', 'sort by', 'arrange'] },
  { type: 'RecordForm', name: 'Form', category: 'input', subgroup: null, description: 'A form to add or change a record.', keywords: ['edit', 'create', 'input', 'fields'] },
  { type: 'QuickAdd', name: 'Quick add', category: 'input', subgroup: null, description: 'One box and an Add button. It fills one text of a record; use a Form to fill every field.', keywords: ['add', 'new', 'capture', 'quick entry'] },
  { type: 'ReferencePicker', name: 'Linked record picker', category: 'input', subgroup: null, description: 'Pick a record that belongs to another list.', keywords: ['link', 'relation', 'lookup'] },
  { type: 'Button', name: 'Button', category: 'action', subgroup: null, description: 'A button that opens a page or a form, or removes a record.', keywords: ['click', 'action', 'open'] },
  { type: 'Link', name: 'Link', category: 'action', subgroup: null, description: 'A link to another page.', keywords: ['go to', 'navigate', 'url'] },
];

const PART_BY_TYPE: ReadonlyMap<string, PartInfo> = new Map(PART_INFO.map((p) => [p.type, p]));

/** Part types with no showcase entry; exported for the coverage test. */
export const SHOWCASE_HIDDEN_PARTS: ReadonlySet<string> = new Set(['Page', 'Tab', 'Column']);

/** The plain name of a part, or its type when it has none. */
export function partLabel(type: string): string {
  return PART_BY_TYPE.get(type)?.name ?? type;
}

let partCache: ShowcaseEntry[] | undefined;

/** One entry per built-in part, Page, Tab and Column excluded. Memoized. */
export function partEntries(): ShowcaseEntry[] {
  partCache ??= PART_INFO.filter((p) => PART_DEFINITIONS.some((d) => d.name === p.type)).map(
    (p): ShowcaseEntry => ({
      key: `part:${p.type}`,
      kind: 'part',
      id: p.type,
      name: p.name,
      description: p.description,
      category: p.category,
      subgroup: p.subgroup,
      keywords: p.keywords,
      params: [],
      status: 'ok',
      version: 0,
      createdAt: null,
      usedInApps: null,
    }),
  );
  return partCache;
}

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['integer', 'real']);

function chipOf(p: FeatureParam): ParamChip {
  if (p.type === 'text') return { label: p.label, words: 'Text' };
  if (p.type === 'table') return { label: p.label, words: 'Table' };
  if (p.type === 'source') return { label: p.label, words: p.mode === 'record' ? 'Record' : 'List' };
  if (p.type === 'page') return { label: p.label, words: 'Page' };
  const numeric = p.fieldTypes !== undefined && p.fieldTypes.length > 0 && p.fieldTypes.every((t) => NUMERIC_TYPES.has(t));
  return { label: p.label, words: numeric ? 'Number field' : 'Field' };
}

/** Built-in parts first (by category), then the saved features in the order given. */
export function buildShowcaseEntries(features: readonly FeatureRecord[]): ShowcaseEntry[] {
  const custom = features.map(
    (f): ShowcaseEntry => ({
      key: `feature:${f.id}`,
      kind: 'feature',
      id: f.id,
      name: f.label,
      description: f.description,
      category: 'custom',
      subgroup: null,
      keywords: [],
      params: shownParams(f).map(chipOf),
      status: f.ok ? 'ok' : 'needs_repair',
      version: f.version,
      createdAt: f.createdAt,
      usedInApps: f.usedBy.apps.length,
      feature: f,
    }),
  );
  return [...partEntries(), ...custom];
}

/** Keeps entries of the category (or all) whose name or description contains the query, ignoring case. */
export function filterEntries(entries: readonly ShowcaseEntry[], f: { category: ShowcaseCategory | 'all'; query: string }): ShowcaseEntry[] {
  const q = f.query.trim().toLowerCase();
  return entries.filter(
    (e) => (f.category === 'all' || e.category === f.category) && (q === '' || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)),
  );
}

/** Non-empty categories in the fixed order, each keeping the order of the entries. */
export function groupEntries(entries: readonly ShowcaseEntry[]): { category: ShowcaseCategory; label: string; entries: ShowcaseEntry[] }[] {
  return CATEGORY_ORDER.map((category) => ({ category, label: CATEGORY_LABELS[category], entries: entries.filter((e) => e.category === category) })).filter(
    (g) => g.entries.length > 0,
  );
}
