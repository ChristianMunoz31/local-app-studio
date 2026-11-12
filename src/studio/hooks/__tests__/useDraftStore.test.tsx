// P-03: the shared draft store hook (Data and Design): writes while dirty, clears when clean, offers a stored draft back.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, readDraft, writeDraft } from '../../lib/draftStore';
import { useDraftStore } from '../useDraftStore';

const APP = 'app-x';

interface Props {
  dirty: boolean;
  saved?: boolean;
}

const mount = (initial: Props) =>
  renderHook(
    ({ dirty, saved = false }: Props) =>
      useDraftStore({
        appId: APP,
        step: 'design',
        revision: 3,
        baseRevision: () => 3,
        dirty,
        isDirty: () => dirty,
        payload: () => ({ pageId: 'home', n: 1 }),
        isSaved: () => saved,
      }),
    { initialProps: initial },
  );

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  clearDraft(APP, 'design');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDraftStore (P-03)', () => {
  it('writes a dirty draft after a short wait and removes it once clean', () => {
    const view = mount({ dirty: true });
    expect(readDraft(APP, 'design')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(readDraft(APP, 'design')?.baseRevision).toBe(3);
    view.rerender({ dirty: false });
    expect(readDraft(APP, 'design')).toBeNull();
  });

  it('writes at once when the page goes inside the wait (a reload keeps the edit)', () => {
    mount({ dirty: true });
    expect(readDraft(APP, 'design')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(readDraft(APP, 'design')?.baseRevision).toBe(3);
  });

  it('offers a stored draft without applying it, and Discard clears it', () => {
    writeDraft(APP, 'design', 3, { pageId: 'home', n: 9 });
    const view = mount({ dirty: false });
    expect(view.result.current?.text).toMatch(/^You have unsaved changes on Design from /);
    expect(view.result.current?.payload).toEqual({ pageId: 'home', n: 9 });
    act(() => view.result.current?.discard());
    expect(view.result.current).toBeNull();
    expect(readDraft(APP, 'design')).toBeNull();
  });

  it('says a Design draft kept by a move is still here, once; a draft of an earlier visit keeps the old words (P17-22)', () => {
    const first = mount({ dirty: true });
    first.unmount();
    expect(readDraft(APP, 'design')).not.toBeNull();
    const back = mount({ dirty: false });
    expect(back.result.current?.text).toBe('Your unsaved changes on Design are still here.');
    expect(back.result.current?.payload).toEqual({ pageId: 'home', n: 1 });
    back.unmount();
    const again = mount({ dirty: false });
    expect(again.result.current?.text).toMatch(/^You have unsaved changes on Design from /);
  });

  it('Restore hands the payload out and closes the offer', () => {
    writeDraft(APP, 'design', 3, { pageId: 'home', n: 9 });
    const view = mount({ dirty: false });
    let taken: unknown = null;
    act(() => {
      taken = view.result.current?.take();
    });
    expect(taken).toEqual({ pageId: 'home', n: 9 });
    expect(view.result.current).toBeNull();
  });

  it('does not offer a stored draft that is what is saved already', () => {
    writeDraft(APP, 'design', 3, { pageId: 'home', n: 1 });
    const view = mount({ dirty: false, saved: true });
    expect(view.result.current).toBeNull();
    expect(readDraft(APP, 'design')).toBeNull();
  });

  it('writes new edits while an offer shows and replaces the offer (L2)', () => {
    writeDraft(APP, 'design', 3, { pageId: 'home', n: 9 });
    const view = mount({ dirty: true });
    expect(view.result.current).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(readDraft(APP, 'design')?.payload).toEqual({ pageId: 'home', n: 1 });
    expect(view.result.current).toBeNull();
  });

  it('keeps one draft per scope and leaves the draft of another scope alone (H2)', () => {
    writeDraft(APP, 'design', 3, { pageId: 'two', n: 5 }, 1000, 'two');
    const view = renderHook(() =>
      useDraftStore({
        appId: APP,
        step: 'design',
        scope: 'one',
        revision: 3,
        baseRevision: () => 3,
        dirty: false,
        isDirty: () => false,
        payload: () => ({ pageId: 'one' }),
        isSaved: () => true,
      }),
    );
    expect(view.result.current).toBeNull();
    expect(readDraft(APP, 'design', 'two')?.payload).toEqual({ pageId: 'two', n: 5 });
  });

  it('tells the offer which revision the stored draft was made from (H3)', () => {
    writeDraft(APP, 'design', 2, { pageId: 'home', n: 9 });
    const view = mount({ dirty: false });
    expect(view.result.current?.baseRevision).toBe(2);
  });
});
