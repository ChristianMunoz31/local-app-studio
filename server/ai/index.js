// The only AI module boundary. Code outside server/ai/ imports from this file only.
import { AI_REASONS, AiUnavailableError, AiBusyError, MSG_AI_OFF, isAiEnabled, sendAiError, aiErrorBody } from './gate.js';
import {
  getAiClient,
  describeAi,
  getAiStatus,
  listInstalledModels,
  invalidateAiHealth,
  isAiQueueFull,
  getAiSetupSnapshot,
  getPullTarget,
  pullModel,
  PullError,
  __resetAiForTests,
} from './registry.js';
import { getAiSettings, updateAiSettings, validateEndpointUrl, isValidModelName } from './settings.js';
import { classifyLLMError } from './llmErrors.js';
import { ProRequiredError } from '../pro.js';

export { AI_REASONS, AiUnavailableError, AiBusyError, MSG_AI_OFF, isAiEnabled, sendAiError, aiErrorBody };
export { getAiClient, describeAi, getAiStatus, listInstalledModels, invalidateAiHealth, isAiQueueFull, __resetAiForTests };
export { getAiSetupSnapshot, getPullTarget, pullModel, PullError };
export { PULLABLE_MODELS, recommendModels, detectOllamaInstall } from './recommend.js';
export { getAiSettings, updateAiSettings, validateEndpointUrl, isValidModelName };
export { sanitizeModelText, fixDollarAmounts } from './textSanitize.js';
export { createStreamSanitizer } from './streamSanitizer.js';
export { contextBudgetChars, estimateTokens } from './contextFit.js';
export { openSse } from './sse.js';

/**
 * User-safe classification of a failed model call: { code, message, retryMs }.
 * AI availability errors keep their own code and message; everything else gets a fixed
 * friendly message (never the provider's text).
 * @param {unknown} err
 * `reason` is set for AI availability errors (see AI_REASONS).
 * @returns {{ code: string, message: string, retryMs: number | null, httpStatus: number, reason?: string, feature?: string }}
 */
export function classifyAiError(err) {
  if (err instanceof ProRequiredError) {
    return { code: err.code, feature: err.feature, message: err.publicMessage, retryMs: null, httpStatus: err.httpStatus };
  }
  if (err instanceof AiUnavailableError) {
    return { code: err.code, reason: err.reason, message: err.publicMessage, retryMs: null, httpStatus: err.httpStatus };
  }
  if (err instanceof AiBusyError) {
    return { code: err.code, message: err.publicMessage, retryMs: null, httpStatus: err.httpStatus };
  }
  if (err instanceof CloudScopeError) {
    if (err.code === 'cloud_disabled') return { code: err.code, message: MSG_CLOUD_DISABLED, retryMs: null, httpStatus: 403 };
    return { code: err.code, message: withheldMessage(err.categories), retryMs: null, httpStatus: 403 };
  }
  const c = classifyLLMError(err);
  const httpStatus = c.isRateLimit ? 429 : c.scope === 'timeout' ? 504 : 502;
  return { code: c.scope, message: c.friendly, retryMs: c.retryMs, httpStatus };
}

/**
 * Express middleware: resolve the AI client for `purpose` into res.locals.ai, or answer
 * 503 (JSON, before any SSE headers) when AI cannot run.
 * With `enabledOnly`, only isAiEnabled() is checked: no Ollama probe, no client, no queue
 * slot (for routes that run no model, such as confirming a proposed Assistant change).
 * @param {'chat'|'tools'} purpose
 * @param {{ model?: (req: import('express').Request) => string | undefined, enabledOnly?: boolean }} [opts]
 * @returns {import('express').RequestHandler}
 */
export function requireAi(purpose, { model, enabledOnly = false } = {}) {
  return async (req, res, next) => {
    try {
      if (enabledOnly) {
        if (!isAiEnabled()) throw new AiUnavailableError('ai_not_configured', MSG_AI_OFF, undefined, AI_REASONS.disabled);
        return next();
      }
      // A full queue answers 429 now, before any SSE headers, rather than mid-stream.
      if (isAiQueueFull()) throw new AiBusyError();
      res.locals.ai = await getAiClient({ purpose, model: model ? model(req) : undefined });
      return next();
    } catch (err) {
      if (sendAiError(res, err)) return undefined;
      return next(err);
    }
  };
}

// Cloud AI safeguards (append-only exports).
import { CloudScopeError, MSG_CLOUD_DISABLED, withheldMessage } from './privacy.js';
export {
  CLOUD_CATEGORY_DEFAULTS,
  CLOUD_CATEGORY_IDS,
  CloudScopeError,
  MSG_CLOUD_DISABLED,
  aiAuditMeta,
  applyPagePolicy,
  cloudHistoryUserRows,
  createAiPolicy,
  sanitizeCloudCategories,
  withheldMessage,
  withheldToolResult,
} from './privacy.js';
export {
  CLOUD_CONSENT_ACKS,
  CLOUD_CONSENT_VERSION,
  clearCloudConsent,
  getCloudCategories,
  getCloudConsent,
  getCloudHintState,
  isConsentCurrent,
  recordCloudConsent,
  recordCloudHint,
  updateCloudCategories,
} from './consent.js';
export { NO_CLOUD_HINT, getCloudHint } from './cloudHint.js';
export { validateCloudBaseUrl } from './settings.js';
export { isCloudStillAllowed, isCloudTargetCurrent } from './registry.js';
