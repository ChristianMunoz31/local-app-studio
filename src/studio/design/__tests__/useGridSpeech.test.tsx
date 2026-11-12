import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID_SPEAK_DELAY_MS, useGridSpeech } from '../useGridSpeech';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useGridSpeech', () => {
  it('speaks only the last of three quick steps, 250 ms after the last call', () => {
    const speak = vi.fn();
    const { result } = renderHook(() => useGridSpeech(speak));
    act(() => result.current.step('one'));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => result.current.step('two'));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => result.current.step('three'));
    act(() => {
      vi.advanceTimersByTime(GRID_SPEAK_DELAY_MS - 1);
    });
    expect(speak).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('three');
  });

  it('speaks a refusal through the alert, not through speak, and cancels a pending step', () => {
    const speak = vi.fn();
    const { result } = renderHook(() => useGridSpeech(speak));
    act(() => result.current.step('moved'));
    act(() => result.current.refusal('Cannot move right: Heading is in column 5.'));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(speak).not.toHaveBeenCalled();
    expect(result.current.alert).toEqual({ text: 'Cannot move right: Heading is in column 5.', n: 1 });
  });

  it('gives the same refusal twice a different n, so the alert line is a new node', () => {
    const speak = vi.fn();
    function Host() {
      const speech = useGridSpeech(speak);
      return (
        <>
          <button type="button" onClick={() => speech.refusal('Column 1 is the first column.')}>
            Refuse
          </button>
          {speech.alert !== null && (
            <p key={speech.alert.n} role="alert">
              {speech.alert.text}
            </p>
          )}
        </>
      );
    }
    render(<Host />);
    act(() => screen.getByRole('button', { name: 'Refuse' }).click());
    const first = screen.getByRole('alert');
    act(() => screen.getByRole('button', { name: 'Refuse' }).click());
    const second = screen.getByRole('alert');
    expect(second.textContent).toBe(first.textContent);
    expect(second).not.toBe(first);
  });

  it('cancel drops a pending step', () => {
    const speak = vi.fn();
    const { result } = renderHook(() => useGridSpeech(speak));
    act(() => result.current.step('moved'));
    act(() => result.current.cancel());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(speak).not.toHaveBeenCalled();
  });

  it('clears the timer on unmount', () => {
    const speak = vi.fn();
    const { result, unmount } = renderHook(() => useGridSpeech(speak));
    act(() => result.current.step('moved'));
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(speak).not.toHaveBeenCalled();
  });

  it('speaks through the latest speak callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ speak }) => useGridSpeech(speak), { initialProps: { speak: first } });
    act(() => result.current.step('moved'));
    rerender({ speak: second });
    act(() => {
      vi.advanceTimersByTime(GRID_SPEAK_DELAY_MS);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('moved');
  });
});
