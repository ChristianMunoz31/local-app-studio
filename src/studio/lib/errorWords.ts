// The client translator: any error value to one plain sentence, one next action and the request id.
// Studio chunks only; built apps and the initial chunk read codes through src/utils/apiError.js and never import this file.
import { ERROR_COPY } from '@/errors/errorCopy.js';

export interface ErrorWords {
  code: string;
  sentence: string;
  action: string;
  requestId: string | null;
}

export interface ErrorWordsOptions {
  /** Set by the error boundaries: an unknown thrown value is a render failure, not a server error. */
  boundary?: boolean;
}

const SNAKE_CODE = /^[a-z][a-z0-9_]*$/;
const FETCH_FAILURE = /Failed to fetch|NetworkError|Load failed/;
const CHUNK_FAILURE = /dynamically imported module|Importing a module script failed|error loading dynamically imported/;

const nonEmpty = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** True when `code` has a row in the copy table. */
export function hasErrorRow(code: string): boolean {
  return Object.hasOwn(ERROR_COPY, code);
}

function wordsFor(code: string, sentence: string | null, requestId: string | null): ErrorWords {
  const row = hasErrorRow(code) ? ERROR_COPY[code] : ERROR_COPY.server_error;
  return {
    code,
    sentence: sentence ?? row.sentence ?? ERROR_COPY.server_error.sentence ?? '',
    action: row.action,
    requestId,
  };
}

/** Splits a trailing copy of the action off a sentence (a StudioApiError message carries both); the tail keeps the sentence's own letters. */
function splitAction(sentence: string, action: string): { sentence: string; action: string } {
  const base = sentence.trim();
  const next = action.trim();
  if (base.length > next.length && base.toLowerCase().endsWith(next.toLowerCase())) {
    return { sentence: base.slice(0, base.length - next.length).trim(), action: base.slice(base.length - next.length) };
  }
  return { sentence, action };
}

/** Reads an envelope body, a StudioApiError or an Error with `code`, `action` and `requestId` fields. */
function fromEnvelope(input: object): ErrorWords | null {
  const record = input as Record<string, unknown>;
  const requestId = nonEmpty(record.requestId);
  const error = nonEmpty(record.error);
  const message = nonEmpty(record.message);
  const action = nonEmpty(record.action);
  const explicitCode = nonEmpty(record.code);
  // An older body keeps the code in `error`.
  const bareCode = error !== null && SNAKE_CODE.test(error) ? error : null;
  const code = explicitCode ?? bareCode;

  // 1. What the server sent, as sent (a sentence in `error`, or the message of a StudioApiError, plus its action).
  if (action !== null) {
    const sentence = bareCode !== null ? message : (error ?? message);
    if (sentence !== null) return { code: code ?? 'server_error', ...splitAction(sentence, action), requestId };
  }
  // 2. A known code: the sent sentence if there is one, else the row's.
  if (code !== null && hasErrorRow(code)) {
    return wordsFor(code, message ?? (bareCode === null ? error : null), requestId);
  }
  return null;
}

/** input: an envelope body, a StudioApiError, an Error with code/action/requestId, a fetch TypeError, a chunk load error, or anything. */
export function errorWords(input: unknown, options: ErrorWordsOptions = {}): ErrorWords {
  if (typeof input === 'object' && input !== null) {
    const found = fromEnvelope(input);
    if (found !== null) return found;
    const name = (input as { name?: unknown }).name;
    const message = typeof (input as { message?: unknown }).message === 'string' ? (input as { message: string }).message : '';
    // A failed lazy import is a TypeError too ("Failed to fetch dynamically imported module"), so it is checked first.
    if (name === 'ChunkLoadError' || CHUNK_FAILURE.test(message)) return wordsFor('chunk_load_failed', null, null);
    if (input instanceof TypeError && FETCH_FAILURE.test(message)) return wordsFor('network_unreachable', null, null);
  }
  return wordsFor(options.boundary === true ? 'render_failed' : 'server_error', null, null);
}

/** "<sentence> <action>", with the action left out when the sentence already ends with it (case-insensitive). */
export function errorLine(input: unknown): string {
  const { sentence, action } = errorWords(input);
  return sentence.toLowerCase().endsWith(action.toLowerCase()) ? sentence : `${sentence} ${action}`;
}
