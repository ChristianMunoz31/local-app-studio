import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import { recordOf, seedRecords } from '../../components/__tests__/featureFixtures';
import { featuresApi } from '../../services/studioApi';
import type { FeatureRecord } from '../../types';
import { libraryOf, useFeatures } from '../useFeatures';

afterEach(() => vi.restoreAllMocks());

describe('libraryOf', () => {
  it('keeps the records that validate and drops broken ones', () => {
    const records = [recordOf(SEED_FEATURES[0]), recordOf(SEED_FEATURES[1], { ok: false }), recordOf({ ...SEED_FEATURES[1], id: 'gone' }, { fragment: null })];
    expect([...libraryOf(records).keys()]).toEqual([SEED_FEATURES[0].id]);
  });
});

describe('useFeatures', () => {
  it('loads the library and builds the expansion map', async () => {
    vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
    const { result } = renderHook(() => useFeatures());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.features).toHaveLength(SEED_FEATURES.length);
    expect(result.current.library.has('kpi_row')).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('keeps an empty list and reports a failed load, then recovers on reload', async () => {
    const list = vi.spyOn(featuresApi, 'list').mockRejectedValueOnce(new Error('The helper is not reachable.')).mockResolvedValue(seedRecords());
    const { result } = renderHook(() => useFeatures());
    await waitFor(() => expect(result.current.error).toBe('The helper is not reachable.'));
    expect(result.current.features).toEqual([]);
    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
    expect(result.current.features.length).toBeGreaterThan(0);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores an answer that arrives after unmount', async () => {
    let resolve: (v: FeatureRecord[]) => void = () => {};
    vi.spyOn(featuresApi, 'list').mockReturnValue(
      new Promise<FeatureRecord[]>((r) => {
        resolve = r;
      }),
    );
    const { result, unmount } = renderHook(() => useFeatures());
    unmount();
    resolve(seedRecords());
    await Promise.resolve();
    expect(result.current.features).toEqual([]);
  });
});
