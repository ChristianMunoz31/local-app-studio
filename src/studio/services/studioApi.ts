// Client for the Studio server (server/studio/appsRoutes.js, previewRoutes.js). Every failure is a StudioApiError that
// carries the HTTP status, the machine code, the server's plain-words message and its next action (the error envelope,
// DESIGN-phase15.md 1.1; `message` is kept as an alias of `error`).
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import type { SampleRecords } from '../lib/sampleData';
import type { AppRecord, AppSummary, WaitingEntry, FeatureInput, FeatureRecord, FeatureImportResult, FeatureUsage, PreviewStatus } from '../types';

const API = '/api/studio';
const FALLBACK_MESSAGE = 'Could not reach Local App Studio. Check that it is still running, then try again.';

export class StudioApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly issues: SpecIssue[];
  readonly revision: number | null;
  reason: string | null = null;
  feature: string | null = null;
  /** The envelope's next step in plain words, when the server sent one. */
  action: string | null = null;
  /** The envelope's request id, or the X-Request-Id header. */
  requestId: string | null = null;
  /** Set on a refused delete (feature_in_use): where the feature is used. */
  inUse: FeatureUsage | null = null;
  constructor(message: string, status: number, code: string | null, issues: SpecIssue[] = [], revision: number | null = null) {
    super(message);
    this.name = 'StudioApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.revision = revision;
  }
}

interface ErrorBody {
  error?: unknown;
  code?: unknown;
  action?: unknown;
  requestId?: unknown;
  message?: unknown;
  issues?: unknown;
  revision?: unknown;
  reason?: unknown;
  feature?: unknown;
  apps?: unknown;
  features?: unknown;
}

const SNAKE_CODE = /^[a-z][a-z0-9_]*$/;

/** The machine code: `code` in the envelope, else a bare snake_case `error` (older bodies). */
function codeOf(data: ErrorBody): string | null {
  if (typeof data.code === 'string' && data.code) return data.code;
  return typeof data.error === 'string' && SNAKE_CODE.test(data.error) ? data.error : null;
}

/** Builds the error for a non-OK response. Exported for the SSE client. */
export async function errorFromResponse(response: Response): Promise<StudioApiError> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody | null;
  const data: ErrorBody = body && typeof body === 'object' ? body : {};
  const sentence = typeof data.error === 'string' && !SNAKE_CODE.test(data.error) ? data.error : null;
  const sent = typeof data.message === 'string' && data.message ? data.message : (sentence ?? FALLBACK_MESSAGE);
  const action = typeof data.action === 'string' && data.action.trim() !== '' ? data.action : null;
  // The message carries the next step, so every place that shows `.message` shows it too (errorWords splits it off again).
  const message = action !== null && !sent.trim().toLowerCase().endsWith(action.trim().toLowerCase()) ? `${sent.trim()} ${action.trim()}` : sent;
  const err = new StudioApiError(
    message,
    response.status,
    codeOf(data),
    Array.isArray(data.issues) ? (data.issues as SpecIssue[]) : [],
    typeof data.revision === 'number' ? data.revision : null,
  );
  if (action !== null) err.action = action;
  err.requestId = typeof data.requestId === 'string' && data.requestId ? data.requestId : response.headers?.get?.('X-Request-Id') ?? null;
  if (typeof data.reason === 'string') err.reason = data.reason;
  if (typeof data.feature === 'string') err.feature = data.feature;
  if (Array.isArray(data.apps) || Array.isArray(data.features)) {
    err.inUse = {
      apps: Array.isArray(data.apps) ? (data.apps as FeatureUsage['apps']) : [],
      features: Array.isArray(data.features) ? (data.features as FeatureUsage['features']) : [],
    };
  }
  return err;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: hasBody ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  if (!response.ok) throw await errorFromResponse(response);
  const body = (await response.json().catch(() => ({}))) as { data?: T };
  return body.data as T;
}

const enc = encodeURIComponent;

export const listApps = (): Promise<AppSummary[]> => req<AppSummary[]>('/apps');
export const getApp = (id: string, signal?: AbortSignal): Promise<AppRecord> => req<AppRecord>(`/apps/${enc(id)}`, { signal });
export const createApp = (name: string): Promise<AppRecord> => req<AppRecord>('/apps', { method: 'POST', body: JSON.stringify({ name }) });
/** With `sample` (an example's records) the server keeps them with the app; without it the body is only the spec. */
export const importApp = (spec: unknown, sample?: unknown): Promise<AppRecord> =>
  req<AppRecord>('/apps/import', { method: 'POST', body: JSON.stringify(sample === undefined ? { spec } : { spec, sample }) });
/** Without a name the server gives the copy its default name. */
/** A copy; `recordsCopied` is there when the copy was asked to keep the Preview records. */
export type DuplicatedApp = AppRecord & { recordsCopied?: boolean };

export const duplicateApp = (id: string, name?: string, withRecords?: boolean): Promise<DuplicatedApp> =>
  req<DuplicatedApp>(`/apps/${enc(id)}/duplicate`, name === undefined && withRecords === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify({ ...(name === undefined ? {} : { name }), ...(withRecords === undefined ? {} : { withRecords }) }) });

/** The app's design and its Preview records as one ZIP (the Preview must be running for that app). */
export async function exportWithRecords(id: string): Promise<Blob> {
  const response = await fetch(`${API}/apps/${enc(id)}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: true }) });
  if (!response.ok) throw await errorFromResponse(response);
  return response.blob();
}
/** The example records kept with the app (read only); an app without any answers an empty sample. */
export const getSample = (id: string, signal?: AbortSignal): Promise<SampleRecords> => req<SampleRecords>(`/apps/${enc(id)}/sample`, { signal });
/** The helper's design kept with the app, or null. */
export const getWaiting = (id: string, signal?: AbortSignal): Promise<WaitingEntry | null> => req<WaitingEntry | null>(`/apps/${enc(id)}/waiting`, { signal });
/** With `at` (the entry's version) the server only clears that version; a newer design from another window stays. */
export const deleteWaiting = async (id: string, at?: string | null): Promise<void> => {
  const guard = at === undefined || at === null ? '' : `?at=${enc(at)}`;
  await req<{ id: string }>(`/apps/${enc(id)}/waiting${guard}`, { method: 'DELETE' });
};
/** With `ifRevision` the server refuses (409 revision_conflict) when the app was saved since that revision. */
export const deleteApp = async (id: string, ifRevision?: number): Promise<void> => {
  const guard = ifRevision === undefined ? '' : `?ifRevision=${ifRevision}`;
  await req<{ id: string }>(`/apps/${enc(id)}${guard}`, { method: 'DELETE' });
};
/** `clearWaiting` drops the app's waiting helper design in the same save (Use this); with `waitingAt` only the version the person used. */
export const saveSpec = (id: string, spec: unknown, baseRevision: number, opts: { clearWaiting?: boolean; waitingAt?: string | null } = {}): Promise<AppRecord> => {
  if (opts.clearWaiting !== true) return req<AppRecord>(`/apps/${enc(id)}`, { method: 'PUT', body: JSON.stringify({ spec, baseRevision }) });
  const waitingAt = typeof opts.waitingAt === 'string' ? { waitingAt: opts.waitingAt } : {};
  return req<AppRecord>(`/apps/${enc(id)}`, { method: 'PUT', body: JSON.stringify({ spec, baseRevision, clearWaiting: true, ...waitingAt }) });
};

export const previewStatus = (): Promise<PreviewStatus> => req<PreviewStatus>('/preview/status');
export const previewStart = (appId: string): Promise<PreviewStatus> =>
  req<PreviewStatus>('/preview/start', { method: 'POST', body: JSON.stringify({ appId }) });
export const previewReset = (appId: string): Promise<PreviewStatus> =>
  req<PreviewStatus>('/preview/reset', { method: 'POST', body: JSON.stringify({ appId, confirm: 'reset' }) });
export const previewStop = (): Promise<PreviewStatus> => req<PreviewStatus>('/preview/stop', { method: 'POST', body: '{}' });

/** The feature library (server/studio/features/routes.js). */
export const featuresApi = {
  list: (): Promise<FeatureRecord[]> => req<FeatureRecord[]>('/features'),
  get: (id: string): Promise<FeatureRecord> => req<FeatureRecord>(`/features/${enc(id)}`),
  create: (feature: FeatureInput): Promise<FeatureRecord> => req<FeatureRecord>('/features', { method: 'POST', body: JSON.stringify({ feature }) }),
  update: (id: string, feature: FeatureInput, baseVersion: number): Promise<FeatureRecord> =>
    req<FeatureRecord>(`/features/${enc(id)}`, { method: 'PUT', body: JSON.stringify({ feature, baseVersion }) }),
  duplicate: (id: string): Promise<FeatureRecord> => req<FeatureRecord>(`/features/${enc(id)}/duplicate`, { method: 'POST' }),
  remove: async (id: string): Promise<void> => {
    await req<{ id: string }>(`/features/${enc(id)}`, { method: 'DELETE' });
  },
  importFile: (file: unknown): Promise<FeatureImportResult> =>
    req<FeatureImportResult>('/features/import', { method: 'POST', body: JSON.stringify({ file }) }),
};
