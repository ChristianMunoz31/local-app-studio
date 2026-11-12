// Plain words for the Design screen: names of tables, pages, fields, lists and settings, so no id, prop name or class
// name ever reaches the user. Pure.
import type { AppSpec, LayoutLayer, Page, WhereCondition } from '@local-app-studio/runtime/spec/schema';
import { MENU_ROOT_TYPE, MENU_SLOT_TYPE } from '../lib/layoutTree';
import { MENU_SLOT_IDS } from '../lib/menuTree';
import { partLabel } from '../showcase/entries';
import type { ShowcaseEntry } from '../showcase/entries';

/** The plain name of one side of the menu bar: left and right across the top, top and bottom down the side. */
export function menuSideName(side: 'start' | 'end', menuPosition: 'top' | 'side'): string {
  if (menuPosition === 'side') return side === 'end' ? 'Menu bar, bottom' : 'Menu bar, top';
  return side === 'end' ? 'Menu bar, right' : 'Menu bar, left';
}

/**
 * The name shown for a layer: a feature block's own name, else the plain name of its part. A column of Columns, when its
 * Columns part is given, says where it sits: "Column 2 of 3". The menu bar and its two sides are named too: "Menu bar, left" and
 * "Menu bar, right" for the bar across the top, "Menu bar, top" and "Menu bar, bottom" for the bar down the side.
 */
export function blockName(layer: LayoutLayer, parent?: LayoutLayer | null, menuPosition: 'top' | 'side' = 'top'): string {
  if (layer.type === MENU_ROOT_TYPE) return 'Menu bar';
  if (layer.type === MENU_SLOT_TYPE) return menuSideName(layer.id === MENU_SLOT_IDS.end ? 'end' : 'start', menuPosition);
  if (layer.name !== undefined) return layer.name;
  if (layer.type === 'Column' && parent?.type === 'Columns' && Array.isArray(parent.children)) {
    const at = parent.children.findIndex((c) => c.id === layer.id);
    if (at >= 0) return `${partLabel('Column')} ${at + 1} of ${parent.children.length}`;
  }
  return partLabel(layer.type);
}

export const tableLabel = (spec: AppSpec, id: string): string => spec.tables.find((t) => t.id === id)?.label ?? id;
/** A date or datetime field in Chart's Group by: the chart groups it by month, or by day when Dates by says so. */
export const GROUP_BY_DATE = (name: string, bucket: 'day' | 'month'): string => `${name} (by ${bucket})`;

export const pageTitle = (spec: AppSpec, id: string): string => spec.pages.find((p) => p.id === id)?.title ?? id;

export function fieldLabel(spec: AppSpec, tableId: string, fieldId: string): string {
  if (fieldId === 'created_at') return 'Created';
  if (fieldId === 'updated_at') return 'Updated';
  return spec.tables.find((t) => t.id === tableId)?.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
}

export const OP_WORDS: Readonly<Record<WhereCondition['op'], string>> = {
  eq: 'is',
  ne: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
};

const valueWords = (value: WhereCondition['value']): string => (Array.isArray(value) ? value.join(', ') : String(value));
const shorten = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** "The Crews list on this page", "The Crews list on this page (Status is active)", "The Crews record from the page address". */
export function sourceLabel(spec: AppSpec, page: Page, sourceId: string): string {
  const source = page.sources.find((s) => s.id === sourceId);
  if (source === undefined) return sourceId;
  const table = tableLabel(spec, source.table);
  if (source.mode === 'record') return `The ${table} record from the page address`;
  const conditions = source.where ?? [];
  if (conditions.length === 0) return `The ${table} list on this page`;
  const words = conditions.map((c) => `${fieldLabel(spec, source.table, c.field)} ${OP_WORDS[c.op]} ${valueWords(c.value)}`).join(' and ');
  return `The ${table} list on this page (${shorten(words, 60)})`;
}

/** A list of the page named by its table, as the Table choice of a part shows it: "Crews", "Crews (Status is active)". */
export function listChoiceLabel(spec: AppSpec, page: Page, sourceId: string): string {
  const source = page.sources.find((s) => s.id === sourceId);
  if (source === undefined) return sourceId;
  return sourceLabel(spec, page, sourceId).replace(/^The .* list on this page/, tableLabel(spec, source.table));
}

/** Labels for the lists of a page, with " (2)" added to a repeat so two choices never read the same. */
export function sourceChoices(spec: AppSpec, page: Page, ids: readonly string[]): Array<{ value: string; label: string }> {
  const seen = new Map<string, number>();
  return ids.map((value) => {
    const base = sourceLabel(spec, page, value);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { value, label: n === 1 ? base : `${base} (${n})` };
  });
}

/** The settings of a list part that is not a slot: which columns it shows and what a click on a row does. */
export const COLUMNS_LABEL = 'Columns';
export const COLUMNS_HINT = 'Tick up to 8. With none ticked it shows the first five.';
export const ROW_CLICK_LABEL = 'When a row is clicked';
export const ROW_CLICK_NOTHING = 'Does nothing';
export const ROW_CLICK_KEPT = 'Keeps what it does now';
export const rowClickOpens = (title: string): string => `Opens ${title}`;

const TEXT_LABELS: Readonly<Record<string, string>> = {
  'props.title': 'Title',
  'props.subtitle': 'Subtitle',
  'props.label': 'Label',
  'props.placeholder': 'Hint text',
  'props.submitLabel': 'Button label',
  'props.emptyText': 'Text when empty',
  'props.buttonLabel': 'Button text',
  children: 'Text',
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  'props.titleField': 'Title field',
  'props.subtitleField': 'Subtitle field',
  'props.badgeField': 'Badge field',
  'props.groupBy': 'Group by',
  'props.dateField': 'Date field',
};

/** Labels that depend on the part: the same prop name means a different thing in a Chart, a Checklist and a Quick add. */
const PART_FIELD_LABELS: Readonly<Record<string, string>> = {
  'Chart:props.field': 'Number field',
  'ProgressBar:props.field': 'Number field',
  'Checklist:props.field': 'Done field',
  'QuickAdd:props.field': 'Field to fill in',
};

const PAGE_LABELS: Readonly<Record<string, string>> = {
  'props.afterSave.pageId': 'Page after saving',
  'props.rowAction.pageId': 'Page a row opens',
  'props.rowAction.thenPageId': 'Page after that',
  'props.action.thenPageId': 'Page after that',
  'props.page': 'List page',
};

/** The label of a setting, by the place it writes to (and the part type, for a prop name that means different things). */
export function slotLabel(kind: string, target: string, mode?: 'list' | 'record', type?: string): string {
  if (kind === 'text') return TEXT_LABELS[target] ?? 'Text';
  if (kind === 'table') return 'Table';
  if (kind === 'page') return PAGE_LABELS[target] ?? 'Page';
  if (kind === 'source') return mode === 'record' ? 'Record' : 'Table';
  const own = `${type ?? ''}:${target}`;
  if (Object.hasOwn(PART_FIELD_LABELS, own)) return PART_FIELD_LABELS[own];
  return FIELD_LABELS[target] ?? 'Field';
}

const NEEDS: Readonly<Record<string, string>> = {
  Table: 'a table',
  List: 'a list',
  Record: 'a single record',
  Page: 'a page',
  'Number field': 'a number field',
  Field: 'a field',
};

/** What a feature asks of a page, for example "a list and a number field". Texts are not listed: they always have an answer. */
export function needsWords(entry: Pick<ShowcaseEntry, 'params'>): string {
  const words = [...new Set(entry.params.map((p) => NEEDS[p.words]).filter((w): w is string => w !== undefined))];
  if (words.length === 0) return 'something';
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
