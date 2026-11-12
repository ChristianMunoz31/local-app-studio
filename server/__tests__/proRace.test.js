// Pro can end after a route gate passed (a library caller used assertPro, or the license changed
// mid-request). The user must see the fixed Pro message, never a generic model error: the AI error
// helpers keep the Pro code, the feature and the fixed copy, and answer 403 with no-store.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));

import { aiErrorBody, classifyAiError, sendAiError } from '../ai/index.js';
import { MSG_PRO_REQUIRED, ProRequiredError } from '../pro.js';

describe('error helpers', () => {
  const err = new ProRequiredError('example_pro');

  it('classifyAiError keeps the Pro code, feature and fixed message', () => {
    expect(classifyAiError(err)).toEqual({ code: 'pro_required', feature: 'example_pro', message: MSG_PRO_REQUIRED, retryMs: null, httpStatus: 403 });
  });

  it('aiErrorBody and sendAiError answer 403 pro_required with no-store', () => {
    expect(aiErrorBody(err)).toEqual({ error: 'pro_required', feature: 'example_pro', message: MSG_PRO_REQUIRED });
    const res = { req: { originalUrl: '/api/x' }, set: vi.fn(), status: vi.fn(() => res), json: vi.fn(() => res) };
    expect(sendAiError(res, err)).toBe(res);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'pro_required', feature: 'example_pro', error: MSG_PRO_REQUIRED, message: MSG_PRO_REQUIRED }),
    );
  });
});
