import type { Stat, Tone } from '../../../../../src/catalog/enums.ts';
import type { IconName } from '../../../../../src/catalog/enums.ts';
import { fieldInfo, useSourceInfo, useSourceStats, useTableDef } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { formatStat } from './format.ts';
import { PART_ICONS } from './icons.ts';
import { Skeleton } from './kit.ts';
import { TONE_CLASS, cx } from './styles.ts';

export interface StatCardProps extends EditorProps {
  source?: string;
  stat?: Stat;
  field?: string;
  label?: string;
  tone?: Tone;
  icon?: IconName;
}

/** One number over a list source. The server computes it; this only formats it. */
export function StatCard({ source = '', stat = 'count', field, label = '', tone = 'neutral', icon, ...rest }: StatCardProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { stats, loading, error } = useSourceStats(source);
  const Icon = icon ? PART_ICONS[icon] : undefined;
  const fieldType = field ? (fieldInfo(table, field)?.type ?? null) : null;
  let value: number | null = null;
  if (stats) value = stat === 'count' ? stats.count : field ? (stats.fields[field]?.[stat] ?? null) : null;
  const text = formatStat(stat, fieldType, value);

  return (
    <div {...dom} className={cx('glass-subtle rounded-xl p-4', className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-slate-slate400">
        {Icon && <Icon size={14} aria-hidden="true" />}
        <span>{label}</span>
      </div>
      <div className={cx('mt-1 text-2xl font-bold tabular-nums', TONE_CLASS[tone] ?? TONE_CLASS.neutral)}>
        {loading && !stats ? <Skeleton className="h-7 w-16" /> : error && !stats ? <span className="text-sm text-accent-red">{error}</span> : text || '-'}
      </div>
    </div>
  );
}
