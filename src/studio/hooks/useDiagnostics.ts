// Settings > Diagnostics: the three reads (info, doctor, logs), the debug switch and the report download.
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { fillCopy, SURFACE_COPY } from '@/errors/surfaceCopy.js';
import { downloadBlob } from '../lib/download';
import { errorLine } from '../lib/errorWords';
import { redactClientText } from '../errors/copyDetails';
import {
  getDiagnostics,
  getDoctor,
  getLogs,
  getReport,
  setDebug,
  type DiagnosticsInfo,
  type DoctorReport,
  type LogRecord,
} from '../services/diagnosticsApi';

export interface Load<T> {
  data: T | null;
  loading: boolean;
  /** One plain sentence plus its next action, or null. */
  error: string | null;
}

export interface UseDiagnostics {
  info: Load<DiagnosticsInfo>;
  doctor: Load<DoctorReport>;
  /** Newest first. */
  logs: Load<LogRecord[]>;
  /** Reads the info block again (the retry after it failed to load). */
  reloadInfo(): Promise<void>;
  checkAgain(): Promise<void>;
  refreshLogs(): Promise<void>;
  /** True while a debug switch call is in flight. */
  toggling: boolean;
  /** Turns the session debug mode on or off; resolves with an error line or null. A second call while one runs does nothing. */
  toggleDebug(on: boolean): Promise<string | null>;
  /** Saves the report ZIP; resolves with an error line or null. */
  saveReport(): Promise<string | null>;
}

const idle = <T,>(): Load<T> => ({ data: null, loading: true, error: null });

/** Runs `fetcher` into a Load state; a newer run makes an older answer stale. */
function useLoad<T>(fetcher: () => Promise<T>): [Load<T>, () => Promise<void>, Dispatch<SetStateAction<Load<T>>>] {
  const [state, setState] = useState<Load<T>>(idle<T>);
  const alive = useRef(true);
  const seq = useRef(0);
  const run = useCallback(async (): Promise<void> => {
    seq.current += 1;
    const mine = seq.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetcher();
      if (alive.current && mine === seq.current) setState({ data, loading: false, error: null });
    } catch (err) {
      if (alive.current && mine === seq.current) setState((prev) => ({ ...prev, loading: false, error: errorLine(err) }));
    }
  }, [fetcher]);
  useEffect(() => {
    alive.current = true;
    void run();
    return () => {
      alive.current = false;
    };
  }, [run]);
  return [state, run, setState];
}

const fetchLogs = async (): Promise<LogRecord[]> => (await getLogs(200, 'debug')).slice().reverse();

export function useDiagnostics(): UseDiagnostics {
  const [info, reloadInfo, setInfo] = useLoad(getDiagnostics);
  const [toggling, setToggling] = useState(false);
  const togglingRef = useRef(false);
  const [doctor, checkAgain] = useLoad(getDoctor);
  const [logs, refreshLogs] = useLoad(fetchLogs);

  const toggleDebug = useCallback(
    async (on: boolean): Promise<string | null> => {
      if (togglingRef.current) return null;
      togglingRef.current = true;
      setToggling(true);
      try {
        const debug = await setDebug(on);
        setInfo((prev) => (prev.data ? { ...prev, data: { ...prev.data, debug } } : prev));
        return null;
      } catch (err) {
        return errorLine(err);
      } finally {
        togglingRef.current = false;
        setToggling(false);
      }
    },
    [setInfo],
  );

  const saveReport = useCallback(async (): Promise<string | null> => {
    try {
      const report = await getReport();
      downloadBlob(report.filename, report.blob);
      return null;
    } catch (err) {
      return errorLine(err);
    }
  }, []);

  return { info, doctor, logs, reloadInfo, checkAgain, refreshLogs, toggling, toggleDebug, saveReport };
}

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The Copy summary text (DESIGN-phase15.md 8.4); same layout as the server's summaryText. `logs` is newest first. */
export function buildSummary(info: DiagnosticsInfo, doctor: DoctorReport, logs: LogRecord[]): string {
  const { versions, mode, helper } = info;
  const missing = doctor.lines.filter((l) => l.status === 'missing').map((l) => l.label.replace(/ \(.*\)$/, ''));
  const build = versions.bundle.sha256 ? fillCopy(SURFACE_COPY.sumBundle, { sha: versions.bundle.sha256.slice(0, 12) }) : SURFACE_COPY.sumFromSource;
  const errors = logs.filter((l) => l.level === 'error' || l.level === 'fatal');
  const last = errors[0];
  const at = last ? hhmm(last.time) : '';
  const logLine = last
    ? fillCopy(SURFACE_COPY.sumLogErrors, {
        count: errors.length,
        errorWord: errors.length === 1 ? SURFACE_COPY.sumErrorOne : SURFACE_COPY.sumErrorMany,
        lines: logs.length,
        latest: last.code ?? last.event,
        at: at ? fillCopy(SURFACE_COPY.sumLogAt, { at }) : '',
      })
    : fillCopy(SURFACE_COPY.sumLogNone, { lines: logs.length });
  const helperText = helper.state === 'ready' ? fillCopy(SURFACE_COPY.sumHelperReady, { models: helper.models.join(', ') }) : helper.sentence.toLowerCase();
  return [
    fillCopy(SURFACE_COPY.sumTitle, {
      version: versions.studio,
      channel: mode.channel === 'dev' ? SURFACE_COPY.sumChannelDev : SURFACE_COPY.sumChannelStable,
      mode: mode.desktop ? SURFACE_COPY.sumModeDesktop : SURFACE_COPY.sumModeBrowser,
    }),
    fillCopy(SURFACE_COPY.sumNode, { node: versions.node, build }),
    fillCopy(SURFACE_COPY.sumDataFolder, { folder: redactClientText(info.dataFolder) }),
    fillCopy(SURFACE_COPY.sumHelper, { text: helperText }),
    fillCopy(SURFACE_COPY.sumChecks, {
      found: doctor.counts.found,
      missing: doctor.counts.missing,
      names: missing.length ? fillCopy(SURFACE_COPY.sumMissingNames, { names: missing.join(', ') }) : '',
      problem: doctor.counts.problem,
      problemWord: doctor.counts.problem === 1 ? SURFACE_COPY.sumProblemOne : SURFACE_COPY.sumProblemMany,
    }),
    fillCopy(SURFACE_COPY.sumDebug, { state: info.debug.on ? SURFACE_COPY.sumOn : SURFACE_COPY.sumOff }),
    fillCopy(SURFACE_COPY.sumLog, { text: logLine }),
    '',
  ].join('\n');
}

