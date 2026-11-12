// Describe client: POST /api/studio/apps/:id/describe and read the server-sent events (DESIGN-phase3.md 3.1, 7.3).
import { readSse } from '@/utils/sse.js';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import type { DescribeEvent, DescribeFallback } from '../types';
import { errorFromResponse } from './studioApi';

export interface DescribeStreamArgs {
  appId: string;
  mode: 'create' | 'edit';
  instruction: string;
  baseRevision: number;
  /** 'waiting': change the design the server keeps for this app instead of the saved one (mode edit only). */
  onto?: 'waiting';
  /** Page titles of the base spec by page id, used to label progress (an unknown page shows its id). */
  pageTitles?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  onEvent(event: DescribeEvent): void;
}

type Payload = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function toEvent(name: string, p: Payload, pageTitles: Readonly<Record<string, string>> = {}): DescribeEvent | null {
  switch (name) {
    case 'meta': {
      const ai = (p.ai ?? {}) as Payload;
      return { type: 'meta', ai: { kind: str(ai.kind, 'local'), host: typeof ai.host === 'string' ? ai.host : null } };
    }
    case 'progress': {
      // The server sends the pipeline's { step, pageId?, round, status: running | repairing | ok | fallback }.
      const status = p.status === 'ok' ? 'done' : p.status === 'fallback' ? 'failed' : 'running';
      const step = str(p.step);
      const pageId = typeof p.pageId === 'string' ? p.pageId : undefined;
      const title = typeof p.title === 'string' && p.title !== '' ? p.title : undefined;
      const what = step === 'tables' ? 'Planning the tables' : step === 'outline' ? 'Planning the pages' : `Designing the page "${pageId !== undefined ? (title ?? (Object.hasOwn(pageTitles, pageId) ? pageTitles[pageId] : pageId)) : ''}"`;
      const suffix = p.status === 'repairing' ? ', fixing problems' : p.status === 'fallback' ? ', could not finish this part' : '';
      return { type: 'progress', step, status, message: `${what}${suffix}`, ...(pageId !== undefined ? { pageId } : {}) };
    }
    case 'proposal':
      return {
        type: 'proposal',
        proposal: p.proposal as AppSpec,
        fallbacks: Array.isArray(p.fallbacks) ? (p.fallbacks as DescribeFallback[]) : [],
        baseRevision: typeof p.baseRevision === 'number' ? p.baseRevision : 0,
        steps: typeof p.steps === 'number' ? p.steps : 0,
        onto: p.onto === 'waiting' ? 'waiting' : null,
        replaced: p.replaced !== null && typeof p.replaced === 'object' ? (p.replaced as AppSpec) : null,
        at: typeof p.at === 'string' ? p.at : null,
      };
    case 'error':
      return {
        type: 'error',
        code: str(p.code, 'error'),
        message: str(p.message, 'Something went wrong. Try again.'),
        ...(typeof p.retryMs === 'number' ? { retryMs: p.retryMs } : {}),
      };
    case 'done':
      return { type: 'done' };
    default:
      return null;
  }
}

/** Resolves when the stream ends. A non-OK response throws a StudioApiError (AI errors carry their code and reason). */
export async function runDescribeStream({ appId, mode, instruction, baseRevision, onto, pageTitles, signal, onEvent }: DescribeStreamArgs): Promise<void> {
  const response = await fetch(`/api/studio/apps/${encodeURIComponent(appId)}/describe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(onto === undefined ? { mode, instruction, baseRevision } : { mode, instruction, baseRevision, onto }),
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  await readSse(response, (name: string, payload: unknown) => {
    const event = toEvent(name, payload && typeof payload === 'object' ? (payload as Payload) : {}, pageTitles);
    if (event) onEvent(event);
  });
}
