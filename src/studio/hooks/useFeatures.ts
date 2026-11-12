import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureDefinition, FeatureLibrary } from '@/catalog/features';
import { featuresApi } from '../services/studioApi';
import type { FeatureRecord } from '../types';

export interface UseFeatures {
  features: FeatureRecord[];
  /** The records that still validate, by id: what expansion works from. */
  library: FeatureLibrary;
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
}

const messageOf = (err: unknown): string => (err instanceof Error && err.message ? err.message : 'Could not load your features. Try again.');

/** The library as expansion needs it: records that are ok and have a fragment. */
export function libraryOf(records: readonly FeatureRecord[]): FeatureLibrary {
  const map = new Map<string, FeatureDefinition>();
  for (const r of records) {
    if (!r.ok || r.fragment === null) continue;
    map.set(r.id, {
      id: r.id,
      label: r.label,
      description: r.description,
      version: r.version,
      updatedAt: r.updatedAt,
      params: r.params,
      fragment: r.fragment,
      bindings: r.bindings,
    });
  }
  return map;
}

/** The feature library and a reload (same pattern as useApps). A failed load sets `error`; the list stays empty. */
export function useFeatures(): UseFeatures {
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const list = await featuresApi.list();
      if (!alive.current) return;
      setFeatures(list);
      setError(null);
    } catch (err) {
      if (alive.current) setError(messageOf(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    featuresApi.list().then(
      (list) => {
        if (!alive.current) return;
        setFeatures(list);
        setLoading(false);
      },
      (err: unknown) => {
        if (!alive.current) return;
        setError(messageOf(err));
        setLoading(false);
      },
    );
    return () => {
      alive.current = false;
    };
  }, []);

  const library = useMemo(() => libraryOf(features), [features]);
  return { features, library, loading, error, reload };
}
