import { describe, expect, it } from 'vitest';
import { AI_BUSY_MESSAGE, buildApiError, codeOf, errorText, isNetworkOptInError } from '../apiError';

describe('errorText', () => {
  it('uses the human message for the structured codes', () => {
    expect(
      errorText({ error: 'ai_not_configured', message: 'AI is not configured. Add a provider in Settings.' }, 'x'),
    ).toBe('AI is not configured. Add a provider in Settings.');
    expect(errorText({ error: 'network_opt_in_required', message: 'Update checks is off.' }, 'x')).toBe('Update checks is off.');
  });

  it('shows body.message, maps known codes, and never renders a raw error string', () => {
    expect(errorText({ error: 'whatever', message: 'Friendly text.' }, 'fallback')).toBe('Friendly text.');
    expect(errorText({ error: 'action_not_found' }, 'fallback')).toMatch(/expired or was already handled/);
    expect(errorText({ error: 'Boom' }, 'fallback')).toBe('fallback');
    expect(errorText({ error: 'SQLITE_ERROR: no such table' }, 'fallback')).toBe('fallback');
    expect(errorText({}, 'fallback')).toBe('fallback');
    expect(errorText(null, 'fallback')).toBe('fallback');
  });
});

describe('buildApiError', () => {
  it('flags the opt-in error with code, feature and status', () => {
    const err = buildApiError(
      { status: 403, statusText: 'Forbidden' },
      { error: 'network_opt_in_required', feature: 'updates', message: 'Update checks is off.' },
    );
    expect(isNetworkOptInError(err)).toBe(true);
    expect(err).toMatchObject({ status: 403, feature: 'updates', message: 'Update checks is off.' });
  });

  it('ends the message with the body action, once', () => {
    const body = { error: 'Could not save.', code: 'save_failed', action: 'Try again.', message: 'Could not save.' };
    expect(buildApiError({ status: 500, statusText: 'x' }, body).message).toBe('Could not save. Try again.');
    expect(buildApiError({ status: 500, statusText: 'x' }, { ...body, message: 'Could not save. Try again.' }).message).toBe('Could not save. Try again.');
    expect(buildApiError({ status: 500, statusText: 'x' }, { ...body, message: 'Could not save. try AGAIN.' }).message).toBe('Could not save. try AGAIN.');
  });

  it('does not flag ordinary failures', () => {
    const err = buildApiError({ status: 503, statusText: 'Unavailable' }, {});
    expect(isNetworkOptInError(err)).toBe(false);
    expect(err.message).toBe('Unavailable');
  });
});

describe('the error envelope ({ error: <sentence>, code, action, requestId, message })', () => {
  it('still yields AI_BUSY_MESSAGE and err.code for ai_busy', () => {
    const body = { error: 'Assistant is busy.', code: 'ai_busy', action: 'Wait.', requestId: 'abcd1234abcd1234', message: 'Assistant is busy.' };
    expect(errorText({ error: body.error, code: body.code }, 'x')).toBe(AI_BUSY_MESSAGE);
    const err = buildApiError({ status: 429, statusText: 'Too Many' }, body);
    expect(err).toMatchObject({ status: 429, code: 'ai_busy', action: 'Wait.', requestId: 'abcd1234abcd1234' });
  });

  it('keeps the structured code, feature and reason from the envelope', () => {
    const err = buildApiError(
      { status: 503, statusText: 'x' },
      { error: 'The helper is off.', code: 'ai_not_configured', reason: 'ai_disabled', message: 'The helper is off.' },
    );
    expect(err).toMatchObject({ code: 'ai_not_configured', reason: 'ai_disabled' });
  });

  it('maps a bare friendly code through `code`, and never renders a sentence in `error` as a code', () => {
    expect(errorText({ error: 'Sentence.', code: 'action_not_found' }, 'fallback')).toMatch(/expired or was already handled/);
    expect(codeOf({ error: 'Something else.', code: 'invalid_body' })).toBe('invalid_body');
    expect(codeOf({ error: 'ai_busy' })).toBe('ai_busy');
    expect(codeOf(null)).toBeNull();
  });
});
