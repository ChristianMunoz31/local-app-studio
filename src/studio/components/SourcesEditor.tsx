// The lists of one page: bounded reads of a table (a list of records, or one record) that data parts show. Edits are passed
// up as a whole Source[]; problems are shown under the row they belong to, in plain words. A list is named by its table.
import { useId } from 'react';
import { formErrorClass, inputClass, labelClass, btnSecondary } from '@/components/shared/formStyles.js';
import { LIMITS, WHERE_OPS } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, Field, Page, Source, SpecIssue, Table, WhereCondition, WhereOp } from '@local-app-studio/runtime/spec/schema';
import { OP_WORDS } from '../design/designLabels';
import { toId } from '../lib/ids';
import { plainMessage } from '../lib/issueWords';
import { HINT_CLASS } from './ui';

export interface SourcesEditorProps {
  spec: AppSpec;
  page: Page;
  sources: Source[];
  /** Issues of the whole spec (paths like pages.1.sources.0.limit). */
  issues: SpecIssue[];
  onChange(next: Source[]): void;
}

type ColumnKind = Field['type'] | 'id' | 'datetime';
interface Column {
  id: string;
  label: string;
  kind: ColumnKind;
  /** The choices of a Choice field. */
  options?: readonly string[];
}

const ORDERING_OPS: readonly WhereOp[] = ['gt', 'gte', 'lt', 'lte'];
const NO_ORDERING: ReadonlySet<ColumnKind> = new Set<ColumnKind>(['boolean', 'select', 'reference', 'id']);
const MAX_WHERE = LIMITS.whereConditions;
const MAX_ORDER = LIMITS.orderBy;

const columnsOf = (table: Table | undefined): Column[] =>
  table === undefined
    ? []
    : [
        { id: 'id', label: 'Record number', kind: 'id' },
        ...table.fields.map((f): Column => ({ id: f.id, label: f.label, kind: f.type, ...(f.type === 'select' ? { options: f.options } : {}) })),
        { id: 'created_at', label: 'Created', kind: 'datetime' },
        { id: 'updated_at', label: 'Updated', kind: 'datetime' },
      ];

const issuesFor = (issues: readonly SpecIssue[], path: string): SpecIssue[] => issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));

/** The problems under a row or an input. `id` is what the inputs point at with aria-describedby. */
function Problems({ id, issues }: { id: string; issues: readonly SpecIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div id={id} role="alert">
      {issues.map((i) => (
        <p key={`${i.path}:${i.code}`} className={formErrorClass}>
          {plainMessage(i.message)}
        </p>
      ))}
    </div>
  );
}

/** The invalid state of an input whose problems are shown under `id`. */
const invalid = (id: string, issues: readonly SpecIssue[]): { 'aria-describedby'?: string; 'aria-invalid'?: true } =>
  issues.length === 0 ? {} : { 'aria-describedby': id, 'aria-invalid': true };

type Scalar = string | number | boolean;

/** A typed value from its text form; null when the text does not fit the column. */
function parseScalar(kind: ColumnKind, text: string): Scalar | null {
  if (kind === 'integer' || kind === 'real') {
    if (text.trim() === '') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'boolean') return text === 'true' ? true : text === 'false' ? false : null;
  return text;
}

function ValueInput({ kind, op, value, label, options, onChange }: { kind: ColumnKind; op: WhereOp; value: WhereCondition['value']; label: string; options?: readonly string[]; onChange(next: WhereCondition['value']): void }) {
  if (kind === 'select' && options !== undefined) {
    if (op === 'in') {
      const picked = Array.isArray(value) ? value.map(String) : [];
      // A stored choice that is no longer an option stays in the list, shown and kept until the person unticks it.
      const gone = picked.filter((v) => !options.includes(v));
      return (
        <fieldset aria-label={label} className="space-y-1">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm text-slate-slate100">
              <input type="checkbox" checked={picked.includes(o)} onChange={(e) => onChange([...gone, ...options.filter((x) => (x === o ? e.target.checked : picked.includes(x)))])} />
              {o}
            </label>
          ))}
          {gone.map((o) => (
            <label key={`gone:${o}`} className="flex items-center gap-2 text-sm text-slate-slate100">
              <input type="checkbox" checked onChange={() => onChange(picked.filter((x) => x !== o))} />
              {`${o} (no longer an option)`}
            </label>
          ))}
        </fieldset>
      );
    }
    const stored = typeof value === 'string' && value !== '' && !options.includes(value) ? value : null;
    return (
      <select aria-label={label} className={inputClass} value={typeof value === 'string' && (options.includes(value) || stored !== null) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
        <option value="">Pick one</option>
        {stored !== null && (
          <option value={stored} disabled>
            {`${stored} (no longer an option)`}
          </option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (op === 'in') {
    const lines = Array.isArray(value) ? value.map(String).join('\n') : '';
    return (
      <textarea
        aria-label={label}
        className={`${inputClass} min-h-20`}
        value={lines}
        placeholder="One value per line"
        onChange={(e) => {
          const parsed = e.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== '')
            .map((line) => parseScalar(kind, line))
            .filter((v): v is Scalar => v !== null);
          onChange(parsed);
        }}
      />
    );
  }
  if (kind === 'boolean') {
    return (
      <select aria-label={label} className={inputClass} value={typeof value === 'boolean' ? String(value) : ''} onChange={(e) => onChange(parseScalar(kind, e.target.value))}>
        <option value="">Pick one</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  const inputType = kind === 'integer' || kind === 'real' ? 'number' : kind === 'date' ? 'date' : 'text';
  return (
    <input
      aria-label={label}
      className={inputClass}
      type={inputType}
      step={kind === 'integer' ? 1 : undefined}
      value={value === null || Array.isArray(value) ? '' : String(value)}
      onChange={(e) => onChange(parseScalar(kind, e.target.value))}
    />
  );
}

function SourceRow({
  source,
  name,
  base,
  tables,
  recordRoute,
  issues,
  onChange,
  onRemove,
}: {
  source: Source;
  /** What the row is called in words: its table, with a number when two lists read the same table. */
  name: string;
  base: string;
  tables: Table[];
  recordRoute: boolean;
  issues: SpecIssue[];
  onChange(next: Source): void;
  onRemove(): void;
}) {
  const table = tables.find((t) => t.id === source.table);
  const columns = columnsOf(table);
  const kindOf = (id: string): ColumnKind => columns.find((c) => c.id === id)?.kind ?? 'text';
  const patch = (next: Partial<Source>): void => onChange({ ...source, ...next });
  const setWhere = (k: number, next: WhereCondition): void => patch({ where: source.where.map((w, i) => (i === k ? next : w)) });
  const setOrder = (k: number, next: Source['orderBy'][number]): void => patch({ orderBy: source.orderBy.map((o, i) => (i === k ? next : o)) });
  const opsFor = (field: string): readonly WhereOp[] => (NO_ORDERING.has(kindOf(field)) ? WHERE_OPS.filter((op) => !ORDERING_OPS.includes(op)) : WHERE_OPS);
  const isRecord = source.mode === 'record';
  const uid = useId();
  const rowIssues = issues.filter((i) => !/\.(where|orderBy)\./.test(i.path));
  const rowProblems = `${uid}-problems`;

  return (
    <li className="space-y-3 rounded-lg border border-slate-slate700/60 p-3">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <span className={labelClass}>List of</span>
          <p className="truncate text-sm font-medium text-slate-slate100">{name}</p>
        </div>
        <button type="button" className={btnSecondary} onClick={onRemove} aria-label={`Remove list ${name}`}>
          Remove
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Table</span>
          <select
            aria-label={`Table for ${name}`}
            className={inputClass}
            {...invalid(rowProblems, rowIssues)}
            value={source.table}
            onChange={(e) => patch({ table: e.target.value, where: [], orderBy: [] })}
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Shows</span>
          <select
            aria-label={`Shows for ${name}`}
            className={inputClass}
            {...invalid(rowProblems, rowIssues)}
            value={source.mode}
            onChange={(e) => (e.target.value === 'record' ? patch({ mode: 'record', where: [], orderBy: [] }) : patch({ mode: 'list' }))}
          >
            <option value="list">A list of records</option>
            {(recordRoute || isRecord) && <option value="record">One record, picked from a list</option>}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Show at most</span>
          <input
            aria-label={`Show at most for ${name}`}
            className={inputClass}
            {...invalid(rowProblems, rowIssues)}
            type="number"
            min={LIMITS.sourceLimitMin}
            max={LIMITS.sourceLimitMax}
            step={1}
            value={source.limit}
            onChange={(e) => patch({ limit: Math.trunc(Number(e.target.value)) || LIMITS.sourceLimitMin })}
          />
        </label>
      </div>
      <Problems id={rowProblems} issues={rowIssues} />
      {!isRecord && (
        <>
          <fieldset className="space-y-2">
            <legend className={labelClass}>Sort by</legend>
            {source.orderBy.map((o, k) => (
              <div key={k} className="flex items-center gap-2">
                <select aria-label={`Sort field ${k + 1} for ${name}`} className={inputClass} {...invalid(`${uid}-order-${k}`, issuesFor(issues, `${base}.orderBy.${k}`))} value={o.field} onChange={(e) => setOrder(k, { ...o, field: e.target.value })}>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select aria-label={`Sort direction ${k + 1} for ${name}`} className={inputClass} value={o.dir} onChange={(e) => setOrder(k, { ...o, dir: e.target.value === 'desc' ? 'desc' : 'asc' })}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button type="button" className={btnSecondary} onClick={() => patch({ orderBy: source.orderBy.filter((_, i) => i !== k) })}>
                  Remove
                </button>
                <Problems id={`${uid}-order-${k}`} issues={issuesFor(issues, `${base}.orderBy.${k}`)} />
              </div>
            ))}
            {source.orderBy.length < MAX_ORDER && columns.length > 0 && (
              <button type="button" className={btnSecondary} onClick={() => patch({ orderBy: [...source.orderBy, { field: columns[0].id, dir: 'asc' }] })}>
                Add sort
              </button>
            )}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className={labelClass}>Only show records where</legend>
            {source.where.map((w, k) => {
              const kind = kindOf(w.field);
              const ops = opsFor(w.field);
              return (
                <div key={k} className="space-y-1">
                  <div className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]">
                    <select
                      aria-label={`Filter field ${k + 1} for ${name}`}
                      className={inputClass}
                      {...invalid(`${uid}-where-${k}`, issuesFor(issues, `${base}.where.${k}`))}
                      value={w.field}
                      onChange={(e) => setWhere(k, { field: e.target.value, op: 'eq', value: null })}
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Filter operator ${k + 1} for ${name}`}
                      className={inputClass}
                      value={w.op}
                      onChange={(e) => {
                        const op = WHERE_OPS.find((o) => o === e.target.value) ?? 'eq';
                        setWhere(k, { ...w, op, value: op === 'in' ? [] : Array.isArray(w.value) ? null : w.value });
                      }}
                    >
                      {ops.map((op) => (
                        <option key={op} value={op}>
                          {OP_WORDS[op]}
                        </option>
                      ))}
                    </select>
                    <ValueInput kind={kind} op={w.op} value={w.value} options={columns.find((c) => c.id === w.field)?.options} label={`Filter value ${k + 1} for ${name}`} onChange={(value) => setWhere(k, { ...w, value })} />
                    <button type="button" className={btnSecondary} onClick={() => patch({ where: source.where.filter((_, i) => i !== k) })}>
                      Remove
                    </button>
                  </div>
                  <Problems id={`${uid}-where-${k}`} issues={issuesFor(issues, `${base}.where.${k}`)} />
                </div>
              );
            })}
            {source.where.length < MAX_WHERE && columns.length > 0 && (
              <button type="button" className={btnSecondary} onClick={() => patch({ where: [...source.where, { field: columns[0].id, op: 'eq', value: null }] })}>
                Add filter
              </button>
            )}
          </fieldset>
        </>
      )}
    </li>
  );
}

export default function SourcesEditor({ spec, page, sources, issues, onChange }: SourcesEditorProps) {
  const pageIndex = spec.pages.findIndex((p) => p.id === page.id);
  const recordRoute = page.route.endsWith('/:id');
  const taken = new Set(sources.map((s) => s.id));
  // A list is named by its table; two lists on one table get a number.
  const seen = new Map<string, number>();
  const names = sources.map((s) => {
    const label = spec.tables.find((t) => t.id === s.table)?.label ?? s.table;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n === 1 ? label : `${label} (${n})`;
  });
  const add = (): void => {
    const table = spec.tables[0];
    if (table === undefined) return;
    const id = toId(table.id, taken, () => false);
    onChange([...sources, { id, table: table.id, mode: 'list', where: [], orderBy: [], limit: LIMITS.sourceLimitDefault }]);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-slate100">Lists on this page</h3>
        <button type="button" className={btnSecondary} onClick={add} disabled={spec.tables.length === 0 || sources.length >= LIMITS.sourcesPerPage}>
          Add a list
        </button>
      </div>
      {spec.tables.length === 0 && <p className={HINT_CLASS}>This app has no table yet. Put a part that shows records on a page and press New table on it.</p>}
      {sources.length === 0 && spec.tables.length > 0 && <p className={HINT_CLASS}>No lists yet. Add one so a table or chart on this page has records to show.</p>}
      <ul className="space-y-3">
        {sources.map((source, k) => (
          <SourceRow
            key={source.id}
            source={source}
            name={names[k]}
            base={`pages.${pageIndex}.sources.${k}`}
            tables={spec.tables}
            recordRoute={recordRoute}
            issues={issuesFor(issues, `pages.${pageIndex}.sources.${k}`)}
            onChange={(next) => onChange(sources.map((s, i) => (i === k ? next : s)))}
            onRemove={() => onChange(sources.filter((_, i) => i !== k))}
          />
        ))}
      </ul>
    </div>
  );
}
