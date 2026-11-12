// /data/:table: one table of the app. Paged rows, sort by header, filters, search, add and edit through the catalog's
// record form, remove with a confirmation, and an export of just this table.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Download, Pencil, Upload, Search, Trash2 } from 'lucide-react';
import { CatalogPageProvider } from '@/catalog/context';
import { formatValue } from '../../catalog/parts/format';
import { RecordFormView } from '../../catalog/parts/RecordFormView';
import { normalizeSpec } from '../normalizeSpec.js';
import AddButton from '../../../../../src/components/shared/AddButton';
import ConfirmDialog from '../../../../../src/components/shared/ConfirmDialog';
import { IconButton } from '../../../../../src/components/shared/ItemActions';
import Modal from '../../../../../src/components/shared/Modal';
import SectionCard from '../../../../../src/components/shared/SectionCard';
import { btnSecondary, formErrorClass, inputClass } from '../../../../../src/components/shared/formStyles';
import { usePageContext } from '../../../../../src/contexts/PageContextContext';
import { onDataChanged } from '../../../../../src/utils/dataChanged';
import { ERROR_TEXT, errorText } from '@/catalog/errorText.ts';
import { createHttpDataSource, exportTables } from '../dataClient.js';
import ImportBackup from './ImportBackup.jsx';
import ImportMapping from './ImportMapping.jsx';
import ImportPanel from './ImportPanel.jsx';
import ImportPaste from './ImportPaste.jsx';
import TableFilters from './TableFilters.jsx';
import { columnsOf, namedTitleField, nextSort, PAGE_SIZE, referenceText, searchFieldsOf } from './tableModel.js';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]';
const CELL = 'px-3 py-2 text-left align-top';

/** Titles of the rows the current rows point to, by referenced table and id. */
async function loadTitles(dataSource, spec, table, rows) {
  const titles = {};
  await Promise.all(
    table.fields
      .filter((f) => f.type === 'reference')
      .map(async (field) => {
        const ids = [...new Set(rows.map((r) => r[field.id]).filter((v) => typeof v === 'string' && v !== ''))];
        const target = spec.tables.find((t) => t.id === field.table);
        const titleField = target ? namedTitleField(target) : null;
        if (ids.length === 0 || !titleField) return;
        try {
          const result = await dataSource.list(target.id, { filter: [{ field: 'id', op: 'in', value: ids }], limit: 200 });
          titles[target.id] = { ...titles[target.id], ...Object.fromEntries(result.rows.map((r) => [r.id, r[titleField]])) };
        } catch {
          // The titles are a nicety: when they cannot load, the table shows the ids instead of failing.
        }
      }),
  );
  return titles;
}

function TableView({ spec, table, dataSource, apiBase }) {
  const columns = useMemo(() => columnsOf(table), [table]);
  const searchFields = useMemo(() => searchFieldsOf(table), [table]);
  const titleField = namedTitleField(table);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState(null);
  const [filter, setFilter] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ rows: [], total: 0, titles: {}, loading: true, error: null });
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [exportNote, setExportNote] = useState(null);
  const [savedNote, setSavedNote] = useState('');
  const addRef = useRef(null);
  const importRef = useRef(null);

  useEffect(() => {
    let live = true;
    const query = {
      filter,
      sort: sort ? [sort] : undefined,
      search: searchTerm ? { term: searchTerm, fields: searchFields } : undefined,
      limit: PAGE_SIZE,
      offset,
    };
    dataSource
      .list(table.id, query)
      .then(async (result) => ({ ...result, titles: await loadTitles(dataSource, spec, table, result.rows) }))
      .then(
        (result) => {
          if (live) setState({ rows: result.rows, total: result.total, titles: result.titles, loading: false, error: null });
        },
        (e) => {
          if (live) setState({ rows: [], total: 0, titles: {}, loading: false, error: errorText(e, ERROR_TEXT.loadRowsFailed) });
        },
      );
    return () => {
      live = false;
    };
  }, [dataSource, spec, table, filter, sort, searchTerm, searchFields, offset, version]);

  // Counts only. Never row values.
  usePageContext('data', () => ({
    table: table.label,
    rows: state.loading ? null : state.total,
    filters: filter.length,
    searching: searchTerm !== '',
    status: state.loading ? 'loading' : 'ready',
  }));

  const reload = () => setVersion((v) => v + 1);
  // An approved Assistant write refetches the rows (and the reference titles).
  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), []);
  const rowName = (row, index) => (titleField && row[titleField] ? String(row[titleField]) : `row ${offset + index + 1}`);

  const cell = (column, row) => {
    const value = row[column.id];
    if (column.type === 'reference') return referenceText(state.titles, table.fields.find((f) => f.id === column.id)?.table, value);
    return formatValue({ type: column.type, options: column.options }, value);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setOffset(0);
    setSearchTerm(searchText.trim());
  };
  const apply = (conditions) => {
    setOffset(0);
    setFilter(conditions);
  };
  const exportThis = async () => {
    setExportNote({ tone: 'info', text: ERROR_TEXT.exportPreparing });
    try {
      await exportTables([table.id], apiBase);
      setExportNote({ tone: 'ok', text: ERROR_TEXT.exportReady });
    } catch (e) {
      setExportNote({ tone: 'error', text: errorText(e, ERROR_TEXT.exportFailed) });
    }
  };

  const from = state.total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, state.total);
  const narrowed = filter.length > 0 || searchTerm !== '';
  const addFirst = () => setEditing({ record: null });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <Link to="/data" className={`inline-flex items-center gap-1 rounded-md text-xs text-slate-slate400 hover:text-slate-slate100 ${FOCUS}`}>
          <ArrowLeft size={12} aria-hidden="true" />
          All data
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-slate100 tracking-tight">{table.label}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportThis} className={`${btnSecondary} inline-flex items-center gap-1.5`}>
              <Download size={14} aria-hidden="true" />
              Export this table
            </button>
            <button type="button" ref={importRef} onClick={() => setImporting(true)} className={`${btnSecondary} inline-flex items-center gap-1.5`}>
              <Upload size={14} aria-hidden="true" />
              Import rows
            </button>
            <AddButton ref={addRef} label="Add a row" onClick={addFirst} />
          </div>
        </div>
        <p role="status" className={savedNote ? 'mt-2 text-xs text-slate-slate400' : 'sr-only'}>
          {savedNote}
        </p>
        {exportNote && (
          <p
            role={exportNote.tone === 'error' ? 'alert' : 'status'}
            className={`mt-2 text-xs ${exportNote.tone === 'error' ? 'text-accent-amber' : 'text-slate-slate400'}`}
          >
            {exportNote.text}
          </p>
        )}
      </div>

      <SectionCard>
        <div className="space-y-3">
          {searchFields.length > 0 && (
            <form onSubmit={submitSearch} role="search" className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                aria-label={`Search ${table.label}`}
                placeholder="Search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                maxLength={200}
                className={`${inputClass} max-w-xs`}
              />
              <button type="submit" className={`${btnSecondary} inline-flex items-center gap-1.5`}>
                <Search size={14} aria-hidden="true" />
                Search
              </button>
            </form>
          )}
          <TableFilters columns={columns} active={filter.length} onApply={apply} />
        </div>
      </SectionCard>

      <SectionCard>
        {state.error && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className={formErrorClass}>
              {state.error}
            </p>
            <button type="button" className={btnSecondary} onClick={reload}>
              {ERROR_TEXT.tryAgain}
            </button>
          </div>
        )}
        {!state.error && !state.loading && state.rows.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-slate400">
              {narrowed ? ERROR_TEXT.noRowsMatch : `No rows in ${table.label} yet. Add one to see it here.`}
            </p>
            {!narrowed && <AddButton label="Add the first row" onClick={addFirst} />}
          </div>
        )}
        {state.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-slate-slate100">
              <caption className="sr-only">{table.label}</caption>
              <thead>
                <tr className="text-xs text-slate-slate400">
                  {columns.map((c) => {
                    const dir = sort?.field === c.id ? sort.dir : null;
                    const ariaSort = dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
                    return (
                      <th key={c.id} scope="col" aria-sort={ariaSort} className={`${CELL} font-semibold`}>
                        <button
                          type="button"
                          onClick={() => {
                            setOffset(0);
                            setSort(nextSort(sort, c.id));
                          }}
                          className={`inline-flex items-center gap-1 rounded-md font-semibold hover:text-slate-slate100 ${FOCUS}`}
                        >
                          {c.label}
                          {dir === 'asc' && <ArrowUp size={12} aria-hidden="true" />}
                          {dir === 'desc' && <ArrowDown size={12} aria-hidden="true" />}
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col" className={`${CELL} w-0`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row, index) => (
                  <tr key={row.id} className="border-t border-[color:var(--glass-border)]">
                    {columns.map((c) => (
                      <td key={c.id} className={`${CELL} max-w-xs truncate`}>
                        {cell(c, row)}
                      </td>
                    ))}
                    <td className={`${CELL} whitespace-nowrap`}>
                      <IconButton label={`Edit ${rowName(row, index)}`} icon={Pencil} onClick={() => setEditing({ record: row })} />
                      <IconButton
                        label={`Remove ${rowName(row, index)}`}
                        icon={Trash2}
                        tone="danger"
                        onClick={() => setRemoving({ row, name: rowName(row, index) })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.loading && (
          <p role="status" className="text-sm text-slate-slate400">
            Loading…
          </p>
        )}
        {state.total > PAGE_SIZE && (
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-slate400">
            <span className="tabular-nums">{`${from} to ${to} of ${state.total}`}</span>
            <span className="flex gap-2">
              <button type="button" className={btnSecondary} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Previous
              </button>
              <button type="button" className={btnSecondary} disabled={offset + PAGE_SIZE >= state.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Next
              </button>
            </span>
          </nav>
        )}
        {state.total > 0 && state.total <= PAGE_SIZE && (
          <p className="mt-3 text-xs text-slate-slate400 tabular-nums">{state.total === 1 ? '1 row' : `${state.total} rows`}</p>
        )}
      </SectionCard>

      {editing && (
        <Modal
          title={editing.record ? `Edit a row in ${table.label}` : `Add a row to ${table.label}`}
          onClose={() => setEditing(null)}
          finalFocusRef={addRef}
        >
          <RecordFormView
            table={table.id}
            record={editing.record}
            submitLabel={editing.record ? 'Save changes' : 'Add row'}
            onSaved={(row) => {
              // The rules a save ran, in the server's words (the form closes with the save, so its own line never shows).
              const words = (Array.isArray(row.applied) ? row.applied : []).map((a) => a?.words).filter(Boolean).join(' ');
              setSavedNote(words ? `Saved. ${words}` : '');
              setEditing(null);
              reload();
            }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {importing && (
        <Modal title={`Import rows into ${table.label}`} onClose={() => setImporting(false)} dismissible={!importBusy} finalFocusRef={importRef}>
          <ImportPanel
            spec={spec}
            table={table.id}
            apiBase={apiBase}
            renderBackup={(p) => <ImportBackup apiBase={apiBase} {...p} />}
            renderMapping={(p) => <ImportMapping {...p} />}
            renderPaste={(p) => <ImportPaste {...p} />}
            onDone={reload}
            onBusy={setImportBusy}
          />
        </Modal>
      )}
      {removing && (
        <ConfirmDialog
          title="Remove this row?"
          message={`${removing.name} will be removed from ${table.label}. This cannot be undone.`}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await dataSource.remove(table.id, removing.row.id);
            } catch (e) {
              throw new Error(errorText(e, ERROR_TEXT.removeFailed), { cause: e });
            }
            setRemoving(null);
            if (state.rows.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE));
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * @param {{ spec: import('../../spec/schema.ts').AppSpec | null, apiBase?: string, dataSource?: import('@/catalog/context').CatalogDataSource }} props
 */
export default function DataTablePage({ spec, apiBase = '/api', dataSource }) {
  const { table: tableId } = useParams();
  const normalized = useMemo(() => normalizeSpec(spec), [spec]);
  const source = useMemo(() => dataSource ?? createHttpDataSource(apiBase), [dataSource, apiBase]);
  const value = useMemo(() => ({ apiBase, spec: normalized ?? undefined, dataSource: source }), [apiBase, normalized, source]);
  const table = normalized?.tables.find((t) => t.id === tableId);
  if (!table) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <div className="glass rounded-2xl p-5 space-y-2">
          <h2 className="text-sm font-bold text-slate-slate100">Table not found</h2>
          <p className="text-sm text-slate-slate400">This app has no table with that name.</p>
          <Link to="/data" className="text-sm text-accent-indigo underline">
            Back to all data
          </Link>
        </div>
      </div>
    );
  }
  return (
    <CatalogPageProvider value={value}>
      <TableView key={table.id} spec={normalized} table={table} dataSource={source} apiBase={apiBase} />
    </CatalogPageProvider>
  );
}
