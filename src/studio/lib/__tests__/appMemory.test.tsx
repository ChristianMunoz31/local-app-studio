// Browser memory kept per app: prompt words, helper used, made-from-words marker, start words, drafts (P-02, P-03, P-08, P-16).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFLICT_MESSAGE } from '../../types';
import {
  forgetApp,
  markFresh,
  markHelperUsed,
  readFresh,
  readHelperUsed,
  readPrompt,
  readRemovedApp,
  readStartWords,
  removableEmptyApp,
  removedAppNotice,
  removedAppState,
  writePrompt,
  writeStartWords,
} from '../appMemory';
import { draftNotice, readDraft, writeDraft } from '../draftStore';
import { markProgress, readProgress } from '../progress';

const A = 'app-a';
const B = 'app-b';

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('appMemory', () => {
  it('keeps the prompt words per app and clears them when emptied (P-02)', () => {
    writePrompt(A, 'A roster');
    writePrompt(B, 'A garden log');
    expect(readPrompt(A)).toBe('A roster');
    expect(readPrompt(B)).toBe('A garden log');
    writePrompt(A, '   ');
    expect(readPrompt(A)).toBe('');
    expect(readPrompt(B)).toBe('A garden log');
  });

  it('remembers a helper design was used, per app (P-16)', () => {
    expect(readHelperUsed(A)).toBe(false);
    markHelperUsed(A);
    expect(readHelperUsed(A)).toBe(true);
    expect(readHelperUsed(B)).toBe(false);
  });

  it('removes only an untouched starter made by Make my app, at the revision it had on creation (P-08)', () => {
    markFresh(A, 2);
    expect(readFresh(A)).toBe(2);
    expect(removableEmptyApp(A, 2, true)).toBe(true);
    expect(removableEmptyApp(A, 3, true)).toBe(false);
    expect(removableEmptyApp(A, 2, false)).toBe(false);
    expect(removableEmptyApp(B, 2, true)).toBe(false);
  });

  it('keeps the start words apart from any app, and says what was removed once (P-08)', () => {
    writeStartWords('A roster');
    expect(readStartWords()).toBe('A roster');
    writeStartWords('');
    expect(readStartWords()).toBe('');
    expect(readRemovedApp(removedAppState('Crew Roster'))).toBe('Crew Roster');
    expect(readRemovedApp(null)).toBeNull();
    expect(readRemovedApp({ removedApp: 3 })).toBeNull();
    expect(removedAppNotice('Crew Roster')).toBe('Removed the empty app Crew Roster. Your words are back in the box.');
  });

  it('forgets everything about one app and nothing about another', () => {
    for (const id of [A, B]) {
      writePrompt(id, 'words');
      markHelperUsed(id);
      markFresh(id, 1);
      markProgress(id, 'preview', 1);
      writeDraft(id, 'data', 1, [{ id: 't' }]);
      writeDraft(id, 'design', 1, { pageId: 'p' });
    }
    forgetApp(A);
    expect(readPrompt(A)).toBe('');
    expect(readHelperUsed(A)).toBe(false);
    expect(readFresh(A)).toBeNull();
    expect(readProgress(A)).toEqual({});
    expect(readDraft(A, 'data')).toBeNull();
    expect(readDraft(A, 'design')).toBeNull();
    expect(readPrompt(B)).toBe('words');
    expect(readHelperUsed(B)).toBe(true);
    expect(readProgress(B)).toEqual({ previewed: 1 });
    expect(readDraft(B, 'data')).not.toBeNull();
  });
});

describe('draftStore', () => {
  it('stores a draft with its base revision and ignores a broken value (P-03)', () => {
    writeDraft(A, 'data', 3, [{ id: 't' }], 1000);
    expect(readDraft(A, 'data')).toEqual({ baseRevision: 3, savedAt: 1000, payload: [{ id: 't' }] });
    expect(readDraft(A, 'design')).toBeNull();
    window.localStorage.setItem('app.studio.draft.app-a.design', '{not json');
    expect(readDraft(A, 'design')).toBeNull();
    window.localStorage.setItem('app.studio.draft.app-a.design', JSON.stringify({ baseRevision: 'x' }));
    expect(readDraft(A, 'design')).toBeNull();
  });

  it('words the notice with the step and adds the check note only when the app moved on (P-03)', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    const stored = { baseRevision: 3, savedAt: now.getTime() - 5 * 60_000, payload: [] };
    const same = draftNotice('data', stored, 3, now);
    expect(same.startsWith('You have unsaved changes on Data from ')).toBe(true);
    expect(same).not.toContain('check it before you save');
    expect(draftNotice('design', stored, 4, now)).toContain('The app changed since, so check it before you save.');
  });
});

describe('conflict sentence (P-10)', () => {
  it('no longer tells the person to reload', () => {
    expect(CONFLICT_MESSAGE).not.toMatch(/reload/i);
    expect(CONFLICT_MESSAGE).toContain('your edits stay here until you leave');
  });
});
