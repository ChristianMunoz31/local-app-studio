// What the settings of a feature mean to the person who fills them in: which list and table settings are one choice (P17-06), which
// field a setting starts on (P17-10) and which words a text setting starts with (P17-11). Pure, and a leaf: it imports the catalog only,
// so the layout tree and the form can both use it.
import { FEATURE_LIMITS, valueAtPath } from '@/catalog/features';
import type { FeatureDefinition, FeatureParam } from '@/catalog/features';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';

/** A feature's settings as far as these rules read them: the params, and the fragment and bindings when the words are wanted. */
export type FeatureShape = Pick<FeatureDefinition, 'params'> & Partial<Pick<FeatureDefinition, 'fragment' | 'bindings'>>;

/** The label a builder slot gives its list setting: the table setting's label and this ending. */
export const LIST_SUFFIX = ' list';

/** The label of the list setting for a table setting: its label and the ending, the table's words cut so the whole fits a setting label. */
export const listLabelFor = (tableLabel: string): string => `${tableLabel.slice(0, FEATURE_LIMITS.labelChars - LIST_SUFFIX.length).trim()}${LIST_SUFFIX}`;

/** One table setting and the list setting that stands for the same slot. In the app they are one choice. */
export interface ParamPair {
  table: FeatureParam;
  list: FeatureParam;
}

// Control characters other than newline, as the feature format forbids them in a text value.
const CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/**
 * Pairs a list setting "X list" with the table setting "X" (the labels the builder gives one slot), and nothing else: a "Tasks list"
 * beside a "Projects" table are two slots, even when they are the only ones. The format has no link between them (OQ-16-9) and the
 * fragment does not say which table a list reads, so the labels are the rule until it has one.
 */
export function pairedParams(def: Pick<FeatureDefinition, 'params'>): ParamPair[] {
  const tables = def.params.filter((p) => p.type === 'table');
  const lists = def.params.filter((p) => p.type === 'source' && (p.mode ?? 'list') === 'list');
  const pairs: ParamPair[] = [];
  for (const list of lists) {
    const table = tables.find((t) => list.label === listLabelFor(t.label) && !pairs.some((p) => p.table.name === t.name));
    if (table !== undefined) pairs.push({ table, list });
  }
  return pairs;
}

/** The settings a person sees: every setting except the lists that follow a table setting. */
export function shownParams(def: Pick<FeatureDefinition, 'params'>): FeatureParam[] {
  const folded = new Set(pairedParams(def).map((p) => p.list.name));
  return def.params.filter((p) => !folded.has(p.name));
}

/** The order a field setting looks for its default: a choice, a yes or no, a date, a link. Anything else comes after. */
const FIELD_ORDER: readonly string[] = ['select', 'boolean', 'date', 'reference'];

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * The field a field setting starts on among `ids` (the fields that fit it, in table order): the one named like the setting, then a
 * choice, a yes or no, a date, a link, then the rest in table order. Created and Updated only when nothing else fits.
 */
export function pickField(p: Pick<FeatureParam, 'name' | 'label'>, ids: readonly string[], fields: readonly { id: string; type: string }[]): string | undefined {
  const wanted = new Set([slug(p.name), slug(p.label)]);
  const rank = (id: string, order: number): readonly number[] => {
    const type = fields.find((f) => f.id === id)?.type ?? '';
    const at = FIELD_ORDER.indexOf(type);
    return [id === 'created_at' || id === 'updated_at' ? 1 : 0, wanted.has(id) ? 0 : 1, at < 0 ? FIELD_ORDER.length : at, order];
  };
  const ranked = ids.map((id, order) => ({ id, key: rank(id, order) }));
  ranked.sort((a, b) => {
    for (let i = 0; i < a.key.length; i += 1) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    return 0;
  });
  return ranked[0]?.id;
}

function layerById(root: LayoutLayer, id: string): LayoutLayer | undefined {
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    if (l.id === id) return l;
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return undefined;
}

/** The words a text setting starts with: the words in the feature's own parts (the builder canvas), else the setting's label. */
export function textDefault(def: FeatureShape, p: Pick<FeatureParam, 'name' | 'label'>): string {
  const binding = def.bindings?.find((b) => b.param === p.name);
  const layer = binding === undefined || def.fragment === undefined ? undefined : layerById(def.fragment, binding.layer);
  const words = layer === undefined || binding === undefined ? undefined : valueAtPath(layer, binding.target);
  const fits = typeof words === 'string' && words.length >= 1 && words.length <= FEATURE_LIMITS.textValueChars && !CONTROL_RE.test(words);
  return fits ? words : p.label;
}
