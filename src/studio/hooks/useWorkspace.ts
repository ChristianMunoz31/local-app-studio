// Workspace context shared by the Describe, Data, Design and Preview tabs (DESIGN-phase3.md 7.4).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSpec, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { getApp, saveSpec, StudioApiError } from '../services/studioApi';
import { validateSpec } from '../lib/validate';
import { CONFLICT_MESSAGE } from '../types';
import type { AppRecord, SaveResult, WorkspaceValue } from '../types';

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside the app workspace.');
  return value;
}

export type LoaderState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; /** The server said this app does not exist (deleted here or elsewhere). */ notFound: boolean }
  | { kind: 'broken'; record: AppRecord }
  | { kind: 'ready'; value: WorkspaceValue };

export interface WorkspaceLoader {
  state: LoaderState;
  /** True while the Data or Design tab holds edits that are not saved. */
  dirty: boolean;
  /** Which tab holds edits that are not saved. */
  dirtyTabs: { data: boolean; design: boolean };
  /** True while a save is on its way to the server. */
  saving: boolean;
  /** Whether the last finished save reached the server and was kept; null before the first one. */
  lastSaveOk: boolean | null;
  clearDirty(): void;
  reload(): Promise<void>;
  /** Resolves when every save started so far has finished. */
  idle(): Promise<void>;
  /** How many saves have reached the server and been kept since this loader started. */
  savedCount(): number;
}

/** The server record checked again on the client; a failure turns it into a broken record (spec null, the issues, the raw value). */
function checkRecord(record: AppRecord): AppRecord {
  if (record.spec === null) return record;
  const result = validateSpec(record.spec);
  if (result.ok) return record;
  return { ...record, spec: null, issues: result.issues, raw: record.raw ?? record.spec };
}

const LOAD_FALLBACK = 'Could not load this app. Check that Local App Studio is still running, then try again.';
const SAVE_FALLBACK = 'Could not save. Your changes are still here. Try again.';
const messageOf = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);

/** Loads one app and builds the workspace value (save, reload, dirty flags). */
export function useWorkspaceLoader(appId: string): WorkspaceLoader {
  const [record, setRecord] = useState<AppRecord | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // The app the error belongs to: an error of the previous app is never shown for the next one while it loads.
  const [errorId, setErrorId] = useState<string | null>(null);
  const [dirtyTabs, setDirtyTabs] = useState<{ data: boolean; design: boolean }>({ data: false, design: false });
  const [inFlight, setInFlight] = useState(0);
  const [lastSaveOk, setLastSaveOk] = useState<boolean | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Saves run one at a time, in the order they were asked for. Each sends the revision its caller built it from (a step draft keeps
  // its own, moved on by its own saves), so a save made from an older spec is a conflict, never an overwrite.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const savedRef = useRef(0);
  const appIdRef = useRef(appId);
  useEffect(() => {
    appIdRef.current = appId;
  }, [appId]);

  const load = useCallback((id: string): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return getApp(id, controller.signal).then(
      (raw) => {
        if (controller.signal.aborted) return;
        const fetched = checkRecord(raw);
        setRecord(fetched);
        setLoadedId(id);
        setError(null);
        setNotFound(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(messageOf(err, LOAD_FALLBACK));
        setNotFound(err instanceof StudioApiError && err.code === 'app_not_found');
        setErrorId(id);
      },
    );
  }, []);

  useEffect(() => {
    void load(appId);
    return () => controllerRef.current?.abort();
  }, [appId, load]);

  const reload = useCallback(() => load(appId), [appId, load]);

  const save = useCallback(
    (next: AppSpec, opts: { baseRevision: number; clearWaiting?: boolean; waitingAt?: string | null }): Promise<SaveResult> => {
      const checked = validateSpec(next);
      if (!checked.ok) {
        return Promise.resolve({
          ok: false,
          code: 'invalid_spec',
          message: checked.issues[0]?.message ?? 'This app has a problem that must be fixed first.',
          issues: checked.issues,
        });
      }
      const { baseRevision, clearWaiting, waitingAt } = opts;
      const run = async (): Promise<SaveResult> => {
        // The person may have opened another app while this save waited or ran: the save still goes to its own app, but its
        // answer is not for the app on screen.
        const stale = (): boolean => appIdRef.current !== appId;
        let ok = false;
        try {
          const saved = checkRecord(await (clearWaiting === true ? saveSpec(appId, next, baseRevision, { clearWaiting: true, waitingAt }) : saveSpec(appId, next, baseRevision)));
          ok = true;
          if (!stale()) {
            savedRef.current += 1;
            setRecord(saved);
          }
          return { ok: true, record: saved };
        } catch (err) {
          if (err instanceof StudioApiError) {
            if (err.code === 'revision_conflict') {
              if (!stale()) await load(appId);
              return { ok: false, code: 'revision_conflict', message: CONFLICT_MESSAGE, issues: [] };
            }
            if (err.code === 'invalid_spec' || err.code === 'slug_taken') {
              const issues: SpecIssue[] = err.issues;
              return { ok: false, code: err.code, message: err.message, issues };
            }
          }
          return { ok: false, code: 'error', message: messageOf(err, SAVE_FALLBACK), issues: [] };
        } finally {
          if (!stale()) setLastSaveOk(ok);
          setInFlight((n) => Math.max(0, n - 1));
        }
      };
      setInFlight((n) => n + 1);
      const result = queueRef.current.then(run, run);
      queueRef.current = result;
      return result;
    },
    [appId, load],
  );

  const savedCount = useCallback((): number => savedRef.current, []);

  const idle = useCallback(async (): Promise<void> => {
    await queueRef.current;
  }, []);

  const setDirty = useCallback((tab: 'data' | 'design', dirty: boolean) => {
    setDirtyTabs((prev) => (prev[tab] === dirty ? prev : { ...prev, [tab]: dirty }));
  }, []);

  const clearDirty = useCallback(() => setDirtyTabs({ data: false, design: false }), []);

  const state = useMemo<LoaderState>(() => {
    if (record && loadedId === appId) {
      if (record.spec === null) return { kind: 'broken', record };
      return { kind: 'ready', value: { record, spec: record.spec, revision: record.revision, save, reload, setDirty } };
    }
    if (error && errorId === appId) return { kind: 'error', message: error, notFound };
    return { kind: 'loading' };
  }, [record, loadedId, appId, error, errorId, notFound, save, reload, setDirty]);

  return { state, dirty: dirtyTabs.data || dirtyTabs.design, dirtyTabs, saving: inFlight > 0, lastSaveOk, clearDirty, reload, idle, savedCount };
}
