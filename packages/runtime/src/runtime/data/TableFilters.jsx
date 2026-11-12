// The filter rows of the data browser table: field, operator and value per row, applied together as `filter`.
import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { btnPrimary, btnSecondary, inputClass } from '../../../../../src/components/shared/formStyles';
import { conditionFromDraft, OP_LABELS, opsFor } from './tableModel.js';

const MAX_FILTERS = 8;

function ValueInput({ column, value, onChange, label }) {
  if (column.type === 'boolean') {
    return (
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">Choose</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (column.type === 'select') {
    return (
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">Choose</option>
        {(column.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  const type = { integer: 'number', real: 'number', date: 'date', datetime: 'datetime-local' }[column.type] ?? 'text';
  return (
    <input
      aria-label={label}
      type={type}
      step={column.type === 'real' ? 'any' : undefined}
      placeholder={column.type === 'reference' ? 'Id of the linked row' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

/**
 * @param {{
 *   columns: Array<{ id: string, label: string, type: string, options?: string[] }>,
 *   active: number,
 *   onApply: (conditions: Array<{ field: string, op: string, value: unknown }>) => void,
 * }} props
 */
export default function TableFilters({ columns, active, onApply }) {
  const [rows, setRows] = useState([]);
  const nextKey = useRef(0);
  const byId = Object.fromEntries(columns.map((c) => [c.id, c]));

  const addRow = () => {
    const first = columns[0];
    nextKey.current += 1;
    setRows((prev) => [...prev, { key: nextKey.current, field: first.id, op: opsFor(first.type)[0], value: '' }]);
  };
  const patch = (key, change) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const changeField = (key, field) => patch(key, { field, op: opsFor(byId[field].type)[0], value: '' });
  const remove = (key) => setRows((prev) => prev.filter((r) => r.key !== key));

  const submit = (event) => {
    event.preventDefault();
    onApply(rows.map((r) => conditionFromDraft(r, byId[r.field])).filter((c) => c !== null));
  };
  const clear = () => {
    setRows([]);
    onApply([]);
  };

  return (
    <form onSubmit={submit} aria-label="Filters" className="space-y-2">
      {rows.map((row, i) => {
        const column = byId[row.field];
        const n = i + 1;
        return (
          <div key={row.key} className="flex flex-wrap items-center gap-2">
            <select aria-label={`Filter ${n} field`} value={row.field} onChange={(e) => changeField(row.key, e.target.value)} className={`${inputClass} w-auto`}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select aria-label={`Filter ${n} operator`} value={row.op} onChange={(e) => patch(row.key, { op: e.target.value })} className={`${inputClass} w-auto`}>
              {opsFor(column.type).map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            <div className="min-w-40">
              <ValueInput column={column} value={row.value} onChange={(value) => patch(row.key, { value })} label={`Filter ${n} value`} />
            </div>
            <button
              type="button"
              aria-label={`Remove filter ${n}`}
              onClick={() => remove(row.key)}
              className="rounded-md p-1 text-slate-slate400 hover:text-slate-slate100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        {rows.length < MAX_FILTERS && (
          <button type="button" onClick={addRow} className={`${btnSecondary} inline-flex items-center gap-1.5`}>
            <Plus size={14} aria-hidden="true" />
            Add filter
          </button>
        )}
        {rows.length > 0 && (
          <button type="submit" className={btnPrimary}>
            Apply filters
          </button>
        )}
        {(rows.length > 0 || active > 0) && (
          <button type="button" onClick={clear} className={btnSecondary}>
            Clear filters
          </button>
        )}
      </div>
    </form>
  );
}
