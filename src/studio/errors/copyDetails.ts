// The text behind "Copy details": what happened, where, the envelope and the last log lines (DESIGN-phase15.md 7.1).
// Pure apart from fetchLogLines. Everything built on the client passes through redactClientText first.
import { SURFACE_COPY, fillCopy } from '@/errors/surfaceCopy.js';
import { errorWords } from '../lib/errorWords';
import { getLogs } from '../services/diagnosticsApi';

export const LOG_LINE_COUNT = 50;
const MAX_VALUE_CHARS = 2000;
const MAX_FRAMES = 3;

const TOKEN_RE = /(?:sk-|sk_(?:live|test)_|gsk_|gh[pousr]_|github_pat_|xox[abpr]-|ya29\.|AKIA|AIza)[A-Za-z0-9_.-]{6,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}[A-Za-z0-9_.-]*|\bBearer\s+\S+/g;
// The user name may hold spaces ("Sam Smith"), so a name followed by a separator runs to that separator; a name with
// nothing after it stops at the first space. Same rule as the server (server/redact.js redactText).
const WINDOWS_HOME_RE = /[A-Za-z]:[\\/]+Users[\\/]+(?:[^\\/:"'<>|\r\n]+(?=[\\/])|[^\\/\s"'<>|]+)/gi;
const WINDOWS_PATH_RE = /[A-Za-z]:[\\/][^\s"'<>|]+/g;
const POSIX_HOME_RE = /\/(?:Users|home)\/[^/\s"']+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** Hides home folders, tokens and e-mail addresses, reduces any other absolute Windows path to <path>/<last>, and cuts a value to 2000 characters. */
export function redactClientText(text: string): string {
  const cleaned = text
    .replace(TOKEN_RE, '[redacted]')
    .replace(EMAIL_RE, '[redacted]')
    .replace(WINDOWS_HOME_RE, '<home>')
    .replace(POSIX_HOME_RE, '<home>')
    .replace(WINDOWS_PATH_RE, (m) => `<path>/${m.split(/[\\/]/).filter((seg) => seg !== '').pop() ?? ''}`);
  return cleaned.length > MAX_VALUE_CHARS ? `${cleaned.slice(0, MAX_VALUE_CHARS)}...` : cleaned;
}

function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactClientText(value);
  if (depth >= 4) return '[redacted]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) out[key] = redactValue(item, depth + 1);
    return out;
  }
  return typeof value === 'function' ? undefined : value;
}

export interface ComponentInfo {
  component: string;
  frames: string[];
}

/** The failing component and its first three frames (file and line only) from a React component stack. */
export function componentInfo(componentStack: string | null | undefined): ComponentInfo | null {
  if (!componentStack) return null;
  const lines = componentStack.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at '));
  if (lines.length === 0) return null;
  const component = /^at\s+([^\s(]+)/.exec(lines[0])?.[1] ?? 'unknown';
  const frames: string[] = [];
  for (const line of lines) {
    const match = /(?:https?:\/\/[^/\s)]+)?(\/?[^\s()?]*?)(?:\?[^\s():]*)?:(\d+)(?::\d+)?\)?\s*$/.exec(line);
    if (match !== null && match[1] !== '') frames.push(`${match[1].replace(/^\//, '')}:${match[2]}`);
    if (frames.length >= MAX_FRAMES) break;
  }
  return { component, frames };
}

export interface DetailsEnvelope {
  error: string;
  code: string;
  action: string;
  requestId: string | null;
  details?: ComponentInfo;
}

/** The envelope shown in Copy details: the words of `err`, plus the component info when a boundary caught it. */
export function envelopeFor(err: unknown, componentStack?: string | null): DetailsEnvelope {
  const words = errorWords(err, { boundary: true });
  const info = componentInfo(componentStack);
  const envelope: DetailsEnvelope = { error: words.sentence, code: words.code, action: words.action, requestId: words.requestId };
  if (info !== null) envelope.details = info;
  return envelope;
}

export interface DetailsInput {
  envelope: DetailsEnvelope;
  /** The step name, when the error came from one step. */
  stepLabel?: string | null;
  path: string;
  /** Already redacted by the server; null when they could not be read. */
  logLines: readonly string[] | null;
  now: Date;
}

/** The whole Copy details text. */
export function buildDetails({ envelope, stepLabel = null, path, logLines, now }: DetailsInput): string {
  const where = stepLabel ? `${stepLabel} step, ${path}` : path;
  const requestId = envelope.requestId ?? SURFACE_COPY.detailsNoRequestId;
  const safe = redactValue(envelope);
  const head = [
    SURFACE_COPY.detailsHeader,
    `${SURFACE_COPY.detailsWhen}: ${now.toISOString()}`,
    `${SURFACE_COPY.detailsWhere}: ${redactClientText(where)}`,
    `${SURFACE_COPY.detailsWhat}: ${redactClientText(envelope.error)} (${envelope.code})`,
    `${SURFACE_COPY.detailsNext}: ${redactClientText(envelope.action)}`,
    `${SURFACE_COPY.detailsRequestId}: ${requestId}`,
    `${SURFACE_COPY.detailsEnvelope}:`,
    JSON.stringify(safe),
  ];
  if (logLines === null) return [...head, SURFACE_COPY.detailsLogsFailed].join('\n');
  const tail = logLines.slice(-LOG_LINE_COUNT).map(redactClientText);
  if (tail.length === 0) return [...head, SURFACE_COPY.detailsLogsEmpty].join('\n');
  return [...head, `${fillCopy(SURFACE_COPY.detailsLogs, { count: tail.length })}:`, ...tail].join('\n');
}

const LOG_TIMEOUT_MS = 3000;

/** The last 50 redacted log lines from the server, or null when the call fails or takes over 3 seconds (Copy details then says so). */
export async function fetchLogLines(fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const lines = await getLogs(LOG_LINE_COUNT, 'debug', { fetchImpl, signal: AbortSignal.timeout(LOG_TIMEOUT_MS) });
    return lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line)));
  } catch {
    return null;
  }
}
