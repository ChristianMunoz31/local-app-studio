import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Theme } from '@local-app-studio/runtime/spec/schema.ts';
import { readViewMode, useViewMode } from '../viewMode';

const classic: Theme = { preset: 'aurora', radius: 'md' };
const midnight: Theme = { preset: 'aurora', radius: 'md', id: 'midnight' };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('useViewMode', () => {
  it('defaults to the theme mode, else light', () => {
    expect(renderHook(() => useViewMode('a', classic)).result.current.mode).toBe('light');
    expect(renderHook(() => useViewMode('a', midnight)).result.current.mode).toBe('dark');
  });

  it('stores the choice per app and leaves another app alone', () => {
    const a = renderHook(() => useViewMode('a', classic));
    act(() => a.result.current.setMode('dark'));
    expect(a.result.current.mode).toBe('dark');
    expect(window.localStorage.getItem('app.studio.viewMode.a')).toBe('dark');
    expect(readViewMode('a')).toBe('dark');
    expect(readViewMode('b')).toBeNull();
    expect(renderHook(() => useViewMode('b', classic)).result.current.mode).toBe('light');
    expect(renderHook(() => useViewMode('a', classic)).result.current.mode).toBe('dark');
  });

  it('ignores a broken stored value', () => {
    window.localStorage.setItem('app.studio.viewMode.a', 'purple');
    expect(renderHook(() => useViewMode('a', classic)).result.current.mode).toBe('light');
  });
});
