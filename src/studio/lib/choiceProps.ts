// The enum and number props a person may change in Design, with plain labels (phase 8, decision 7). Studio only: these are not
// feature slots, so a saved feature can never turn them into a setting. configureLayer accepts exactly these keys (as
// "props.<name>") on top of the slot targets, and checks every value against the part's own zod shape. Pure.
import * as z from 'zod';
import { PROGRESS_TARGET_MAX, TONES } from '@/catalog/enums';
import { getPartDefinition } from '@/catalog/definitions';
import type { PartContext } from '@/catalog/types';
import type { JsonValue, LayoutLayer } from '@local-app-studio/runtime/spec/schema';

export type ChoiceKind = 'choice' | 'number' | 'pages';

export interface ChoiceOption {
  value: string;
  label: string;
  /** Offered only while the part's table has a number field (a total or an average needs one). */
  needsNumber?: true;
}

export interface ChoiceProp {
  /** The prop name; the key configureLayer takes is `props.<prop>`. */
  prop: string;
  label: string;
  kind: ChoiceKind;
  /** The choices of a `choice`; empty for a number and for pages (those come from the page and the zod bounds). */
  options: readonly ChoiceOption[];
  /** Shown only while another choice of the same part has this value (the pages of NavLinks). */
  when?: { prop: string; value: string };
  /** Shown only while the field a Chart groups by is a date (Dates by). */
  dateGroupOnly?: true;
  /** For a number: the bounds of the zod shape, repeated so the box can show them. */
  min?: number;
  max?: number;
}

const opts = (...pairs: Array<[string, string]>): ChoiceOption[] => pairs.map(([value, label]) => ({ value, label }));

const numeric = (value: string, label: string): ChoiceOption => ({ value, label, needsNumber: true });

const GAP: ChoiceOption[] = opts(['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']);

const TONE_LABELS: Readonly<Record<(typeof TONES)[number], string>> = {
  neutral: 'Plain',
  muted: 'Gray',
  accent: 'Accent',
  success: 'Green',
  warning: 'Amber',
  danger: 'Red',
};

export const CHOICE_PROPS: Readonly<Record<string, readonly ChoiceProp[]>> = Object.freeze({
  Columns: [
    { prop: 'layout', label: 'Column widths', kind: 'choice', options: opts(['equal', 'Equal'], ['wide-left', 'Wide left'], ['wide-right', 'Wide right'], ['sidebar-left', 'Narrow left'], ['sidebar-right', 'Narrow right']) },
    { prop: 'gap', label: 'Space between', kind: 'choice', options: GAP },
    { prop: 'align', label: 'Line up', kind: 'choice', options: opts(['top', 'Top'], ['center', 'Middle'], ['stretch', 'Same height']) },
  ],
  Row: [
    { prop: 'justify', label: 'Place', kind: 'choice', options: opts(['start', 'At the start'], ['between', 'Spread out'], ['end', 'At the end']) },
    { prop: 'wrap', label: 'When it does not fit', kind: 'choice', options: opts(['wrap', 'Wrap to a new line'], ['one-line', 'Stay on one line']) },
    { prop: 'gap', label: 'Space between', kind: 'choice', options: GAP },
  ],
  NavLinks: [
    { prop: 'show', label: 'Links to', kind: 'choice', options: opts(['menu', 'The app menu'], ['pages', 'Pages you choose']) },
    { prop: 'pages', label: 'Pages', kind: 'pages', options: [], when: { prop: 'show', value: 'pages' } },
    { prop: 'direction', label: 'Layout', kind: 'choice', options: opts(['horizontal', 'In a row'], ['vertical', 'In a list']) },
    { prop: 'icons', label: 'Icons', kind: 'choice', options: opts(['show', 'Show'], ['hide', 'Hide']) },
  ],
  Callout: [{ prop: 'tone', label: 'Kind', kind: 'choice', options: opts(['note', 'Note'], ['success', 'Good news'], ['warning', 'Warning'], ['danger', 'Problem']) }],
  Collapsible: [{ prop: 'start', label: 'At first', kind: 'choice', options: opts(['closed', 'Closed'], ['open', 'Open']) }],
  Chart: [
    { prop: 'kind', label: 'Chart type', kind: 'choice', options: opts(['bar', 'Bars'], ['line', 'Line']) },
    { prop: 'measure', label: 'Show', kind: 'choice', options: [...opts(['count', 'How many']), numeric('sum', 'Total of a number'), numeric('avg', 'Average of a number')] },
    { prop: 'bucket', label: 'Dates by', kind: 'choice', options: opts(['day', 'Day'], ['month', 'Month']), dateGroupOnly: true },
  ],
  ProgressBar: [
    { prop: 'stat', label: 'Count', kind: 'choice', options: [...opts(['count', 'How many']), numeric('sum', 'Total of a number')] },
    { prop: 'target', label: 'Goal', kind: 'number', options: [], min: 1, max: PROGRESS_TARGET_MAX },
    { prop: 'tone', label: 'Color', kind: 'choice', options: TONES.map((value) => ({ value, label: TONE_LABELS[value] })) },
  ],
  StatCard: [{ prop: 'stat', label: 'Show', kind: 'choice', options: [...opts(['count', 'How many']), numeric('sum', 'Total of a number'), numeric('avg', 'Average of a number'), numeric('min', 'Lowest of a number'), numeric('max', 'Highest of a number')] }],
  Timeline: [{ prop: 'order', label: 'Order', kind: 'choice', options: opts(['newest', 'Newest first'], ['oldest', 'Oldest first']) }],
});

/** The settings of this part type a person may change, in display order (none for most parts). */
export function choicePropsOf(type: string): readonly ChoiceProp[] {
  return Object.hasOwn(CHOICE_PROPS, type) ? CHOICE_PROPS[type] : [];
}

/** The key configureLayer takes and the draft uses. */
export const choiceKey = (c: ChoiceProp): string => `props.${c.prop}`;

type Shape = Readonly<Record<string, z.core.$ZodType>>;

function shapeOf(type: string, ctx: PartContext): Shape | null {
  const def = getPartDefinition(type);
  return def === undefined ? null : def.props(ctx).shape;
}

/** What the box shows now: the stored value, else the default of the part's zod shape ('' for pages that are not set). */
export function choiceValue(layer: LayoutLayer, c: ChoiceProp, ctx: PartContext): string {
  const stored = Object.hasOwn(layer.props, c.prop) ? layer.props[c.prop] : undefined;
  if (stored !== undefined && stored !== null) return Array.isArray(stored) ? stored.join(',') : String(stored);
  const shape = shapeOf(layer.type, ctx);
  const fallback = shape !== null && Object.hasOwn(shape, c.prop) ? z.safeParse(shape[c.prop], undefined) : null;
  return fallback !== null && fallback.success && fallback.data !== undefined ? String(fallback.data) : '';
}

export type ChoiceRead = { ok: true; value: JsonValue | null } | { ok: false; message: string };

/** The value to store for a typed or picked string, or why it is refused. `null` removes the prop (pages left empty). */
export function readChoice(type: string, c: ChoiceProp, raw: string, ctx: PartContext): ChoiceRead {
  const shape = shapeOf(type, ctx);
  if (shape === null || !Object.hasOwn(shape, c.prop)) return { ok: false, message: 'That setting cannot be changed.' };
  const schema = shape[c.prop];
  if (c.kind === 'number') {
    if (!/^[0-9]{1,10}$/.test(raw)) return { ok: false, message: 'Use a whole number.' };
    const n = Number(raw);
    return z.safeParse(schema, n).success ? { ok: true, value: n } : { ok: false, message: `Use a whole number from ${c.min ?? 1} to ${c.max ?? PROGRESS_TARGET_MAX}.` };
  }
  if (c.kind === 'pages') {
    const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => s !== ''))];
    if (ids.length === 0) return { ok: true, value: null };
    return z.safeParse(schema, ids).success ? { ok: true, value: ids } : { ok: false, message: 'Pick 1 to 8 pages that can be opened without a record.' };
  }
  if (!c.options.some((o) => o.value === raw) || !z.safeParse(schema, raw).success) return { ok: false, message: 'Pick one of the choices.' };
  return { ok: true, value: raw };
}
