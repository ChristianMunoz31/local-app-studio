// /data: every table of the app with its row count, plus the kit's export and import of the whole data set.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Database, RefreshCw } from 'lucide-react';
import { normalizeSpec } from '../normalizeSpec.js';
import SectionCard from '../../../../../src/components/shared/SectionCard';
import DataExportControl from '../../../../../src/components/settings/DataExportControl';
import ImportControl from '../../../../../src/components/settings/ImportControl';
import { BTN } from '../../../../../src/components/settings/pillStyles';
import { usePageContext } from '../../../../../src/contexts/PageContextContext';
import { onDataChanged } from '../../../../../src/utils/dataChanged';
import { fetchDataInfo } from '../dataClient.js';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]';

/** @param {{ spec: import('../../spec/schema.ts').AppSpec | null, apiBase?: string }} props */
export default function DataBrowserPage({ spec, apiBase = '/api' }) {
  const tables = useMemo(() => normalizeSpec(spec)?.tables ?? [], [spec]);
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState(null);

  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    fetchDataInfo(apiBase).then(
      (info) => {
        if (!live) return;
        setError(null);
        setCounts(Object.fromEntries(info.tables.map((t) => [t.id, t.rowCount])));
      },
      (e) => {
        if (live) setError(e?.message || "Couldn't load your data. Try again.");
      },
    );
    return () => {
      live = false;
    };
  }, [apiBase, reload]);

  // An approved Assistant write changes the row counts.
  useEffect(() => onDataChanged(() => setReload((n) => n + 1)), []);

  // Table names and row counts only. Never row values.
  usePageContext('data', () => ({
    tables: tables.map((t) => ({ table: t.label, rows: counts?.[t.id] ?? null })),
    status: counts === null && !error ? 'loading' : 'ready',
  }));

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-slate100 tracking-tight">Data</h2>
        <p className="text-sm text-slate-slate400 mt-1">Everything this app keeps on your computer. Open a table to look at, change or remove its rows.</p>
      </div>

      <SectionCard
        title="Tables"
        icon={Database}
        action={
          <button type="button" onClick={() => setReload((n) => n + 1)} className={`${BTN} inline-flex items-center gap-1.5`}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh counts
          </button>
        }
      >
        {error && (
          <p role="alert" className="mb-3 text-xs text-accent-amber">
            {error}
          </p>
        )}
        {tables.length === 0 ? (
          <p className="text-sm text-slate-slate400">This app has no tables yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--glass-border)]">
            {tables.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/data/${encodeURIComponent(t.id)}`}
                  className={`flex items-center justify-between gap-3 rounded-md py-3 text-sm text-slate-slate100 hover:text-accent-indigo ${FOCUS}`}
                >
                  <span className="font-semibold">{t.label}</span>
                  <span className="flex items-center gap-2 text-slate-slate400">
                    <span className="tabular-nums">
                      {counts === null ? '' : `${counts[t.id] ?? 0} ${counts[t.id] === 1 ? 'row' : 'rows'}`}
                    </span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Export and import">
        <div className="space-y-6">
          <DataExportControl />
          <ImportControl />
        </div>
      </SectionCard>
    </div>
  );
}
