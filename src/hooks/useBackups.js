import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBackup,
  dismissAutoReminder,
  getBackupStatus,
  listBackups,
  setAutoBackup,
  setCopyTo,
  updateBackupSettings,
} from '../services/backupService';

export const BACKUPS_KEY = ['backups', 'list'];
export const BACKUP_STATUS_KEY = ['backups', 'status'];
/** Refetch pace while the second copy runs (it starts after the answer of Back up now or Save). */
export const COPY_POLL_MS = 2000;
// A copy that failed before still says "failing" until the new attempt ends, so keep polling for a short
// window after a change even when the status does not say "pending".
const COPY_WATCH_MS = 10000;
// A copy that stays pending is polled less and less often, then not at all: the server gives one job
// 10 minutes (COPY_TIMEOUT_MS in server/backup/secondCopy.js), plus a margin for the status to catch up.
export const COPY_POLL_SLOW_MS = 10000;
export const COPY_POLL_SLOWEST_MS = 30000;
export const COPY_POLL_FAST_FOR_MS = 30 * 1000;
export const COPY_POLL_SLOW_FOR_MS = 2 * 60 * 1000;
export const COPY_PENDING_LIMIT_MS = 10 * 60 * 1000 + 60 * 1000;

/** Poll pace after a copy has been pending for `waited` ms, or false once the limit has passed. */
function pendingPace(waited) {
  if (waited > COPY_PENDING_LIMIT_MS) return false;
  if (waited < COPY_POLL_FAST_FOR_MS) return COPY_POLL_MS;
  return waited < COPY_POLL_SLOW_FOR_MS ? COPY_POLL_SLOW_MS : COPY_POLL_SLOWEST_MS;
}

/**
 * Status with the switch set to `enabled`. A scheduler that was paused on this computer stays paused;
 * the background refetch corrects anything this cannot know. The weekly reminder is the server's call.
 */
function withSwitch(status, enabled) {
  const paused = status?.autoSwitch !== false && status?.autoEnabled === false;
  return {
    ...status,
    autoSwitch: enabled,
    autoEnabled: enabled && !paused,
    autoOffReminder: false,
  };
}

/** Backup list, status and settings, plus "back up now", "save settings" and the automatic backups switch. */
export function useBackups() {
  const queryClient = useQueryClient();
  const watchUntil = useRef(0);
  // When "pending" was first seen in this run; cleared when it ends or the user acts again.
  const pendingSince = useRef(null);
  const watch = () => {
    watchUntil.current = Date.now() + COPY_WATCH_MS;
    pendingSince.current = null;
  };
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: BACKUPS_KEY }),
      queryClient.invalidateQueries({ queryKey: BACKUP_STATUS_KEY }),
    ]);

  const query = useQuery({
    queryKey: BACKUPS_KEY,
    queryFn: ({ signal }) => listBackups({ signal }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const copy = q.state.data?.secondCopy;
      if (!copy?.enabled) return false;
      if (copy.health === 'pending') {
        const now = Date.now();
        if (pendingSince.current === null) pendingSince.current = now;
        return pendingPace(now - pendingSince.current);
      }
      pendingSince.current = null;
      return Date.now() < watchUntil.current ? COPY_POLL_MS : false;
    },
  });
  const backUp = useMutation({
    mutationFn: () => createBackup(),
    onSettled: () => {
      watch();
      return refresh();
    },
  });
  const copyTo = useMutation({
    mutationFn: (folder) => setCopyTo(folder),
    onSettled: () => {
      watch();
      return refresh();
    },
  });
  const save = useMutation({
    mutationFn: (settings) => updateBackupSettings(settings),
    onSettled: refresh,
  });
  // The switch answers with the new state: show it at once (so the control stops being busy as soon as
  // the PUT succeeds), then refetch in the background to pick up the server's own view.
  const auto = useMutation({
    mutationFn: (enabled) => setAutoBackup(enabled),
    onSuccess: (_saved, enabled) => {
      queryClient.setQueryData(BACKUPS_KEY, (old) => (old ? { ...old, status: withSwitch(old.status, enabled) } : old));
      queryClient.setQueryData(BACKUP_STATUS_KEY, (old) => (old ? withSwitch(old, enabled) : old));
    },
    onSettled: () => {
      void refresh();
    },
  });

  return {
    data: query.data ?? null,
    isLoading: query.isPending,
    error: query.error ?? null,
    refetch: query.refetch,
    isRefetching: query.isFetching,
    backUpNow: backUp.mutateAsync,
    isBackingUp: backUp.isPending,
    saveSettings: save.mutateAsync,
    isSaving: save.isPending,
    setAuto: auto.mutateAsync,
    isSettingAuto: auto.isPending,
    setCopyTo: copyTo.mutateAsync,
    isSettingCopyTo: copyTo.isPending,
  };
}

/** Light status poll for the Home notice. */
export function useBackupStatus() {
  const query = useQuery({
    queryKey: BACKUP_STATUS_KEY,
    queryFn: ({ signal }) => getBackupStatus({ signal }),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return { status: query.data ?? null, isLoading: query.isPending };
}

/** Remembers, on the server, that the "automatic backups are off" reminder was dismissed. */
export function useDismissAutoReminder() {
  const queryClient = useQueryClient();
  // Hide the reminder at once (the query data is the single source of truth); put it back if saving fails.
  const dismiss = useMutation({
    mutationFn: () => dismissAutoReminder(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: BACKUP_STATUS_KEY });
      const previous = queryClient.getQueryData(BACKUP_STATUS_KEY);
      queryClient.setQueryData(BACKUP_STATUS_KEY, (old) => (old ? { ...old, autoOffReminder: false } : old));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(BACKUP_STATUS_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: BACKUP_STATUS_KEY }),
  });
  return dismiss.mutate;
}
