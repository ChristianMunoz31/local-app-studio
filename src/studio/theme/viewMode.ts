// The Light / Dark "Show as" choice of Preview and Design: a view choice only, kept per app in this browser (localStorage),
// never in the spec. No stored choice reads as the theme's own mode, else light.
import { useCallback, useState } from 'react';
import { lsKey } from '@/utils/storageKeys.js';
import type { Theme } from '@local-app-studio/runtime/spec/schema.ts';
import { defaultMode } from '@local-app-studio/runtime/theme/resolve.ts';
import { sanitizeTheme } from '@local-app-studio/runtime/theme/sanitize.ts';
import type { ThemeMode } from '@local-app-studio/runtime/theme/ids.ts';

const keyFor = (appId: string): string => lsKey(`studio.viewMode.${appId}`);

export function readViewMode(appId: string): ThemeMode | null {
  try {
    const raw = window.localStorage.getItem(keyFor(appId));
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

export function writeViewMode(appId: string, mode: ThemeMode): void {
  try {
    window.localStorage.setItem(keyFor(appId), mode);
  } catch {
    // Storage full or blocked: the choice is lost on reload, nothing else.
  }
}

/** The mode to show (the stored choice, else the theme's own mode, else light) and a setter that stores the choice. */
export function useViewMode(appId: string, theme: Theme): { mode: ThemeMode; setMode(mode: ThemeMode): void } {
  const [stored, setStored] = useState<{ appId: string; mode: ThemeMode | null }>(() => ({ appId, mode: readViewMode(appId) }));
  const current = stored.appId === appId ? stored.mode : readViewMode(appId);
  const setMode = useCallback(
    (mode: ThemeMode): void => {
      writeViewMode(appId, mode);
      setStored({ appId, mode });
    },
    [appId],
  );
  return { mode: current ?? defaultMode(sanitizeTheme(theme)), setMode };
}
