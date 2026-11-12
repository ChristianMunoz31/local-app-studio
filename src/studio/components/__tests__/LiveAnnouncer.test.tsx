import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnnouncer } from '../../hooks/useAnnouncer';
import { LiveAnnouncer } from '../LiveAnnouncer';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Host() {
  const { text, n, announce } = useAnnouncer();
  return (
    <>
      <button type="button" onClick={() => announce('All changes saved.')}>
        Say
      </button>
      <button type="button" onClick={() => { announce('First.'); announce('Second.'); }}>
        Say twice
      </button>
      <LiveAnnouncer text={text} n={n} />
    </>
  );
}

describe('LiveAnnouncer', () => {
  it('is a polite status region', () => {
    render(<Host />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.className).toContain('sr-only');
  });

  it('clears first, then sets on the next frame, so a repeat is spoken again', () => {
    vi.useFakeTimers();
    render(<Host />);
    act(() => screen.getByRole('button', { name: 'Say' }).click());
    expect(screen.getByRole('status').textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole('status').textContent).toBe('All changes saved.');
    act(() => screen.getByRole('button', { name: 'Say' }).click());
    expect(screen.getByRole('status').textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole('status').textContent).toBe('All changes saved.');
  });

  it('keeps only the latest message when two come in one frame', () => {
    vi.useFakeTimers();
    render(<Host />);
    act(() => screen.getByRole('button', { name: 'Say twice' }).click());
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole('status').textContent).toBe('Second.');
  });

  it('announcing the same text twice changes n and gives a new inner node in the same region', () => {
    vi.useFakeTimers();
    render(<Host />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    act(() => screen.getByRole('button', { name: 'Say' }).click());
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const firstNode = region.querySelector('span');
    expect(firstNode?.textContent).toBe('All changes saved.');
    act(() => screen.getByRole('button', { name: 'Say' }).click());
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const secondNode = region.querySelector('span');
    expect(secondNode?.textContent).toBe('All changes saved.');
    expect(secondNode).not.toBe(firstNode);
    expect(screen.getByRole('status')).toBe(region);
  });

  it('counts every announce in n', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnnouncer());
    expect(result.current.n).toBe(0);
    act(() => result.current.announce('One.'));
    act(() => result.current.announce('One.'));
    expect(result.current.n).toBe(2);
  });

  it('renders as before without n', () => {
    render(<LiveAnnouncer text="Hello" />);
    expect(screen.getByRole('status').textContent).toBe('Hello');
  });
});
