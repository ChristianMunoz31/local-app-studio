import { useId, useMemo, useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { SURFACE_COPY, fillCopy } from '@/errors/surfaceCopy.js';
import { PILL, TONE_CLASS } from '@/components/settings/pillStyles.js';
import SwitchToggle from '@/components/settings/SwitchToggle.jsx';
import { btnSecondary, formErrorClass, inputClass } from '@/components/shared/formStyles.js';
import { ListSkeleton } from '@/components/shared/Skeleton.jsx';
import StudioSectionCard from '@/studio/components/StudioSectionCard';
import { sectionProps } from '@/components/settings/settingsSections.js';
import { buildSummary, useDiagnostics } from '../hooks/useDiagnostics';
import type { DiagnosticsInfo, DoctorStatus, LogLevel, LogRecord } from '../services/diagnosticsApi';

const C = SURFACE_COPY;

type LevelFilter = 'all' | 'warnings' | 'errors';
const SHOWN: Record<LevelFilter, ReadonlySet<LogLevel>> = {
  all: new Set<LogLevel>(['debug', 'info', 'warn', 'error', 'fatal']),
  warnings: new Set<LogLevel>(['warn', 'error', 'fatal']),
  errors: new Set<LogLevel>(['error', 'fatal']),
};
const STATUS_WORDS: Record<DoctorStatus, string> = { found: C.diagStatusFound, missing: C.diagStatusMissing, problem: C.diagStatusProblem };
const TH = 'px-2 py-1.5 text-left text-xs font-semibold text-slate-slate400';
const TD = 'px-2 py-1.5 align-top text-xs text-slate-slate300';
const H4 = 'text-sm font-semibold text-slate-slate100';
const SCROLL_FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]';

const timeOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
};
const whereOf = (rec: LogRecord): string => rec.route ?? rec.stage ?? '';

function Facts({ info }: { info: DiagnosticsInfo }) {
  const { versions, mode, ports, helper } = info;
  const portText = [
    ports.app !== null ? fillCopy(C.diagPortApp, { port: ports.app }) : '',
    ports.preview !== null ? fillCopy(C.diagPortPreview, { port: ports.preview }) : '',
  ]
    .filter(Boolean)
    .join(', ');
  const rows: Array<[string, string]> = [
    [C.diagVersion, versions.studio],
    [C.diagNode, versions.node],
    [C.diagBundle, versions.bundle.sha256 ? fillCopy(C.diagBundleSha, { hash: versions.bundle.sha256.slice(0, 12) }) : C.diagBundleSource],
    [C.diagMode, `${mode.channel === 'dev' ? C.diagModeDev : C.diagModeStable}, ${mode.desktop ? C.diagModeDesktop : C.diagModeBrowser}`],
    [C.diagDataFolder, info.dataFolder],
    [C.diagPorts, portText],
    [C.diagHelper, [helper.sentence, helper.models.join(', ')].filter(Boolean).join(' ')],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-xs font-medium text-slate-slate400">{term}</dt>
          <dd className="break-all text-slate-slate200">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DiagnosticsBody() {
  const { info, doctor, logs, reloadInfo, checkAgain, refreshLogs, toggling, toggleDebug, saveReport } = useDiagnostics();
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // The summary text, shown in a box to select when the clipboard refuses it.
  const [manualSummary, setManualSummary] = useState<string | null>(null);
  const needsId = useId();
  const switchLabel = useId();
  const switchHint = useId();
  const filterId = useId();

  const shown = useMemo(() => (logs.data ?? []).filter((rec) => SHOWN[filter].has(rec.level)), [logs.data, filter]);
  const ready = info.data !== null && doctor.data !== null && logs.data !== null;

  const onSave = async () => {
    setSaving(true);
    setNote(null);
    setManualSummary(null);
    const error = await saveReport();
    setSaving(false);
    setNote(error ? { kind: 'error', text: error } : { kind: 'ok', text: C.diagReportSaved });
  };

  const onCopy = async () => {
    if (!info.data || !doctor.data || !logs.data) return;
    const text = buildSummary(info.data, doctor.data, logs.data);
    try {
      await navigator.clipboard.writeText(text);
      setManualSummary(null);
      setNote({ kind: 'ok', text: C.diagSummaryCopied });
    } catch {
      setManualSummary(text);
      setNote({ kind: 'error', text: C.diagCopyFailed });
    }
  };

  const onToggle = async (on: boolean) => {
    const error = await toggleDebug(on);
    setNote(error ? { kind: 'error', text: error } : null);
  };

  const loadFailed = info.error !== null || doctor.error !== null || logs.error !== null;
  const debug = info.data?.debug;
  const counts = doctor.data?.counts;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnSecondary} onClick={() => void onSave()} disabled={saving}>
          {saving ? C.diagSavingReport : C.diagSaveReport}
        </button>
        <button type="button" className={btnSecondary} onClick={() => void onCopy()} disabled={!ready} aria-describedby={!ready && loadFailed ? needsId : undefined}>
          {C.diagCopySummary}
        </button>
        <p role="status" className="text-xs text-slate-slate300">
          {note?.kind === 'ok' ? note.text : ''}
        </p>
        {note?.kind === 'error' && (
          <p role="alert" className={formErrorClass}>
            {note.text}
          </p>
        )}
      </div>

      {!ready && loadFailed && (
        <p id={needsId} className="text-xs text-slate-slate400">
          {C.diagSummaryNeeds}
        </p>
      )}
      {manualSummary !== null && (
        <textarea
          readOnly
          aria-label={C.diagSummaryLabel}
          value={manualSummary}
          rows={8}
          onFocus={(e) => e.currentTarget.select()}
          className="glass-input w-full rounded-md p-2 font-mono text-xs text-slate-slate300"
        />
      )}

      <section aria-label={C.diagThisCopy} className="space-y-2">
        <h4 className={H4}>{C.diagThisCopy}</h4>
        {info.data ? (
          <>
            <Facts info={info.data} />
            {info.data.recovered && (
              <p className="text-xs text-accent-amber">{fillCopy(C.diagRecovered, { time: timeOf(info.data.recovered.at) })}</p>
            )}
          </>
        ) : info.error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className={formErrorClass}>
              {`${C.diagLoadFailed} ${info.error}`}
            </p>
            <button type="button" className={btnSecondary} onClick={() => void reloadInfo()}>
              {C.tryAgain}
            </button>
          </div>
        ) : (
          <ListSkeleton rows={4} />
        )}
      </section>

      <section aria-label={C.diagDebugTitle} className="space-y-2">
        <h4 className={H4}>{C.diagDebugTitle}</h4>
        <div className="flex items-start gap-3">
          <SwitchToggle
            checked={debug?.on === true}
            disabled={!debug || debug.env || toggling}
            labelledBy={switchLabel}
            describedBy={switchHint}
            onChange={(on: boolean) => void onToggle(on)}
          />
          <div>
            <p id={switchLabel} className="text-sm text-slate-slate200">
              {C.diagDebugSwitch}
            </p>
            <p id={switchHint} className="text-xs text-slate-slate400">
              {debug?.env ? C.diagDebugEnvHint : C.diagDebugHint}
            </p>
          </div>
        </div>
      </section>

      <section aria-label={C.diagChecksTitle} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className={H4}>{C.diagChecksTitle}</h4>
          <button type="button" className={btnSecondary} onClick={() => void checkAgain()} disabled={doctor.loading}>
            {doctor.loading && doctor.data !== null ? C.diagChecking : C.diagCheckAgain}
          </button>
        </div>
        {doctor.error && (
          <p role="alert" className={formErrorClass}>
            {`${C.diagLoadFailed} ${doctor.error}`}
          </p>
        )}
        {doctor.data ? (
          <>
            {counts && (
              <p className="text-xs text-slate-slate300">
                {fillCopy(C.diagChecksCount, { found: counts.found, missing: counts.missing, problem: counts.problem })}
              </p>
            )}
            <div role="region" aria-label={C.diagChecksRegion} tabIndex={0} className={`overflow-x-auto ${SCROLL_FOCUS}`}>
              <table className="w-full min-w-[32rem]" aria-label={C.diagChecksTitle} aria-busy={doctor.loading}>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>{C.diagColStatus}</th>
                    <th scope="col" className={TH}>{C.diagColItem}</th>
                    <th scope="col" className={TH}>{C.diagColDetails}</th>
                    <th scope="col" className={TH}>{C.diagColAction}</th>
                  </tr>
                </thead>
                <tbody>
                  {doctor.data.lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-slate700/60">
                      <td className={TD}>
                        <span className={`${PILL} ${line.status === 'found' ? TONE_CLASS.ok : TONE_CLASS.warn}`}>{STATUS_WORDS[line.status]}</span>
                      </td>
                      <td className={`${TD} font-medium text-slate-slate100`}>{line.label}</td>
                      <td className={`${TD} break-all`}>{line.detail}</td>
                      <td className={TD}>{line.status === 'found' ? '' : line.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          doctor.loading && <ListSkeleton rows={5} />
        )}
      </section>

      <section aria-label={C.diagLogTitle} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className={H4}>{C.diagLogTitle}</h4>
          <div className="flex items-center gap-2">
            <label htmlFor={filterId} className="text-xs font-medium text-slate-slate400">
              {C.diagLogFilter}
            </label>
            <select id={filterId} className={`${inputClass} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as LevelFilter)}>
              <option value="all">{C.diagLogAll}</option>
              <option value="warnings">{C.diagLogWarnings}</option>
              <option value="errors">{C.diagLogErrors}</option>
            </select>
            <button type="button" className={btnSecondary} onClick={() => void refreshLogs()} disabled={logs.loading}>
              {C.diagRefresh}
            </button>
          </div>
        </div>
        {logs.error && (
          <p role="alert" className={formErrorClass}>
            {`${C.diagLoadFailed} ${logs.error}`}
          </p>
        )}
        {logs.data === null ? (
          logs.loading && <ListSkeleton rows={4} />
        ) : shown.length === 0 ? (
          <p className="text-xs text-slate-slate400">{C.diagLogEmpty}</p>
        ) : (
          <div role="region" aria-label={C.diagLogRegion} tabIndex={0} className={`max-h-96 overflow-auto ${SCROLL_FOCUS}`}>
            <table className="w-full min-w-[40rem]" aria-label={C.diagLogTitle}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>{C.diagColTime}</th>
                  <th scope="col" className={TH}>{C.diagColLevel}</th>
                  <th scope="col" className={TH}>{C.diagColWhat}</th>
                  <th scope="col" className={TH}>{C.diagColWhere}</th>
                  <th scope="col" className={TH}>{C.diagColRequest}</th>
                  <th scope="col" className={TH}>{C.diagColMs}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((rec, index) => (
                  <tr key={`${rec.time}-${index}`} className="border-t border-slate-slate700/60">
                    <td className={`${TD} whitespace-nowrap`}>{timeOf(rec.time)}</td>
                    <td className={TD}>
                      <span className={`${PILL} ${rec.level === 'debug' || rec.level === 'info' ? TONE_CLASS.muted : TONE_CLASS.warn}`}>{rec.level}</span>
                    </td>
                    <td className={`${TD} break-all`}>{rec.code ? `${rec.event} ${rec.code}` : rec.event}</td>
                    <td className={`${TD} break-all`}>{whereOf(rec)}</td>
                    <td className={`${TD} break-all`}>{rec.requestId ?? ''}</td>
                    <td className={TD}>{typeof rec.durationMs === 'number' ? Math.round(rec.durationMs) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** What to share when something goes wrong: versions, the checks, debug mode, the recent log and a report to save. Closed until asked for, so a plain Settings visit runs no check. */
export default function DiagnosticsSection() {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#diagnostics');
  const bodyId = useId();
  return (
    <StudioSectionCard {...sectionProps('diagnostics')} title={C.diagTitle} className="py-3" icon={Stethoscope} subtitle={C.diagSubtitle}>
      <div className="space-y-6">
        <button type="button" className={btnSecondary} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
          {open ? C.diagHide : C.diagShow}
        </button>
        <div id={bodyId}>{open && <DiagnosticsBody />}</div>
      </div>
    </StudioSectionCard>
  );
}
