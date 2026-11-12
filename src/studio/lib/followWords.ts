// Words the Studio wrote follow the table and field (phase 17, P17-13). A part gets default words when it is connected ("Add to Crews",
// "Crews by Status", "Sum of Amount"); when its table or group field changes later, a text that still equals the default of the OLD
// binding is rewritten to the default of the new one. A text the person typed (anything else) stays. Pure: nothing is mutated.
import { LIMITS } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer, Page } from '@local-app-studio/runtime/spec/schema';
import { findLayer, replaceLayer } from './layoutTree';
import type { TreeResult } from './layoutTree';
import { statLabelFor } from './statLabel';

type Source = Page['sources'][number];

const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max).trimEnd() : text);

/** The default words that name a table to add to: a Quick add's placeholder (cut to 60) and a menu Button's text. */
export const addToWords = (tableLabel: string): string => `Add to ${tableLabel}`;
/** The default placeholder of a Quick add. */
export const quickAddPlaceholder = (tableLabel: string): string => cut(addToWords(tableLabel), 60);
/** The default title of a Chart. */
export const chartTitleWords = (tableLabel: string, groupLabel: string): string => cut(`${tableLabel} by ${groupLabel}`, LIMITS.labelChars);
/** The default label of a Progress bar. */
export const progressLabelWords = (tableLabel: string): string => cut(tableLabel, LIMITS.labelChars);

/** The label of a field of a table, the built-in Created and Updated included; undefined when there is no such field. */
export function fieldLabelOf(spec: AppSpec, table: string, field: unknown): string | undefined {
  if (field === 'created_at') return 'Created';
  if (field === 'updated_at') return 'Updated';
  return spec.tables.find((t) => t.id === table)?.fields.find((f) => f.id === field)?.label;
}

const tableLabelOf = (spec: AppSpec, table: string): string | undefined => spec.tables.find((t) => t.id === table)?.label;

/** The table of a part by its own props: its table, else the table of its list. */
function tableOf(layer: LayoutLayer, sources: readonly Source[]): string | undefined {
  const { table, source } = layer.props;
  if (typeof table === 'string') return table;
  return typeof source === 'string' ? sources.find((s) => s.id === source)?.table : undefined;
}

/** The table a menu or page Button adds to ("open-form" in create mode), or undefined. */
function buttonTable(layer: LayoutLayer): string | undefined {
  const action = layer.props.action;
  if (typeof action !== 'object' || action === null || Array.isArray(action)) return undefined;
  const { action: kind, table, mode } = action as Record<string, unknown>;
  return kind === 'open-form' && mode === 'create' && typeof table === 'string' ? table : undefined;
}

/** Where a default text lives and what the same default rule makes for a layer's binding (null: not a default-worded binding). */
interface Rule {
  type: string;
  read(layer: LayoutLayer): string | null;
  make(layer: LayoutLayer, spec: AppSpec, sources: readonly Source[]): string | null;
  write(layer: LayoutLayer, text: string): LayoutLayer;
}

const prop = (name: string) => ({
  read: (layer: LayoutLayer): string | null => (typeof layer.props[name] === 'string' ? (layer.props[name] as string) : null),
  write: (layer: LayoutLayer, text: string): LayoutLayer => ({ ...layer, props: { ...layer.props, [name]: text } }),
});

const RULES: readonly Rule[] = [
  {
    type: 'QuickAdd',
    ...prop('placeholder'),
    make: (layer, spec) => {
      const label = typeof layer.props.table === 'string' ? tableLabelOf(spec, layer.props.table) : undefined;
      return label === undefined ? null : quickAddPlaceholder(label);
    },
  },
  {
    type: 'Button',
    read: (layer) => (typeof layer.children === 'string' ? layer.children : null),
    make: (layer, spec) => {
      const table = buttonTable(layer);
      const label = table === undefined ? undefined : tableLabelOf(spec, table);
      return label === undefined ? null : addToWords(label);
    },
    write: (layer, text) => ({ ...layer, children: text }),
  },
  {
    type: 'Chart',
    ...prop('title'),
    make: (layer, spec, sources) => {
      const table = tableOf(layer, sources);
      const label = table === undefined ? undefined : tableLabelOf(spec, table);
      const group = table === undefined ? undefined : fieldLabelOf(spec, table, layer.props.groupBy);
      return label === undefined || group === undefined ? null : chartTitleWords(label, group);
    },
  },
  {
    type: 'ProgressBar',
    ...prop('label'),
    make: (layer, spec, sources) => {
      const table = tableOf(layer, sources);
      const label = table === undefined ? undefined : tableLabelOf(spec, table);
      return label === undefined ? null : progressLabelWords(label);
    },
  },
  {
    type: 'StatCard',
    ...prop('label'),
    make: (layer, spec, sources) => statLabelFor(spec, tableOf(layer, sources), layer.props.stat, layer.props.field),
  },
];

/**
 * `after` (the layer once its table, list or group field changed) with each Studio-made text rewritten: a text is rewritten only
 * when it still equals what the same default rule makes for `before`'s binding, so words the person typed stay. `sources` are the
 * page's lists, which both layers read. Returns `after` itself when nothing changes.
 */
export function followWords(before: LayoutLayer, after: LayoutLayer, spec: AppSpec, sources: readonly Source[], afterSpec: AppSpec = spec): LayoutLayer {
  if (before.type !== after.type || after.feature !== undefined) return after;
  const rule = RULES.find((r) => r.type === after.type);
  if (rule === undefined) return after;
  const old = rule.make(before, spec, sources);
  const next = rule.make(after, afterSpec, sources);
  if (old === null || next === null || old === next) return after;
  const now = rule.read(after);
  // Only a text equal to the old binding's own default is the Studio's: a Number tile the person labelled "Total" stays.
  return now === old ? rule.write(after, next) : after;
}

/**
 * The result of a settings change with the words of the changed part following it (followWords). `before` is the tree as it was.
 * A refused result, a part that is gone, or words that need no change come back as they were.
 */
export function followResult(before: LayoutLayer, result: TreeResult, id: string, spec: AppSpec, sources: readonly Source[]): TreeResult {
  if (!result.ok) return result;
  const was = findLayer(before, id);
  const now = findLayer(result.root, id);
  if (was === null || now === null) return result;
  const words = followWords(was.layer, now.layer, spec, sources);
  if (words === now.layer) return result;
  const replaced = replaceLayer(result.root, id, words);
  return replaced.ok ? { ...replaced, focusId: result.focusId } : result;
}

/** The text of a page heading a title can name: the words of a Heading, the title of a Page header or a Section. */
const TITLE_SLOTS: Readonly<Record<string, 'children' | 'title'>> = { Heading: 'children', PageHeader: 'title', Section: 'title' };

/**
 * The layout with every Heading text, Page header title and Section title that equals `oldTitle` rewritten to `newTitle`: a page
 * heading follows the page title until the person words it themselves. Saved features are left alone. Returns `layer` itself
 * when nothing changes. Pure: nothing is mutated.
 */
export function followTitle(layer: LayoutLayer, oldTitle: string, newTitle: string): LayoutLayer {
  if (oldTitle === newTitle || oldTitle === '' || layer.feature !== undefined) return layer;
  const slot = Object.hasOwn(TITLE_SLOTS, layer.type) ? TITLE_SLOTS[layer.type] : undefined;
  let next = layer;
  if (slot === 'children' && layer.children === oldTitle) next = { ...layer, children: newTitle };
  if (slot === 'title' && layer.props.title === oldTitle) next = { ...layer, props: { ...layer.props, title: newTitle } };
  if (!Array.isArray(next.children)) return next;
  const kids = next.children.map((c) => followTitle(c, oldTitle, newTitle));
  return kids.some((k, i) => k !== (next.children as LayoutLayer[])[i]) ? { ...next, children: kids } : next;
}
