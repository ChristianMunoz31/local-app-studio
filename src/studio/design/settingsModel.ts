// The settings of a built-in part as plain rows: one per place a user may change (text, table, list, page, field) and one per
// choice or number of the part (choiceProps.ts), with the choices the page offers and labels instead of ids. Pure;
// configureLayer is what applies and checks the values.
import { fieldIdsOf, linkablePageIds } from '@/catalog/bindings';
import { slotsOf } from '@/catalog/features';
import { getPartDefinition } from '@/catalog/definitions';
import type { Slot, SlotKind } from '@/catalog/features';
import type { PartContext } from '@/catalog/types';
import { LIMITS } from '@local-app-studio/runtime/spec/schema';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, FieldType, LayoutLayer, Page } from '@local-app-studio/runtime/spec/schema';
import { dataBindOf, defaultRowPage, fittingTables, neededFields, quickAddFits, rankFieldIds, recordPagesFor, RUNTIME_COLUMNS, tableFits } from '../lib/bindChoice';
import { NEW_SOURCE_PREFIX } from '../lib/bindOnDrop';
import { choiceKey, choicePropsOf, choiceValue } from '../lib/choiceProps';
import type { ChoiceOption, ChoiceProp } from '../lib/choiceProps';
import { findLayer } from '../lib/layoutTree';
import { fieldNeedsOf, needWords } from '../lib/partFields';
import { COLUMNS_KEY, KEEP_ROW_ACTION, MAX_COLUMNS, ROW_ACTION_KEY, columnsValue, rowActionValue, specialKeysOf } from '../lib/rowColumns';
import { COLUMNS_LABEL, GROUP_BY_DATE, ROW_CLICK_KEPT, ROW_CLICK_LABEL, ROW_CLICK_NOTHING, fieldLabel, listChoiceLabel, pageTitle, rowClickOpens, slotLabel, sourceChoices, tableLabel } from './designLabels';

const SHOWN: ReadonlySet<SlotKind> = new Set<SlotKind>(['text', 'table', 'source', 'page', 'field']);
const MAX_PAGES = 8;

export interface Choice {
  value: string;
  label: string;
  /** True for a choice the part cannot take; `label` then says why. */
  disabled?: true;
}

/** One thing the popover can change: a slot of the layer, or a choice, number or page list of its part. */
export interface Setting {
  /** The key configureLayer takes: "children" or "props.<path>". */
  target: string;
  kind: SlotKind | 'choice' | 'number' | 'pages' | 'columns' | 'rowAction';
  slot: Slot | null;
  choice: ChoiceProp | null;
  /** What it is now, as the box shows it (pages: a comma list). */
  value: string;
}

export interface SettingRow {
  setting: Setting;
  target: string;
  label: string;
  /** A short text edited in a box; false for text that may run to several lines. */
  multiline: boolean;
  /** The choices of an id, choice or pages setting, null for text and numbers. */
  choices: Choice[] | null;
  /** Not shown now (the pages of a part that shows the app menu, the date step of a chart that groups by a plain field). */
  hidden: boolean;
  min?: number;
  max?: number;
}

/** The places of a part the popover edits. A list of fields (for example the columns) is left to the part's defaults. */
export function editableSettings(layer: LayoutLayer, ctx: PartContext): Setting[] {
  const special = specialKeysOf(layer.type);
  const fromSlots = slotsOf(layer)
    .filter((s) => SHOWN.has(s.kind) && !/\.\d+$/.test(s.target) && typeof s.value === 'string' && !(special.includes(ROW_ACTION_KEY) && s.target.startsWith(`${ROW_ACTION_KEY}.`)))
    .map((slot): Setting => ({ target: slot.target, kind: slot.kind, slot, choice: null, value: String(slot.value) }));
  const fromChoices = choicePropsOf(layer.type).map((choice): Setting => ({ target: choiceKey(choice), kind: choice.kind, slot: null, choice, value: choiceValue(layer, choice, ctx) }));
  const fromSpecial = special.map((target): Setting => ({ target, kind: target === COLUMNS_KEY ? 'columns' : 'rowAction', slot: null, choice: null, value: target === COLUMNS_KEY ? columnsValue(layer) : rowActionValue(layer) }));
  return [...fromSlots, ...fromSpecial, ...fromChoices];
}

const slotsIn = (settings: readonly Setting[]): Slot[] => settings.flatMap((s) => (s.slot === null ? [] : [s.slot]));

/** The values the rows start with, by target. */
export function initialDraft(settings: readonly Setting[]): Record<string, string> {
  return Object.fromEntries(settings.map((s) => [s.target, s.value]));
}

/** The table a field setting belongs to, from the draft values. */
function tableOfField(slot: Slot, slots: readonly Slot[], draft: Readonly<Record<string, string>>, ctx: PartContext): string | null {
  const owner = slot.of === undefined ? undefined : slots.find((s) => s.target === slot.of);
  const value = owner === undefined ? undefined : draft[owner.target];
  if (owner === undefined || value === undefined) return null;
  // "A new list of <Table>" is a choice that is not a source yet: its fields are the table's.
  return tableOfValue(owner, value, ctx);
}

/** The table the draft value of a table or list setting points at ("a new list of <Table>" counts as that table), or null. */
function tableOfValue(owner: Slot, value: string, ctx: PartContext): string | null {
  if (owner.kind === 'table') return ctx.tableIds.includes(value) ? value : null;
  if (value.startsWith(NEW_SOURCE_PREFIX)) {
    const table = value.slice(NEW_SOURCE_PREFIX.length);
    return ctx.tableIds.includes(table) ? table : null;
  }
  return Object.hasOwn(ctx.sources, value) ? ctx.sources[value].table : null;
}

/** The table the part reads or writes, from the draft values of its own List or Table setting. */
function dataTableOf(slots: readonly Slot[], draft: Readonly<Record<string, string>>, ctx: PartContext): string | null {
  const owner = slots.find((s) => (s.kind === 'source' || s.kind === 'table') && (s.target === 'props.source' || s.target === 'props.table'));
  const value = owner === undefined ? undefined : draft[owner.target];
  return owner === undefined || value === undefined ? null : tableOfValue(owner, value, ctx);
}

/** The field ids a field setting may take given the draft. */
function fieldIds(slot: Slot, slots: readonly Slot[], draft: Readonly<Record<string, string>>, ctx: PartContext): string[] {
  const table = tableOfField(slot, slots, draft, ctx);
  return table === null ? [] : fieldIdsOf(ctx, [table], slot.fieldTypes === undefined ? {} : { types: slot.fieldTypes });
}

/** The pages a NavLinks part may list: those that open without a record. */
const pageChoices = (spec: AppSpec, ctx: PartContext): Choice[] => linkablePageIds(ctx).map((value) => ({ value, label: pageTitle(spec, value) }));

/** True when the field a chart groups by is a date or a date and time. */
function groupsByDate(slots: readonly Slot[], draft: Readonly<Record<string, string>>, ctx: PartContext): boolean {
  const group = slots.find((s) => s.target === 'props.groupBy');
  if (group === undefined) return false;
  const table = tableOfField(group, slots, draft, ctx);
  const type = table === null ? undefined : (ctx.fields[table] ?? []).find((f) => f.id === draft[group.target])?.type;
  return type === 'date' || type === 'datetime';
}

/** Why a part cannot take a table, short and in plain words. */
export const QUICK_ADD_REASON = 'needs one text field to fill in';
function whyNot(type: string, table: string, spec: AppSpec): string {
  const found = spec.tables.find((t) => t.id === table);
  if (type === 'QuickAdd' && found !== undefined && !quickAddFits(found)) return QUICK_ADD_REASON;
  const words = needWords(fieldNeedsOf(type));
  return words === '' ? 'does not fit' : `needs ${words}`;
}

/** A table the part cannot take is still listed, so the person sees why: disabled, with the reason after the name. */
const refused = (spec: AppSpec, type: string, table: string, value: string): Choice => ({ value, label: `${tableLabel(spec, table)} (${whyNot(type, table, spec)})`, disabled: true });

/**
 * The "new list" choices of a part's own source setting: one per table of the app, while the page has room for another source. A table
 * that fits (B4 and B8 through fittingTables) is named by its table, one that does not is disabled with the reason. On a record page a
 * record part may also take the record of the page address from a table that has none yet.
 */
function newSourceChoices(slot: Slot, type: string, spec: AppSpec, page: Page, ctx: PartContext): Choice[] {
  const def = getPartDefinition(type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null || bind.kind !== 'source' || slot.target !== `props.${bind.prop}` || page.sources.length >= LIMITS.sourcesPerPage) return [];
  const record = bind.mode === 'record';
  if (record && !ctx.recordPage) return [];
  const fitting = fittingTables(def, bind, ctx, spec.tables).filter((table) => !record || !page.sources.some((s) => s.mode === 'record' && s.table === table));
  const valueOf = (table: string): string => `${NEW_SOURCE_PREFIX}${table}`;
  const shown = fitting.map((table): Choice => {
    if (record) return { value: valueOf(table), label: `New: the ${tableLabel(spec, table)} record from the page address` };
    const again = page.sources.some((s) => s.table === table && s.mode === 'list');
    return { value: valueOf(table), label: again ? `${tableLabel(spec, table)} (another list)` : tableLabel(spec, table) };
  });
  if (record) return shown;
  return [...shown, ...ctx.tableIds.filter((table) => !fitting.includes(table)).map((table) => refused(spec, type, table, valueOf(table)))];
}

/** The lists of the page by their table, with " (2)" added to a repeat. */
function listChoices(spec: AppSpec, page: Page, ids: readonly string[]): Choice[] {
  const seen = new Map<string, number>();
  return ids.map((value) => {
    const base = listChoiceLabel(spec, page, value);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { value, label: n === 1 ? base : `${base} (${n})` };
  });
}

export function settingRows(settings: readonly Setting[], draft: Readonly<Record<string, string>>, spec: AppSpec, page: Page, ctx: PartContext, type: string): SettingRow[] {
  const slots = slotsIn(settings);
  const dataTable = dataTableOf(slots, draft, ctx);
  const hasNumber = dataTable === null || (ctx.fields[dataTable] ?? []).some((f) => f.type === 'integer' || f.type === 'real');
  return settings.map((setting): SettingRow => {
    const base = { setting, target: setting.target, multiline: false, hidden: false };
    const choice = setting.choice;
    if (choice !== null) {
      const when = choice.when;
      const hidden = (when !== undefined && draft[`props.${when.prop}`] !== when.value) || (choice.dateGroupOnly === true && !groupsByDate(slots, draft, ctx));
      // A total or an average needs a number field; the value the part has now stays in the list.
      const offered = (o: ChoiceOption): boolean => o.needsNumber !== true || hasNumber || o.value === draft[setting.target];
      const choices =
        choice.kind === 'pages'
          ? pageChoices(spec, ctx)
          : choice.kind === 'choice'
            ? choice.options.filter(offered).map((o) => ({ value: o.value, label: o.label }))
            : null;
      return { ...base, label: choice.label, choices, hidden, ...(choice.min === undefined ? {} : { min: choice.min }), ...(choice.max === undefined ? {} : { max: choice.max }) };
    }
    if (setting.kind === 'columns') {
      const options = dataTable === null ? [] : fieldIdsOf(ctx, [dataTable]).map((value) => ({ value, label: fieldLabel(spec, dataTable, value) }));
      return { ...base, label: COLUMNS_LABEL, choices: options, hidden: options.length === 0, max: MAX_COLUMNS };
    }
    if (setting.kind === 'rowAction') {
      const pages = dataTable === null ? [] : recordPagesFor(spec, dataTable);
      const options: Choice[] = [{ value: '', label: ROW_CLICK_NOTHING }, ...pages.map((p) => ({ value: p.id, label: rowClickOpens(p.title) }))];
      const now = draft[setting.target] ?? '';
      if (now === KEEP_ROW_ACTION) options.push({ value: now, label: ROW_CLICK_KEPT });
      else if (now !== '' && !pages.some((p) => p.id === now)) options.push({ value: now, label: rowClickOpens(pageTitle(spec, now)) });
      return { ...base, label: ROW_CLICK_LABEL, choices: options, hidden: dataTable === null || ctx.recordPage };
    }
    const slot = setting.slot as Slot;
    let choices: Choice[] | null = null;
    if (slot.kind === 'table') {
      // B8 and B4: every table is listed; the ones the part cannot save to are disabled and say why (the one it has now stays usable).
      const def = getPartDefinition(type);
      const bind = def === undefined ? null : dataBindOf(def);
      const usable = (id: string): boolean => {
        const table = spec.tables.find((t) => t.id === id);
        if (id === draft[setting.target] || def === undefined || bind === null) return true;
        return tableFits(def, bind, id, ctx, false) && (type !== 'QuickAdd' || (table !== undefined && quickAddFits(table)));
      };
      choices = ctx.tableIds.map((value) => (usable(value) ? { value, label: tableLabel(spec, value) } : refused(spec, type, value, value)));
    }
    else if (slot.kind === 'page') choices = (slot.target === 'props.page' ? linkablePageIds(ctx) : ctx.pageIds).map((value) => ({ value, label: pageTitle(spec, value) }));
    else if (slot.kind === 'source') {
      const ids = ctx.sourceIds.filter((id) => slot.mode === undefined || ctx.sources[id].mode === slot.mode);
      choices = [...(slot.mode === 'record' ? sourceChoices(spec, page, ids) : listChoices(spec, page, ids)), ...newSourceChoices(slot, type, spec, page, ctx)];
    }
    else if (slot.kind === 'field') {
      const table = tableOfField(slot, slots, draft, ctx);
      const grouping = type === 'Chart' && slot.target === 'props.groupBy';
      const bucket = draft['props.bucket'] === 'day' ? 'day' : 'month';
      choices = fieldIds(slot, slots, draft, ctx).map((value) => {
        const name = table === null ? value : fieldLabel(spec, table, value);
        const dated = grouping && table !== null && (ctx.fields[table] ?? []).some((f) => f.id === value && (f.type === 'date' || f.type === 'datetime'));
        return { value, label: dated ? GROUP_BY_DATE(name, bucket) : name };
      });
    }
    return { ...base, label: slotLabel(slot.kind, slot.target, slot.mode, type), multiline: slot.target === 'children', choices };
  });
}

/** The draft after one change: field settings that depend on it move to the first field that fits, and a page list that just became visible starts with every page. */
export function changeDraft(
  settings: readonly Setting[],
  draft: Readonly<Record<string, string>>,
  target: string,
  value: string,
  ctx: PartContext,
  spec?: AppSpec,
): Record<string, string> {
  const next: Record<string, string> = { ...draft, [target]: value };
  const slots = slotsIn(settings);
  // A new table makes the old columns meaningless, and a row action only fits a record page of the table the rows come from.
  if (slots.some((s) => s.target === target && (s.kind === 'source' || s.kind === 'table'))) {
    if (Object.hasOwn(next, COLUMNS_KEY)) next[COLUMNS_KEY] = '';
    if (Object.hasOwn(next, ROW_ACTION_KEY) && next[ROW_ACTION_KEY] !== KEEP_ROW_ACTION && spec !== undefined) {
      const table = dataTableOf(slots, next, ctx);
      const fits = table !== null && recordPagesFor(spec, table).some((p) => p.id === next[ROW_ACTION_KEY]);
      if (!fits) next[ROW_ACTION_KEY] = (table === null ? null : defaultRowPage(spec, table)) ?? '';
    }
  }
  for (const slot of slots) {
    if (slot.kind !== 'field' || slot.of !== target) continue;
    const ids = fieldIds(slot, slots, next, ctx);
    const table = tableOfField(slot, slots, next, ctx);
    if (!ids.includes(next[slot.target])) next[slot.target] = rankFieldIds(ids, slot.fieldTypes, table === null ? [] : (ctx.fields[table] ?? []))[0] ?? '';
  }
  for (const s of settings) {
    const c = s.choice;
    if (c === null || c.kind !== 'pages' || c.when === undefined) continue;
    if (next[`props.${c.when.prop}`] === c.when.value && (next[s.target] ?? '') === '') next[s.target] = linkablePageIds(ctx).slice(0, MAX_PAGES).join(',');
  }
  return next;
}

/** The field settings whose table (from the draft) has no declared field of the setting's types: target to the table and the slot's first type. */
export function fieldGaps(settings: readonly Setting[], draft: Readonly<Record<string, string>>, ctx: PartContext): Record<string, { table: string; type: FieldType }> {
  const slots = slotsIn(settings);
  const gaps: Record<string, { table: string; type: FieldType }> = {};
  for (const slot of slots) {
    if (slot.kind !== 'field' || slot.fieldTypes === undefined || slot.fieldTypes.length === 0) continue;
    const table = tableOfField(slot, slots, draft, ctx);
    if (table === null) continue;
    if (!fieldIds(slot, slots, draft, ctx).some((id) => !RUNTIME_COLUMNS.has(id))) gaps[slot.target] = { table, type: slot.fieldTypes[0] };
  }
  return gaps;
}

/** The targets of the part's required field settings that have more than one declared field to pick from, in setting order. */
function choiceTargets(root: LayoutLayer, layerId: string, spec: AppSpec, page: Page): string[] {
  const located = findLayer(root, layerId);
  if (located === null) return [];
  const def = getPartDefinition(located.layer.type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return [];
  const ctx = partContextFor(spec, page);
  const settings = editableSettings(located.layer, ctx);
  const draft = initialDraft(settings);
  const slots = slotsIn(settings);
  const required = new Set(neededFields(def, bind).map((b) => `props.${b.prop}`));
  return slots
    .filter((s) => s.kind === 'field' && required.has(s.target) && fieldIds(s, slots, draft, ctx).filter((id) => !RUNTIME_COLUMNS.has(id)).length > 1)
    .map((s) => s.target);
}

/** True when, after the part was bound, a required field setting has more than one declared field to pick from (runtime columns do not count). */
export function hasFieldChoice(root: LayoutLayer, layerId: string, spec: AppSpec, page: Page): boolean {
  return choiceTargets(root, layerId, spec, page).length > 0;
}

/** The target of the first such setting, or null. */
export function firstFieldChoice(root: LayoutLayer, layerId: string, spec: AppSpec, page: Page): string | null {
  return choiceTargets(root, layerId, spec, page)[0] ?? null;
}

/** Only the settings the user changed. */
export function changedValues(settings: readonly Setting[], draft: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of settings) if (draft[s.target] !== s.value) out[s.target] = draft[s.target];
  return out;
}
