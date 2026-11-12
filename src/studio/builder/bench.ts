// The bench of the Feature builder: a small app held in memory that stands for the feature being made, the three sample tables a
// table slot can show, and the way a saved feature (or a Save as feature input) is put back on the bench (DESIGN-phase16.md 4.3).
// Pure: no React, nothing is mutated. The feature format is unchanged: a slot is made from the existing param types only.
import { getPartDefinition } from '@/catalog/definitions';
import { FEATURE_TYPE, expandFeature, slotsOf, valueAtPath } from '@/catalog/features';
import type { FeatureDefinition, FeatureLibrary, FeatureParam } from '@/catalog/features';
import { partContextFor } from '@/catalog/validateLayout';
import { LIMITS, SPEC_VERSION, isReservedFieldId, isReservedTableId } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, Field, LayoutLayer, Table } from '@local-app-studio/runtime/spec/schema';
import type { HostDoc } from '../design/DesignSession';
import { dataBindOf } from '../lib/bindChoice';
import { slotGroups } from '../lib/featureFromSelection';
import type { SlotGroup } from '../lib/featureFromSelection';
import { newSourceFor } from '../lib/bindOnDrop';
import type { Source } from '../lib/bindOnDrop';
import { toId } from '../lib/ids';
import { fieldNeedsOf, suggestedLabel } from '../lib/partFields';
import type { FieldNeed } from '../lib/partFields';
import { EXAMPLE_OPTIONS, fieldOfType } from '../lib/tableDraft';
import type { FeatureInput } from '../types';

export type SampleId = 'crews' | 'tasks' | 'items';

/** The page the feature is made on (the canvas). */
export const BENCH_PAGE = 'feature';
/** The page a Button or Link can open; it is never shown or edited. */
export const OTHER_PAGE = 'another';
export const SAMPLE_IDS: readonly SampleId[] = ['crews', 'tasks', 'items'];

/**
 * What the panel keeps outside the canvas history: which texts people can change, and the labels of page and text settings. Both are
 * keyed by `panelKeyOf` (the use: layer plus target), so editing the words of a text keeps its tick and its label.
 */
export interface PanelState {
  textOn: ReadonlySet<string>;
  labels: Readonly<Record<string, string>>;
}

/** The panel key of a page or text setting: the first place that uses it (layer plus target), which does not change when its words do. */
export const panelKeyOf = (g: Pick<SlotGroup, 'key' | 'uses'>): string => (g.uses.length === 0 ? g.key : `use|${g.uses[0].layer}|${g.uses[0].target}`);

/** Every key a stored tick or label of the group may sit under: one per use (the first use changes when a part is added before it). */
export const panelKeysOf = (g: Pick<SlotGroup, 'key' | 'uses'>): string[] => (g.uses.length === 0 ? [g.key] : g.uses.map((u) => `use|${u.layer}|${u.target}`));

/** The key the group's tick or label is stored under: the first use that has one, else the first use (where a new one is written). */
export function storedPanelKey(g: Pick<SlotGroup, 'key' | 'uses'>, state: PanelState): string {
  return panelKeysOf(g).find((k) => state.textOn.has(k) || state.labels[k] !== undefined) ?? panelKeyOf(g);
}

const text = (id: string, label: string, required = false): Field => ({ id, label, type: 'text', required });

/** The three sample tables, all labels plain, the title field `name`. */
export const SAMPLE_TABLES: Readonly<Record<SampleId, { label: string; fields: readonly Field[] }>> = Object.freeze({
  crews: {
    label: 'Crews',
    fields: [
      text('name', 'Name', true),
      text('phone', 'Phone'),
      { id: 'status', label: 'Status', type: 'select', required: false, options: ['Active', 'Paused', 'Done'] },
      { id: 'size', label: 'Size', type: 'integer', required: false },
    ],
  },
  tasks: {
    label: 'Tasks',
    fields: [
      text('name', 'Name', true),
      { id: 'due', label: 'Due', type: 'date', required: false },
      { id: 'starts', label: 'Starts', type: 'datetime', required: false },
      { id: 'status', label: 'Status', type: 'select', required: false, options: ['To do', 'Doing', 'Done'] },
      { id: 'done', label: 'Done', type: 'boolean', required: false },
      { id: 'notes', label: 'Notes', type: 'longtext', required: false },
    ],
  },
  items: {
    label: 'Items',
    fields: [
      text('name', 'Name', true),
      { id: 'count', label: 'Count', type: 'integer', required: false },
      { id: 'price', label: 'Price', type: 'real', required: false },
      { id: 'category', label: 'Category', type: 'select', required: false, options: ['Tools', 'Parts', 'Other'] },
    ],
  },
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const TITLE_TYPES: readonly string[] = ['text', 'longtext', 'select'];

/** The bench: no table yet, the canvas page (route "/") and a page that only exists so a Button or Link can open one. */
export function emptyBench(): AppSpec {
  return {
    specVersion: SPEC_VERSION,
    app: { name: 'Your feature', slug: 'your-feature', identifier: 'com.example.yourfeature', version: '1.0.0', description: '', icon: null },
    tables: [],
    pages: [
      { id: BENCH_PAGE, title: 'Your feature', route: '/', sources: [], layout: { id: `root_${BENCH_PAGE}`, type: 'Page', props: {}, children: [] } },
      { id: OTHER_PAGE, title: 'Another page', route: '/another', sources: [], layout: { id: `root_${OTHER_PAGE}`, type: 'Page', props: {}, children: [] } },
    ],
    nav: [
      { pageId: BENCH_PAGE, label: 'Your feature' },
      { pageId: OTHER_PAGE, label: 'Another page' },
    ],
    theme: { preset: 'aurora', radius: 'md' },
  };
}

/** The template a part starts with: the first of Tasks, Items, Crews whose fields cover every need of the part; Crews for a part with no need. */
export function sampleCovering(needs: readonly FieldNeed[]): SampleId {
  // Every template has its Name (a text field), so a need that a text field meets is no reason to leave Crews.
  const real = needs.filter((n) => !n.types.includes('text'));
  if (real.length === 0) return 'crews';
  const order: readonly SampleId[] = ['tasks', 'items', 'crews'];
  return order.find((id) => real.every((n) => SAMPLE_TABLES[id].fields.some((f) => n.types.includes(f.type)))) ?? 'crews';
}

export const sampleFor = (partType: string): SampleId => sampleCovering(fieldNeedsOf(partType));

/** A bench table for a new table slot: unique id, the label, the template's fields plus any need it lacks. */
export function slotTable(label: string, sample: SampleId, needs: readonly FieldNeed[], taken: ReadonlySet<string>): Table {
  const id = toId(label, taken, isReservedTableId);
  const fields: Field[] = SAMPLE_TABLES[sample].fields.map((f) => clone(f));
  const used = new Set(fields.map((f) => f.id));
  for (const need of needs) {
    if (fields.some((f) => need.types.includes(f.type))) continue;
    const type = need.types[0];
    // A link needs another table to point to, and a table slot has none of its own: Add a field slot of type link makes it later.
    if (type === 'reference') continue;
    const added = fieldOfType(suggestedLabel(type, []), type, used, [], type === 'select' ? EXAMPLE_OPTIONS : undefined);
    fields.push(added);
    used.add(added.id);
  }
  return { id, label, titleField: 'name', fields };
}

/** The template the table still matches (the same fields, in order, by id and type), or null for "Your fields". */
export function sampleOf(table: Table): SampleId | null {
  const key = (fields: readonly Field[]): string => fields.map((f) => `${f.id}:${f.type}`).join('|');
  return SAMPLE_IDS.find((id) => key(SAMPLE_TABLES[id].fields) === key(table.fields)) ?? null;
}

function layersOf(root: LayoutLayer): LayoutLayer[] {
  const out: LayoutLayer[] = [];
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    out.push(l);
    if (Array.isArray(l.children)) for (let i = l.children.length - 1; i >= 0; i -= 1) stack.push(l.children[i]);
  }
  return out;
}

/** The fields parts use, by table id: every field slot of every part, followed to the table or list it belongs to. */
export function usedFields(doc: HostDoc): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const layer of layersOf(doc.root)) {
    const slots = slotsOf(layer);
    for (const slot of slots) {
      if (slot.kind !== 'field' || slot.of === undefined || typeof slot.value !== 'string') continue;
      const of = slots.find((s) => s.target === slot.of);
      if (of === undefined || typeof of.value !== 'string') continue;
      const table = of.kind === 'table' ? of.value : doc.sources.find((s) => s.id === of.value)?.table;
      if (table === undefined) continue;
      const set = used.get(table) ?? new Set<string>();
      set.add(slot.value);
      used.set(table, set);
    }
  }
  return used;
}

/** Swaps the fields no part uses for the template's; fields a part uses are kept (ids made unique if they clash), so no part breaks. */
export function switchSample(doc: HostDoc, tableId: string, to: SampleId): HostDoc {
  const table = doc.tables.find((t) => t.id === tableId);
  if (table === undefined) return doc;
  const inUse = usedFields(doc).get(tableId) ?? new Set<string>();
  const keep = table.fields.filter((f) => inUse.has(f.id));
  const taken = new Set<string>(keep.map((f) => f.id));
  const fields: Field[] = [];
  for (const tf of SAMPLE_TABLES[to].fields) {
    const kept = keep.find((f) => f.id === tf.id);
    if (kept !== undefined && kept.type === tf.type) {
      fields.push(kept);
      continue;
    }
    const id = taken.has(tf.id) ? toId(tf.label, taken, isReservedFieldId) : tf.id;
    taken.add(id);
    fields.push({ ...clone(tf), id });
  }
  for (const kept of keep) if (!fields.includes(kept)) fields.push(kept);
  const title = fields.find((f) => f.id === 'name' && f.type === 'text') ?? fields.find((f) => TITLE_TYPES.includes(f.type));
  const next: Table = { ...table, fields: fields.slice(0, LIMITS.fieldsPerTable), ...(title === undefined ? {} : { titleField: title.id }) };
  return { ...doc, tables: doc.tables.map((t) => (t === table ? next : t)) };
}

/** Renames a table slot (the bench table's label). An empty label changes nothing. */
export function renameTableSlot(doc: HostDoc, tableId: string, label: string): HostDoc {
  const next = label.trim();
  if (next === '' || !doc.tables.some((t) => t.id === tableId && t.label !== next)) return doc;
  return { ...doc, tables: doc.tables.map((t) => (t.id === tableId ? { ...t, label: next } : t)) };
}

/** Renames a field of a bench table (what a field slot is shown as). An empty label changes nothing. */
export function renameBenchField(doc: HostDoc, tableId: string, fieldId: string, label: string): HostDoc {
  const next = label.trim();
  const table = doc.tables.find((t) => t.id === tableId);
  if (next === '' || table === undefined || !table.fields.some((f) => f.id === fieldId && f.label !== next)) return doc;
  const fields = table.fields.map((f) => (f.id === fieldId ? { ...f, label: next } : f));
  return { ...doc, tables: doc.tables.map((t) => (t === table ? { ...t, fields } : t)) };
}

/** Which of the table's lists and which of the parts' words a saved feature or an input brings to the bench. */
export interface BenchStart {
  spec: AppSpec;
  state: PanelState;
  /** `one_record` when a setting shows one record, `cannot_hold` when the bench cannot hold the feature's shape for another reason, or null. */
  problem: 'one_record' | 'cannot_hold' | null;
}

const UNSUPPORTED = 'cannot_hold';
const textOf = (layer: LayoutLayer, target: string): string | null => {
  const value = target === 'children' ? layer.children : valueAtPath(layer.props, target.replace(/^props\./, ''));
  return typeof value === 'string' ? value : null;
};

/**
 * The bench and panel state for a saved feature or a Save as feature input: each table or list setting a bench table (label from the
 * setting), each list setting a list of the canvas page, page settings on `another`, text settings ticked, and the fragment with every
 * place a setting fills set to the bench value (the existing expansion does that, so a nested feature comes back as a block).
 */
export function benchFromFeature(input: FeatureInput, library: FeatureLibrary): BenchStart {
  const spec = emptyBench();
  const state: { textOn: Set<string>; labels: Record<string, string> } = { textOn: new Set(), labels: {} };
  const fail = (problem: 'one_record' | 'cannot_hold'): BenchStart => ({ spec, state, problem });
  if (input.params.some((p) => p.type === 'source' && p.mode === 'record')) return fail('one_record');

  const holders = input.params.filter((p) => p.type === 'table' || p.type === 'source');
  const tableOf = new Map<string, Table>();
  const tables: Table[] = [];
  const baseLabel = (p: FeatureParam): string => (p.type === 'source' ? p.label.replace(/ list$/, '') : p.label);
  for (const p of holders) {
    const label = baseLabel(p);
    const same = tables.find((t) => t.label === label);
    if (same !== undefined) {
      tableOf.set(p.name, same);
      continue;
    }
    const table: Table = { id: toId(label, new Set(tables.map((t) => t.id)), isReservedTableId), label, titleField: 'name', fields: [text('name', 'Name', true)] };
    tables.push(table);
    tableOf.set(p.name, table);
  }
  const fieldOf = new Map<string, string>();
  for (const p of input.params) {
    if (p.type !== 'field' || p.of === undefined) continue;
    const table = tableOf.get(p.of);
    if (table === undefined) return fail(UNSUPPORTED);
    const type = p.fieldTypes?.[0] ?? 'text';
    const taken = new Set(table.fields.map((f) => f.id));
    const others = tables.filter((t) => t !== table);
    if (type === 'reference' && others.length === 0) return fail(UNSUPPORTED);
    const id = toId(p.name, taken, isReservedFieldId);
    const made = fieldOfType(p.label, type, new Set([...taken, id]), others, type === 'select' ? EXAMPLE_OPTIONS : undefined);
    table.fields.push({ ...made, id });
    fieldOf.set(p.name, id);
  }
  if (tables.length > LIMITS.tables || tables.some((t) => t.fields.length > LIMITS.fieldsPerTable)) return fail(UNSUPPORTED);

  const sources: Source[] = [];
  const byId = new Map(layersOf(input.fragment).map((l) => [l.id, l]));
  const values: Record<string, string> = {};
  /** Page and text settings, put in the panel state once the fragment is expanded (their layers are renumbered by then). */
  const words: Array<{ kind: 'page' | 'text'; value: string; label: string }> = [];
  for (const p of input.params) {
    if (p.type === 'table') values[p.name] = (tableOf.get(p.name) as Table).id;
    else if (p.type === 'source') {
      sources.push(newSourceFor((tableOf.get(p.name) as Table).id, 'list', sources));
      values[p.name] = sources[sources.length - 1].id;
    } else if (p.type === 'page') {
      values[p.name] = OTHER_PAGE;
      words.push({ kind: 'page', value: OTHER_PAGE, label: p.label });
    } else if (p.type === 'field') values[p.name] = fieldOf.get(p.name) as string;
    else {
      const use = input.bindings.find((b) => b.param === p.name);
      const layer = use === undefined ? undefined : byId.get(use.layer);
      const value = use === undefined || layer === undefined ? null : textOf(layer, use.target);
      values[p.name] = value ?? p.label;
      words.push({ kind: 'text', value: values[p.name], label: p.label });
    }
  }
  if (sources.length > LIMITS.sourcesPerPage) return fail(UNSUPPORTED);
  spec.tables = tables;
  spec.pages[0] = { ...spec.pages[0], sources };

  const def: FeatureDefinition = { id: input.id, label: input.label, description: input.description, version: 1, updatedAt: '', params: input.params, fragment: input.fragment, bindings: input.bindings };
  const made = expandFeature(def, values, partContextFor(spec, spec.pages[0]), library, { rootId: input.fragment.id, takenIds: new Set<string>() });
  if (!made.ok) return fail(UNSUPPORTED);
  const fragment = made.value;
  delete fragment.feature;
  if (input.fragment.name === undefined) delete fragment.name;
  else fragment.name = input.fragment.name;
  spec.pages[0] = { ...spec.pages[0], layout: { id: `root_${BENCH_PAGE}`, type: 'Page', props: {}, children: [fragment] } };
  const groups = slotGroups(fragment, library).groups;
  for (const w of words) {
    const group = groups.find((g) => g.kind === w.kind && g.value === w.value);
    if (group === undefined) continue;
    const key = panelKeyOf(group);
    if (w.kind === 'text') state.textOn.add(key);
    state.labels[key] = w.label;
  }
  return { spec, state, problem: null };
}

/** True when a feature (directly or through the features it holds) holds the feature `id`. */
function holds(def: FeatureDefinition, id: string, library: FeatureLibrary, seen: Set<string>): boolean {
  for (const layer of layersOf(def.fragment)) {
    if (layer.type !== FEATURE_TYPE || typeof layer.props.featureId !== 'string') continue;
    const inner = layer.props.featureId;
    if (inner === id) return true;
    const next = library.get(inner);
    if (next === undefined || seen.has(inner)) continue;
    seen.add(inner);
    if (holds(next, id, library, seen)) return true;
  }
  return false;
}

/** The shelf rule: no Tab (it lives inside Tabs), no part that shows one record, not the feature being edited, and no feature that holds it. */
export function builderHidesEntry(key: string, editingId: string | null, library: FeatureLibrary): boolean {
  if (key === 'part:Tab') return true;
  if (key.startsWith('part:')) {
    const def = getPartDefinition(key.slice('part:'.length));
    return def !== undefined && dataBindOf(def)?.mode === 'record';
  }
  if (!key.startsWith('feature:') || editingId === null) return false;
  const id = key.slice('feature:'.length);
  if (id === editingId) return true;
  const def = library.get(id);
  return def !== undefined && holds(def, editingId, library, new Set([id]));
}
