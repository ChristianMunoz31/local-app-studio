import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../services/studioApi';
import { forgetApp } from '../lib/appMemory';
import { withPlainTheme } from '@local-app-studio/runtime/theme/plain.ts';
import type { AppRecord, AppSummary } from '../types';

export interface UseApps {
  apps: AppSummary[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
  create(name: string): Promise<AppRecord>;
  duplicate(id: string, name?: string, withRecords?: boolean): Promise<api.DuplicatedApp>;
  remove(id: string): Promise<void>;
  importSpec(spec: unknown, sample?: unknown): Promise<AppRecord>;
}

const messageOf = (err: unknown): string => (err instanceof Error && err.message ? err.message : 'Could not reach Local App Studio. Check that it is still running, then try again.');

/** The Apps list and its actions. Failures of the actions are thrown to the caller; a failed load sets `error`. */
export function useApps(): UseApps {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const list = await api.listApps();
      if (!alive.current) return;
      setApps(list);
      setError(null);
    } catch (err) {
      if (alive.current) setError(messageOf(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    api.listApps().then(
      (list) => {
        if (!alive.current) return;
        setApps(list);
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

  /**
   * Makes a blank app on the plain look (a pearl sheet: Classic with no glow). The server makes the blank spec with the
   * glow, so the look is a second save; if it fails the app still works as Classic and the created record is returned. The record's revision changes with the save.
   */
  const create = useCallback(async (name: string): Promise<AppRecord> => {
    const record = await api.createApp(name);
    if (!record.spec || record.spec.theme.id !== undefined) return record;
    try {
      return await api.saveSpec(record.id, { ...record.spec, theme: withPlainTheme(record.spec.theme) }, record.revision);
    } catch {
      return record;
    }
  }, []);
  const duplicate = useCallback(
    async (id: string, name?: string, withRecords?: boolean) => {
      const record = await api.duplicateApp(id, name, withRecords);
      await reload();
      return record;
    },
    [reload],
  );
  const remove = useCallback(async (id: string) => {
    await api.deleteApp(id);
    forgetApp(id);
    if (alive.current) setApps((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const importSpec = useCallback(
    async (spec: unknown, sample?: unknown) => {
      const record = await api.importApp(spec, sample);
      await reload();
      return record;
    },
    [reload],
  );

  return { apps, loading, error, reload, create, duplicate, remove, importSpec };
}
