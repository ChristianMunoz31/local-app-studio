// Client for the Diagnostics routes (server/diagnostics/routes.js, DESIGN-phase15.md 8.3). Failures are StudioApiErrors.
import { errorFromResponse } from './studioApi';

const API = '/api/studio/diagnostics';

export type HelperState = 'ready' | 'down' | 'no_tools_model' | 'remote' | 'off';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type DoctorStatus = 'found' | 'missing' | 'problem';

export interface DebugState {
  env: boolean;
  session: boolean;
  on: boolean;
}

export interface DiagnosticsInfo {
  versions: { studio: string; node: string; bundle: { sea: boolean; sha256: string | null } };
  mode: { app: string; channel: string; desktop: boolean };
  dataFolder: string;
  ports: { app: number | null; preview: number | null };
  helper: { state: HelperState; host: string; models: string[]; sentence: string };
  debug: DebugState;
  log: { files: Array<{ name: string; bytes: number }>; ring: number };
  recovered: { at: string; code: string } | null;
}

export interface DoctorLine {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  action: string;
}

export interface DoctorReport {
  checkedAt: string;
  lines: DoctorLine[];
  counts: { found: number; missing: number; problem: number };
}

export interface LogRecord {
  level: LogLevel;
  time: string;
  requestId: string | null;
  event: string;
  route?: string;
  stage?: string;
  status?: number;
  code?: string;
  durationMs?: number;
}

export interface SavedReport {
  filename: string;
  blob: Blob;
}

export interface CallOptions {
  /** A fetch to use instead of the global one (tests, Copy details). */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** The answer had no `data`: the same error a 500 would give, in plain words (code server_error). */
function emptyAnswer(): Error {
  return Object.assign(new Error(''), { code: 'server_error' });
}

async function readData<T>(response: Response): Promise<T> {
  if (!response.ok) throw await errorFromResponse(response);
  const body = (await response.json().catch(() => null)) as { data?: T } | null;
  if (body === null || typeof body !== 'object' || body.data === undefined || body.data === null) throw emptyAnswer();
  return body.data;
}

async function get<T>(path: string, options: CallOptions = {}): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;
  return readData<T>(await doFetch(`${API}${path}`, options.signal ? { signal: options.signal } : undefined));
}

export const getDiagnostics = (): Promise<DiagnosticsInfo> => get<DiagnosticsInfo>('');
export const getDoctor = (): Promise<DoctorReport> => get<DoctorReport>('/doctor');
export const getLogs = async (limit = 200, level: LogLevel = 'debug', options: CallOptions = {}): Promise<LogRecord[]> => {
  const data = await get<{ lines?: LogRecord[] }>(`/logs?limit=${limit}&level=${level}`, options);
  if (!Array.isArray(data.lines)) throw emptyAnswer();
  return data.lines;
};

export async function setDebug(on: boolean): Promise<DebugState> {
  return readData<DebugState>(await fetch(`${API}/debug`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) }));
}

const FILENAME_RE = /filename="?([^";]+)"?/i;

/** Fetches the report ZIP and the filename the server chose for it. */
export async function getReport(): Promise<SavedReport> {
  const response = await fetch(`${API}/report`);
  if (!response.ok) throw await errorFromResponse(response);
  const blob = await response.blob();
  const filename = FILENAME_RE.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'local-app-studio-report.zip';
  return { filename, blob };
}
