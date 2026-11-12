import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_COPY } from '@/errors/errorCopy.js';
import { StudioApiError } from '../../services/studioApi';
import { errorLine, errorWords, hasErrorRow } from '../errorWords';

const NEVER_SHOWN = /\b(spec|schema|json|route|revision)\b/i;

describe('errorWords: every code has words', () => {
  it('has a table with rows', () => {
    expect(ERROR_CODES.length).toBeGreaterThan(100);
  });

  it.each(ERROR_CODES)('%s gives a sentence and an action', (code) => {
    const row = ERROR_COPY[code];
    expect(hasErrorRow(code)).toBe(true);
    const words = errorWords({ code });
    expect(words.code).toBe(code);
    expect(words.sentence.trim()).not.toBe('');
    expect(words.action).toBe(row.action);
    expect(words.action.trim()).not.toBe('');
    // A row with no sentence of its own is an `owner` row: the call site supplies the sentence, the generic one is the default.
    if (row.sentence === undefined) expect(typeof row.owner).toBe('string');
    else expect(words.sentence).toBe(row.sentence);
  });

  it.each(ERROR_CODES)('%s uses no word from the never-shown list', (code) => {
    const { sentence, action } = errorWords({ code });
    expect(`${sentence} ${action}`).not.toMatch(NEVER_SHOWN);
  });

  it('a code without a row is not a known code', () => {
    expect(hasErrorRow('made_up_code')).toBe(false);
    expect(errorWords({ code: 'made_up_code' }).code).toBe('server_error');
  });
});

describe('errorWords: inputs', () => {
  it('uses an envelope as the server sent it', () => {
    const words = errorWords({ error: 'That app does not exist.', code: 'app_not_found', action: 'Go to Apps.', requestId: 'abc123', message: 'That app does not exist.' });
    expect(words).toEqual({ code: 'app_not_found', sentence: 'That app does not exist.', action: 'Go to Apps.', requestId: 'abc123' });
  });

  it('keeps the message of an older body that carried the code in `error`', () => {
    const words = errorWords({ error: 'revision_conflict', message: 'Someone changed this app first.' });
    expect(words.code).toBe('revision_conflict');
    expect(words.sentence).toBe('Someone changed this app first.');
    expect(words.action).toBe(ERROR_COPY.revision_conflict.action);
  });

  it('reads a StudioApiError with and without an action', () => {
    const plain = new StudioApiError('Another build is running.', 409, 'build_busy');
    expect(errorWords(plain)).toMatchObject({ code: 'build_busy', sentence: 'Another build is running.', action: ERROR_COPY.build_busy.action });
    const sent = new StudioApiError('Another build is running.', 409, 'build_busy');
    sent.action = 'Wait.';
    sent.requestId = 'r1';
    expect(errorWords(sent)).toEqual({ code: 'build_busy', sentence: 'Another build is running.', action: 'Wait.', requestId: 'r1' });
  });

  it('maps a failed fetch to network_unreachable', () => {
    expect(errorWords(new TypeError('Failed to fetch')).code).toBe('network_unreachable');
    expect(errorWords(new TypeError('NetworkError when attempting to fetch resource.')).code).toBe('network_unreachable');
  });

  it('maps a failed lazy import to chunk_load_failed', () => {
    expect(errorWords(new Error('Failed to fetch dynamically imported module: /assets/DesignTab.js')).code).toBe('chunk_load_failed');
    const named = new Error('x');
    named.name = 'ChunkLoadError';
    expect(errorWords(named).code).toBe('chunk_load_failed');
  });

  it('calls an unknown thrown value a render failure only for a boundary', () => {
    expect(errorWords(new Error('boom')).code).toBe('server_error');
    expect(errorWords(new Error('boom'), { boundary: true }).code).toBe('render_failed');
    expect(errorWords(undefined, { boundary: true }).code).toBe('render_failed');
    expect(errorWords('text').code).toBe('server_error');
  });

  it('never shows the raw message of an unknown error', () => {
    expect(errorWords(new Error('Cannot read properties of undefined'), { boundary: true }).sentence).not.toMatch(/Cannot read/);
  });
});

describe('errorLine', () => {
  it('joins sentence and action', () => {
    expect(errorLine({ code: 'build_not_found' })).toBe(`${ERROR_COPY.build_not_found.sentence} ${ERROR_COPY.build_not_found.action}`);
  });

  it('leaves the action out when the sentence already ends with it', () => {
    expect(errorLine({ error: 'It broke. Try again.', code: 'server_error', action: 'try again.' })).toBe('It broke. Try again.');
  });
});

describe('a StudioApiError message that already carries its action', () => {
  it('splits the action off so a screen shows it once', () => {
    const err = Object.assign(new Error('Could not save the app. Reload and try again.'), { code: 'server_error', action: 'Reload and try again.' });
    expect(errorWords(err)).toMatchObject({ sentence: 'Could not save the app.', action: 'Reload and try again.' });
    expect(errorLine(err)).toBe('Could not save the app. Reload and try again.');
  });
});
