// The feature half of P17-13. The Feature builder writes default words into the parts it holds, from its own bench table and field
// ("Add to Things to track", "Things to track by Status", "Count of Things to track"). On a block those words belong to the table and
// field the person chose, so before a feature is expanded a text that still equals the builder's default is replaced by the default for
// the chosen ones. A text the person wrote in the builder (anything else) stays. Pure: nothing is mutated.
import type { FeatureDefinition } from '@/catalog/features';
import type { PartContext } from '@/catalog/types';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { LIST_SUFFIX, pairedParams } from './featureParams';
import { chartTitleWords, fieldLabelOf, progressLabelWords, quickAddPlaceholder } from './followWords';
import { statLabel } from './statLabel';

type Words = Pick<FeatureDefinition, 'params' | 'fragment' | 'bindings'>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Where a default text lives, and the default for a table label, a group field label and a stat. */
interface Rule {
  prop: string;
  make(table: string, group: string | undefined, layer: LayoutLayer, field: string | undefined): string;
}

const RULES: Readonly<Record<string, Rule>> = {
  QuickAdd: { prop: 'placeholder', make: (table) => quickAddPlaceholder(table) },
  Chart: { prop: 'title', make: (table, group) => (group === undefined ? '' : chartTitleWords(table, group)) },
  ProgressBar: { prop: 'label', make: (table) => progressLabelWords(table) },
  StatCard: { prop: 'label', make: (table, _group, layer, field) => statLabel(typeof layer.props.stat === 'string' ? layer.props.stat : 'count', field, table) },
};

/** The definition and values to place: the builder's default words replaced, in the parts and in the words settings that still hold them. */
export interface Worded<T> {
  def: T;
  values: Record<string, string>;
}

/**
 * `def` with the builder's default words in its fragment replaced by the default words for the table and fields in `values`, and the
 * same for a words setting (a text value) that still holds the builder's default: a ticked "Things to track by Status" becomes "Crews by
 * Status" for Crews. The same definition and values come back when nothing changes. `spec` names the chosen table and fields; `ctx` tells
 * a list's table.
 */
export function withOwnWords<T extends Words>(def: T, values: Readonly<Record<string, string>>, ctx: PartContext, spec: AppSpec): Worded<T> {
  const pairs = pairedParams(def);
  const paramOf = (layer: LayoutLayer, target: string) => {
    const binding = def.bindings.find((b) => b.layer === layer.id && b.target === target);
    return binding === undefined ? undefined : def.params.find((p) => p.name === binding.param);
  };
  // The table setting of a layer: its label as the builder saw it, and the table now chosen.
  const tableOf = (layer: LayoutLayer): { old: string; table: string } | null => {
    for (const target of ['props.table', 'props.source']) {
      const p = paramOf(layer, target);
      const value = p === undefined ? undefined : values[p.name];
      if (p === undefined || value === undefined) continue;
      if (p.type === 'table') return { old: p.label, table: value };
      const pair = pairs.find((x) => x.list.name === p.name);
      const old = pair === undefined ? (p.label.endsWith(LIST_SUFFIX) ? p.label.slice(0, -LIST_SUFFIX.length) : p.label) : pair.table.label;
      const table = Object.hasOwn(ctx.sources, value) ? ctx.sources[value].table : undefined;
      return table === undefined ? null : { old, table };
    }
    return null;
  };
  const edits = new Map<string, { prop: string; text: string }>();
  const nextValues: Record<string, string> = { ...values };
  const stack: LayoutLayer[] = [def.fragment];
  for (let layer = stack.pop(); layer !== undefined; layer = stack.pop()) {
    if (Array.isArray(layer.children)) stack.push(...layer.children);
    const rule = Object.hasOwn(RULES, layer.type) ? RULES[layer.type] : undefined;
    const base = rule === undefined ? null : tableOf(layer);
    const now = rule === undefined ? undefined : layer.props[rule.prop];
    if (rule === undefined || base === null || typeof now !== 'string') continue;
    const label = spec.tables.find((t) => t.id === base.table)?.label;
    const groupParam = paramOf(layer, 'props.groupBy');
    const fieldParam = paramOf(layer, 'props.field');
    const fieldNow = (p: typeof fieldParam): string | undefined => (p === undefined ? undefined : fieldLabelOf(spec, base.table, values[p.name]));
    const was = rule.make(base.old, groupParam?.label, layer, fieldParam?.label);
    const next = rule.make(label ?? base.old, groupParam === undefined ? undefined : fieldNow(groupParam), layer, fieldNow(fieldParam));
    if (label === undefined || was === '' || next === '' || was !== now || next === now) continue;
    const words = paramOf(layer, `props.${rule.prop}`);
    if (words !== undefined && words.type === 'text') {
      // A words setting people may change: its value follows only while it still is the builder's default.
      if (values[words.name] === was) nextValues[words.name] = next;
    } else {
      edits.set(layer.id, { prop: rule.prop, text: next });
    }
  }
  const changedValues = Object.keys(nextValues).some((k) => nextValues[k] !== values[k]);
  // The very same values object when nothing changed, so a caller comparing by identity sees no change.
  const out = changedValues ? nextValues : (values as Record<string, string>);
  if (edits.size === 0) return { def, values: out };
  const fragment = clone(def.fragment);
  const walk: LayoutLayer[] = [fragment];
  for (let layer = walk.pop(); layer !== undefined; layer = walk.pop()) {
    const edit = edits.get(layer.id);
    if (edit !== undefined) layer.props[edit.prop] = edit.text;
    if (Array.isArray(layer.children)) walk.push(...layer.children);
  }
  return { def: { ...def, fragment }, values: out };
}
