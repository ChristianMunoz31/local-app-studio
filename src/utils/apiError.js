// Shared handling for the two structured error bodies the Local App Studio server sends:
//   403 { error: 'network_opt_in_required', feature, message }  (gated outbound feature is off)
//   503 { error: 'ai_not_configured', reason, message }        (AI is off or no model installed)
//   503 { error: 'ollama_unavailable', reason, message, hint } (Ollama is not reachable)
// `reason` is the finer cause: ai_disabled, no_model, no_tool_model, network_opt_in_required,
// ollama_unavailable. The UI keys "AI is turned off" off reason ai_disabled, never the text.
//   429 { error: 'ai_busy', message }                          (too many queued AI requests)
//   403 { error: 'pro_required', feature, message }            (a Pro capability without Pro)
//   409 { error: 'conversation_busy', message }                (another Assistant run is active in this chat)
// `message` is the human text. A bare `error` string is only shown when it is a known code with
// friendly copy below; raw `error` strings are never rendered.

export const NETWORK_OPT_IN_REQUIRED = 'network_opt_in_required';
export const AI_NOT_CONFIGURED = 'ai_not_configured';
export const OLLAMA_UNAVAILABLE = 'ollama_unavailable';
export const AI_BUSY = 'ai_busy';
/** 403 { error: 'pro_required', feature, message }: the capability needs Local App Studio Pro. */
export const PRO_REQUIRED = 'pro_required';
/** Status/503 reason when the server runs with APP_AI=0. */
export const AI_DISABLED = 'ai_disabled';
export const AI_BUSY_MESSAGE = 'Assistant is busy with another request. Try again in a moment.';

const STRUCTURED_CODES = new Set([
  NETWORK_OPT_IN_REQUIRED,
  AI_NOT_CONFIGURED,
  OLLAMA_UNAVAILABLE,
  AI_BUSY,
  PRO_REQUIRED,
]);

// Known bare error codes and the copy to show for them.
const FRIENDLY_CODES = {
  action_not_found: 'That request expired or was already handled. Ask Assistant again.',
  write_cap_reached: 'Assistant has reached its limit for changes in this chat. Start a new chat to continue.',
  invalid_body: 'That request was not valid. Check what you entered and try again.',
  conversation_busy: 'Assistant is still answering in this chat. Wait for it to finish, then ask again.',
};

/** The machine code of an error body: `code` in the envelope, else a bare code in `error` (older bodies). */
export function codeOf(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.code === 'string' && body.code) return body.code;
  return typeof body.error === 'string' && body.error ? body.error : null;
}

/** Human-readable text for an error response body, with a fallback for unknown shapes. */
export function errorText(body, fallback) {
  if (body && typeof body === 'object') {
    const code = codeOf(body);
    if (code === AI_BUSY) return AI_BUSY_MESSAGE;
    if (typeof body.message === 'string' && body.message) return body.message;
    if (code !== null && Object.hasOwn(FRIENDLY_CODES, code)) {
      return FRIENDLY_CODES[code];
    }
  }
  return fallback;
}

/** `<sentence> <action>`; the action is left out when the sentence already ends with it (case-insensitive). */
export function withAction(sentence, action) {
  const base = typeof sentence === 'string' ? sentence.trim() : '';
  const next = typeof action === 'string' ? action.trim() : '';
  if (next === '' || base.toLowerCase().endsWith(next.toLowerCase())) return base;
  return base === '' ? next : `${base} ${next}`;
}

/** Error carrying `status`, plus `code`/`feature` for the structured bodies above. Its message ends with the body's next action. */
export function buildApiError(response, body) {
  const action = body && typeof body === 'object' && typeof body.action === 'string' ? body.action : null;
  const err = new Error(withAction(errorText(body, response.statusText), action));
  err.status = response.status;
  const code = codeOf(body);
  if (code !== null && STRUCTURED_CODES.has(code)) err.code = code;
  if (body && typeof body.action === 'string') err.action = body.action;
  if (body && typeof body.requestId === 'string') err.requestId = body.requestId;
  if (body && typeof body.feature === 'string') err.feature = body.feature;
  if (body && typeof body.hint === 'string') err.hint = body.hint;
  if (body && typeof body.reason === 'string') err.reason = body.reason;
  return err;
}

export const isNetworkOptInError = (err) => err?.code === NETWORK_OPT_IN_REQUIRED;

/** True when Assistant cannot run because AI is off, has no model, or Ollama is unreachable. */
export const isAiUnavailableError = (err) =>
  err?.code === AI_NOT_CONFIGURED || err?.code === OLLAMA_UNAVAILABLE;

/** True when the server refused because the capability needs Local App Studio Pro. */
export const isProRequiredError = (err) => err?.code === PRO_REQUIRED;
