import { useLayoutEffect, useRef, useState } from 'react';
import type { CHART_KINDS, CHART_MEASURES, DATE_BUCKETS } from '../../../../../src/catalog/enums.ts';
import { fieldInfo, useReferenceTitles, useSourceGroups, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import type { GroupStats } from '../../../../../src/catalog/context.tsx';
import { axisTicks, chartRows, linePoints, ratios, referenceIds, scaleMax, shorten } from './chartModel.ts';
import type { ChartRow, PlotBox } from './chartModel.ts';
import { EmptyLine, ErrorLine, LoadingLines } from './DataState.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { formatStat } from './format.ts';
import { cx } from './styles.ts';

type ChartKind = (typeof CHART_KINDS)[number];
type ChartMeasure = (typeof CHART_MEASURES)[number];
type DateBucket = (typeof DATE_BUCKETS)[number];

export interface ChartProps extends EditorProps {
  source?: string;
  kind?: ChartKind;
  groupBy?: string;
  measure?: ChartMeasure;
  field?: string;
  bucket?: DateBucket;
  title?: string;
}

const NO_GROUPS: GroupStats = { table: '', count: 0, groups: [], other: null };
const BAR = { label: 120, gap: 8, valueWidth: 64, rowHeight: 28, barHeight: 16 };
const LINE: Omit<PlotBox, 'width'> = { height: 200, left: 44, right: 12, top: 12, bottom: 32 };
/** The drawing width before the figure is measured (and where nothing can be measured). */
const FALLBACK_WIDTH = 480;
const MIN_WIDTH = 240;

/** The content width of an element in px: its client width minus horizontal padding, so a padded figure gets no too-wide viewBox. */
function contentWidth(el: HTMLElement): number {
  const style = window.getComputedStyle(el);
  const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  return Math.floor(el.clientWidth - pad);
}

/** The figure's width in px, so one drawing unit is one px and the text keeps its size at any chart width. */
function useFigureWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  // The first measure runs before paint, so the chart never shows at the fallback width and then jumps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const w = contentWidth(el);
      if (w > 0) setWidth(Math.max(MIN_WIDTH, w));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const tick = (t: number): string => t.toLocaleString(undefined, { maximumFractionDigits: 2 });

function Bars({ rows, text, name, width }: { rows: ChartRow[]; text: (v: number | null) => string; name: string; width: number }) {
  const max = scaleMax(rows.map((r) => r.value));
  const share = ratios(rows.map((r) => r.value), max);
  const trackWidth = width - BAR.label - BAR.gap * 2 - BAR.valueWidth;
  const height = rows.length * BAR.rowHeight;
  return (
    <svg role="img" aria-label={name} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
      {rows.map((row, i) => {
        const y = i * BAR.rowHeight;
        const mid = y + BAR.rowHeight / 2;
        return (
          <g key={`${i}-${row.label}`}>
            <title>{`${row.label}: ${text(row.value) || '-'}`}</title>
            <text x={0} y={mid} dominantBaseline="central" fontSize={12} className="fill-slate-slate400">
              {shorten(row.label, 18)}
            </text>
            <rect x={BAR.label + BAR.gap} y={mid - BAR.barHeight / 2} width={share[i] * trackWidth} height={BAR.barHeight} rx={3} className="fill-accent-indigo" />
            <text x={BAR.label + BAR.gap * 2 + trackWidth} y={mid} dominantBaseline="central" fontSize={12} className="fill-slate-slate400">
              {text(row.value) || '-'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Line({ rows, text, name, whole, width }: { rows: ChartRow[]; text: (v: number | null) => string; name: string; whole: boolean; width: number }) {
  const values = rows.map((r) => r.value);
  const max = scaleMax(values);
  const ticks = axisTicks(max, whole);
  const box: PlotBox = { ...LINE, width };
  const points = linePoints(values, max, box);
  const bottom = LINE.height - LINE.bottom;
  const every = Math.ceil(rows.length / 6);
  const plotHeight = bottom - LINE.top;
  return (
    <svg role="img" aria-label={name} viewBox={`0 0 ${width} ${LINE.height}`} className="h-auto w-full">
      {ticks.map((t) => {
        const y = bottom - (plotHeight * t) / max;
        return (
          <g key={t}>
            <line x1={LINE.left} x2={width - LINE.right} y1={y} y2={y} strokeWidth={1} className="stroke-slate-slate600" />
            <text x={LINE.left - 6} y={y} textAnchor="end" dominantBaseline="central" fontSize={11} className="fill-slate-slate400">
              {tick(t)}
            </text>
          </g>
        );
      })}
      <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-accent-indigo" />
      {points.map((p, i) => (
        <g key={`${i}-${rows[i].label}`}>
          <title>{`${rows[i].label}: ${text(rows[i].value) || '-'}`}</title>
          <circle cx={p.x} cy={p.y} r={3.5} className="fill-accent-indigo" />
          {i % every === 0 && (
            <text x={p.x} y={LINE.height - 10} textAnchor="middle" fontSize={11} className="fill-slate-slate400">
              {shorten(rows[i].label, 10)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Bars or a line of one list source, grouped by one field. The server groups and adds up; this only draws. */
export function Chart({ source = '', kind = 'bar', groupBy = '', measure = 'count', field, bucket = 'month', title, ...rest }: ChartProps) {
  const { className, ...dom } = editorDomProps(rest);
  const { ref, width } = useFigureWidth();
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const group = fieldInfo(table, groupBy);
  const dated = group?.type === 'date' || group?.type === 'datetime';
  const measureField = measure === 'count' ? undefined : field;
  const { data, loading, error } = useSourceGroups(source, {
    groupBy,
    measure,
    ...(measureField ? { field: measureField } : {}),
    ...(dated ? { bucket } : {}),
  });
  const stats = data ?? NO_GROUPS;
  const titles = useReferenceTitles(group?.type === 'reference' && group.table ? { [group.table]: referenceIds(stats) } : {});
  const measureType = measureField ? (fieldInfo(table, measureField)?.type ?? null) : null;
  const text = (v: number | null): string => formatStat(measure, measureType, v);
  const rows = group ? chartRows(stats, { type: group.type, bucket, titles: group.table ? titles[group.table] : undefined }) : [];
  const name = title ?? (group ? `Chart by ${group.label}` : 'Chart');

  let body;
  if (!info || !table || !group) {
    body = <p className="text-sm text-slate-slate400">Chart of the rows of &quot;{source}&quot;</p>;
  } else if (error && !data) {
    body = <ErrorLine message={error} />;
  } else if (loading && !data) {
    body = <LoadingLines />;
  } else if (rows.length === 0) {
    body = <EmptyLine text="No records to chart yet." />;
  } else {
    const whole = measure === 'count' || (measure === 'sum' && measureType === 'integer');
    body = (
      <>
        {kind === 'line' ? <Line rows={rows} text={text} name={name} whole={whole} width={width} /> : <Bars rows={rows} text={text} name={name} width={width} />}
        <table className="sr-only">
          <caption>{name}</caption>
          <thead>
            <tr>
              <th scope="col">{group.label}</th>
              <th scope="col">{measure === 'count' ? 'Count' : measure === 'sum' ? 'Total' : 'Average'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${i}-${row.label}`}>
                <th scope="row">{row.label}</th>
                <td>{text(row.value) || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
  return (
    <figure {...dom} ref={ref} className={cx('space-y-2', className)}>
      {title && <figcaption className="text-sm font-semibold text-slate-slate100">{title}</figcaption>}
      {body}
    </figure>
  );
}
