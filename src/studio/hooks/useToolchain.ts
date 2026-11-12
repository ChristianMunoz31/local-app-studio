// Build tool check for the Build tab and Settings (GET /api/studio/build/toolchain).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolchainReport } from '../buildTypes';
import { getToolchain } from '../services/buildApi';

export interface UseToolchain {
  report: ToolchainReport | null;
  loading: boolean;
  error: string | null;
  /** Checks again, skipping the server's short cache. */
  refresh(): Promise<void>;
}

const FAILED = 'Could not check the build tools. Try again.';
const messageOf = (err: unknown): string => (err instanceof Error && err.message ? err.message : FAILED);

export function useToolchain(): UseToolchain {
  const [report, setReport] = useState<ToolchainReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);

  /** Runs one check; a newer check makes an older answer stale. */
  const check = useCallback((fresh: boolean): Promise<void> => {
    seq.current += 1;
    const mine = seq.current;
    return getToolchain(fresh).then(
      (next) => {
        if (!alive.current || mine !== seq.current) return;
        setReport(next);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!alive.current || mine !== seq.current) return;
        setError(messageOf(err));
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    void check(false);
    return () => {
      alive.current = false;
    };
  }, [check]);

  const refresh = useCallback((): Promise<void> => {
    setLoading(true);
    setError(null);
    return check(true);
  }, [check]);
  return { report, loading, error, refresh };
}
