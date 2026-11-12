import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../services/studioApi';
import type { AppRecord } from '../../types';
import { useApps } from '../useApps';

vi.mock('../../services/studioApi', () => ({
  listApps: vi.fn(async () => []),
  createApp: vi.fn(),
  saveSpec: vi.fn(),
}));

const blank = (theme: Record<string, unknown> = { preset: 'aurora', radius: 'md' }): AppRecord =>
  ({
    id: 'a1',
    name: 'Crew',
    slug: 'crew',
    revision: 1,
    spec: { specVersion: 1, app: { name: 'Crew' }, tables: [], pages: [], nav: [], theme },
    issues: [],
    createdAt: '',
    updatedAt: '',
  }) as unknown as AppRecord;

beforeEach(() => {
  vi.mocked(api.createApp).mockReset();
  vi.mocked(api.saveSpec).mockReset();
});

const setup = async () => {
  const hook = renderHook(() => useApps());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe('useApps.create', () => {
  it('saves the plain look on a blank app and returns the saved record', async () => {
    const created = blank();
    const saved = { ...blank({ preset: 'solid', radius: 'md' }), revision: 2 };
    vi.mocked(api.createApp).mockResolvedValue(created);
    vi.mocked(api.saveSpec).mockResolvedValue(saved);
    const { result } = await setup();
    let out: AppRecord | undefined;
    await act(async () => {
      out = await result.current.create('Crew');
    });
    expect(out).toBe(saved);
    const [id, spec, revision] = vi.mocked(api.saveSpec).mock.calls[0];
    expect(id).toBe('a1');
    expect(revision).toBe(1);
    expect((spec as { theme: unknown }).theme).toEqual({ preset: 'solid', radius: 'md' });
  });

  it('returns the created record when the second save fails', async () => {
    const created = blank();
    vi.mocked(api.createApp).mockResolvedValue(created);
    vi.mocked(api.saveSpec).mockRejectedValue(new Error('conflict'));
    const { result } = await setup();
    let out: AppRecord | undefined;
    await act(async () => {
      out = await result.current.create('Crew');
    });
    expect(out).toBe(created);
  });

  it('does not save again when the app already has a theme', async () => {
    const created = blank({ preset: 'x', radius: 'md', id: 'midnight' });
    vi.mocked(api.createApp).mockResolvedValue(created);
    const { result } = await setup();
    let out: AppRecord | undefined;
    await act(async () => {
      out = await result.current.create('Crew');
    });
    expect(out).toBe(created);
    expect(api.saveSpec).not.toHaveBeenCalled();
  });

  it('throws when the app cannot be created', async () => {
    vi.mocked(api.createApp).mockRejectedValue(new Error('nope'));
    const { result } = await setup();
    await expect(result.current.create('Crew')).rejects.toThrow('nope');
  });
});
