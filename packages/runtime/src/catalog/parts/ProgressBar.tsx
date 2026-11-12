import type { PROGRESS_STATS, Tone } from '../../../../../src/catalog/enums.ts';
import { fieldInfo, useCatalogData, useRecordById, useSourceInfo, useSourceStats, useTableDef } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { percentOf } from './chartModel.ts';
import { formatStat } from './format.ts';
import { Skeleton } from './kit.ts';
import { cx } from './styles.ts';

type ProgressStat = (typeof PROGRESS_STATS)[number];

// The filled part of the bar (an SVG rect, so no inline style), by tone. Literal classes so the theme audit and Tailwind see them.
const FILL_CLASS: Record<Tone, string> = {
  neutral: 'fill-slate-slate400',
  muted: 'fill-slate-slate600',
  accent: 'fill-accent-indigo',
  success: 'fill-accent-green',
  warning: 'fill-accent-amber',
  danger: 'fill-accent-red',
};

export interface ProgressBarProps extends EditorProps {
  source?: string;
  stat?: ProgressStat;
  field?: string;
  target?: number;
  label?: string;
  tone?: Tone;
}

/** How close a count or a total of a list source, or a number of one record, is to a goal. The percent is computed here. */
export function ProgressBar({ source = '', stat = 'count', field, target = 10, label = '', tone = 'accent', ...rest }: ProgressBarProps) {
  const { className, ...dom } = editorDomProps(rest);
  const data = useCatalogData();
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const isRecord = info?.mode === 'record';
  const { stats, loading: statsLoading, error: statsError } = useSourceStats(isRecord ? '' : source);
  const { record, loading: recordLoading, error: recordError } = useRecordById(isRecord ? info.table : null, isRecord ? (data.recordId ?? null) : null);

  let value: number | null = null;
  if (isRecord) {
    const v = field ? record?.[field] : undefined;
    value = typeof v === 'number' && Number.isFinite(v) ? v : null;
  } else if (stats) {
    value = stat === 'count' ? stats.count : field ? (stats.fields[field]?.sum ?? null) : null;
  }
  const loading = isRecord ? recordLoading && !record : statsLoading && !stats;
  const error = isRecord ? recordError : statsError;
  const fieldType = field ? (fieldInfo(table, field)?.type ?? null) : null;
  const shown = value ?? 0;
  const percent = percentOf(shown, target);
  const format = (n: number): string => formatStat(isRecord || stat === 'sum' ? 'sum' : 'count', fieldType, n);
  const summary = `${format(shown)} of ${format(target)}`;

  return (
    <div {...dom} className={cx('glass-subtle space-y-2 rounded-xl p-4', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs font-medium text-slate-slate400">
        <span>{label}</span>
        <span className="tabular-nums">{loading ? <Skeleton className="h-4 w-16" /> : error && value === null ? <span className="text-accent-red">{error}</span> : summary}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label || 'Progress'}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(Math.max(shown, 0), target)}
        aria-valuetext={summary}
      >
        <svg viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true" className="block h-2 w-full">
          <rect width={100} height={1} rx={0.5} className="fill-slate-slate700" />
          <rect width={percent} height={1} rx={0.5} className={typeof tone === 'string' && Object.hasOwn(FILL_CLASS, tone) ? FILL_CLASS[tone] : FILL_CLASS.accent} />
        </svg>
      </div>
    </div>
  );
}
