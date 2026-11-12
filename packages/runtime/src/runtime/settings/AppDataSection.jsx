// Settings > About this app (a runtime-module settings section): what the app is, and where it keeps its data on this computer.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database } from 'lucide-react';
import SectionCard from '../../../../../src/components/shared/SectionCard';
import { sectionProps } from '../../../../../src/components/settings/settingsSections';
import { BTN } from '../../../../../src/components/settings/pillStyles';
import { fetchDataInfo } from '../dataClient.js';

function PathRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div>
      <p className="text-xs font-semibold text-slate-slate300">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md glass-subtle px-2 py-1 text-xs text-slate-slate100">{value}</code>
        <button type="button" onClick={copy} className={BTN} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/** @param {{ spec?: import('../../spec/schema.ts').AppSpec | null }} props */
export default function AppDataSection({ spec = null }) {
  const [info, setInfo] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchDataInfo('/api').then(
      (data) => {
        if (live) setInfo(data);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const app = spec?.app ?? null;
  const description = typeof app?.description === 'string' ? app.description.trim() : '';
  return (
    <SectionCard title="About this app" icon={Database} subtitle="What it is and where it keeps your data." {...sectionProps('runtime-data')}>
      <div className="space-y-4">
        {app?.name && (
          <p className="text-sm font-semibold text-slate-slate100">
            {app.name}
            {app.version ? `, version ${app.version}` : ''}.
          </p>
        )}
        {description !== '' && <p className="text-sm text-slate-slate300">{description}</p>}
        <p className="text-sm text-slate-slate300">
          Everything you add is saved in one file on this computer. To keep a copy, use Export under Data and storage. Help in the window menu
          has About and Open data folder.
        </p>
        {failed && (
          <p role="alert" className="text-xs text-accent-amber">
            Couldn&apos;t read the data location. Restart the app and try again.
          </p>
        )}
        {!info && !failed && <p className="text-sm text-slate-slate400">Loading…</p>}
        {info && (
          <>
            <PathRow label="Data folder" value={info.dataDir} />
            <PathRow label="Database file" value={info.dbFile} />
            <p className="text-xs text-slate-slate400">
              An outside SQLite tool can open the database file while this app is closed. Close the app first, so nothing changes under it.
            </p>
          </>
        )}
        <Link to="/data" className="inline-block text-sm text-accent-indigo underline">
          Look at your data
        </Link>
      </div>
    </SectionCard>
  );
}
