// The numbers and words behind a Chart (plus the progress percent and the day of a Timeline row): rows from the server's groups, scales, ratios, ticks and line points. Pure (no
// React, no zod): the server computed every value, this only decides where to draw it and what to call it.
import type { FieldType } from '../../spec/schema.ts';
import type { GroupStats } from '../../../../../src/catalog/context.tsx';

export interface ChartRow {
  label: string;
  /** What is drawn; null (nothing to average) draws as zero. */
  value: number | null;
}

export interface LabelRule {
  type: FieldType;
  bucket: 'day' | 'month';
  /** Reference id to title. */
  titles?: Record<string, string>;
}

/** The label of one group key: select options as stored, Yes/No, record titles, formatted dates, None for no value (No date for a date group). */
export function groupLabel(rule: LabelRule, key: string | boolean | null): string {
  if (key === null) return rule.type === 'date' || rule.type === 'datetime' ? 'No date' : 'None';
  if (typeof key === 'boolean') return key ? 'Yes' : 'No';
  if (rule.type === 'date' || rule.type === 'datetime') return bucketLabel(key, rule.bucket);
  if (rule.type === 'reference') return rule.titles?.[key] ?? key;
  return key;
}

function bucketLabel(key: string, bucket: 'day' | 'month'): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key);
  if (!m) return key;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, bucket === 'day' && m[3] ? Number(m[3]) : 1));
  const options: Intl.DateTimeFormatOptions = bucket === 'day' ? { dateStyle: 'medium', timeZone: 'UTC' } : { month: 'short', year: 'numeric', timeZone: 'UTC' };
  return date.toLocaleDateString(undefined, options);
}

/** Rows to draw: the groups in the order given, then one row for what they leave out ("Earlier" for dates, else "Other"). */
export function chartRows(stats: GroupStats, rule: LabelRule): ChartRow[] {
  const rows = stats.groups.map((g) => ({ label: groupLabel(rule, g.key), value: g.value }));
  if (stats.other) {
    const dated = rule.type === 'date' || rule.type === 'datetime';
    const row = { label: dated ? 'Earlier' : 'Other', value: stats.other.value };
    // Earlier dates come before the shown buckets, other values after the shown groups.
    if (dated) rows.unshift(row);
    else rows.push(row);
  }
  return rows;
}

/** The ids of the referenced records a set of groups names (to look up their titles). */
export function referenceIds(stats: GroupStats): string[] {
  return stats.groups.map((g) => g.key).filter((k): k is string => typeof k === 'string');
}

/** The smallest 1, 2 or 5 times a power of ten that is at least `n` (1 for zero, negative or not a number). */
export function niceCeil(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  const f = n / power;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * power;
}

/** The top of the scale for some values: a nice number at or above the biggest one. */
export function scaleMax(values: ReadonlyArray<number | null>): number {
  return niceCeil(Math.max(0, ...values.map((v) => v ?? 0)));
}

/**
 * Evenly spaced ticks from 0 to `max` (a niceCeil number). Whole numbers when `whole` and the top is at most 5, else 4 or 5
 * steps chosen so the labels stay short.
 */
export function axisTicks(max: number, whole = false): number[] {
  const steps = whole && max <= 5 ? Math.max(1, Math.round(max)) : Math.round(max / 10 ** Math.floor(Math.log10(max))) === 2 ? 4 : 5;
  return Array.from({ length: steps + 1 }, (_, i) => (max * i) / steps);
}

/** Each value as a share of `max`, from 0 to 1 (null and negative values are 0). */
export function ratios(values: ReadonlyArray<number | null>, max: number): number[] {
  return values.map((v) => (v === null || !(max > 0) ? 0 : Math.min(1, Math.max(0, v / max))));
}

export interface PlotBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Points of a line chart: evenly spaced across the plot, higher values nearer the top. One point sits in the middle. */
export function linePoints(values: ReadonlyArray<number | null>, max: number, box: PlotBox): Array<{ x: number; y: number }> {
  const w = box.width - box.left - box.right;
  const h = box.height - box.top - box.bottom;
  return ratios(values, max).map((r, i) => ({
    x: box.left + (values.length <= 1 ? w / 2 : (w * i) / (values.length - 1)),
    y: box.top + h * (1 - r),
  }));
}

/** At most `limit` characters, with an ellipsis when cut. */
export function shorten(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1))}…`;
}

/** Whole percent of a value against a goal, from 0 to 100. */
export function percentOf(value: number, target: number): number {
  if (!Number.isFinite(value) || !(target > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((value / target) * 100)));
}

export const NO_DATE = '';

/** The day of a stored value: a date as stored, a datetime as the viewer's local day. '' when there is none. */
export function dayOf(type: string | undefined, value: unknown): string {
  if (typeof value !== 'string' || value === '') return NO_DATE;
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : NO_DATE;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return NO_DATE;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
