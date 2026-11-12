// Client for the build routes (server/studio/buildRoutes.js, DESIGN-phase4.md sections 4 and 9). Failures are StudioApiErrors.
import { readSse } from '@/utils/sse.js';
import type { BuildEvent, BuildLogLine, BuildRecord, BuildStepState, StepId, StepStatus, ToolchainReport } from '../buildTypes';
import { errorFromResponse } from './studioApi';

const API = '/api/studio';
const enc = encodeURIComponent;

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

export const getToolchain = (refresh = false, signal?: AbortSignal): Promise<ToolchainReport> =>
  req<ToolchainReport>(`/build/toolchain${refresh ? '?refresh=1' : ''}`, { signal });
export const listBuilds = (appId: string, signal?: AbortSignal): Promise<BuildRecord[]> => req<BuildRecord[]>(`/apps/${enc(appId)}/builds`, { signal });
export const startBuild = (appId: string, baseRevision: number): Promise<BuildRecord> =>
  req<BuildRecord>(`/apps/${enc(appId)}/builds`, { method: 'POST', body: JSON.stringify({ baseRevision }) });
export const getBuild = (buildId: string, signal?: AbortSignal): Promise<BuildRecord> => req<BuildRecord>(`/builds/${enc(buildId)}`, { signal });
export const cancelBuild = (buildId: string): Promise<BuildRecord> => req<BuildRecord>(`/builds/${enc(buildId)}/cancel`, { method: 'POST', body: '{}' });

type Payload = Record<string, unknown>;

function toEvent(name: string, p: Payload): BuildEvent | null {
  switch (name) {
    case 'snapshot':
      return {
        type: 'snapshot',
        build: p.build as BuildRecord,
        steps: Array.isArray(p.steps) ? (p.steps as BuildStepState[]) : [],
        lines: Array.isArray(p.lines) ? (p.lines as BuildLogLine[]) : [],
        truncated: p.truncated === true,
        live: p.live === true,
      };
    case 'step':
      return { type: 'step', step: p.step as StepId, status: p.status as StepStatus, at: typeof p.at === 'string' ? p.at : '' };
    case 'log':
      return { type: 'log', seq: typeof p.seq === 'number' ? p.seq : 0, step: p.step as StepId, line: typeof p.line === 'string' ? p.line : '' };
    case 'end':
      return { type: 'end', build: p.build as BuildRecord };
    default:
      return null;
  }
}

export interface StreamBuildArgs {
  signal?: AbortSignal;
  onEvent(event: BuildEvent): void;
}

/** Resolves when the stream closes. A non-OK response throws a StudioApiError. */
export async function streamBuild(buildId: string, { signal, onEvent }: StreamBuildArgs): Promise<void> {
  const response = await fetch(`${API}/builds/${enc(buildId)}/events`, { headers: { Accept: 'text/event-stream' }, signal });
  if (!response.ok) throw await errorFromResponse(response);
  await readSse(response, (name: string, payload: unknown) => {
    const event = toEvent(name, payload && typeof payload === 'object' ? (payload as Payload) : {});
    if (event) onEvent(event);
  });
}
