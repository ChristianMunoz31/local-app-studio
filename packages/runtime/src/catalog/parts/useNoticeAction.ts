import { useCallback, useState } from 'react';
import type { Action } from '../../../../../src/catalog/actions.ts';
import { useRunAction } from '../../../../../src/catalog/context.tsx';

/** Runs a declared action and keeps the message of a refusal ("Open a record first.") for the part to show. */
export function useNoticeAction(): { run: (action: Action, current?: { table: string; id: string }) => void; notice: string | null } {
  const runAction = useRunAction();
  const [notice, setNotice] = useState<string | null>(null);
  const run = useCallback(
    (action: Action, current?: { table: string; id: string }) => {
      const result = runAction(action, current);
      setNotice(result.ok ? null : result.message);
    },
    [runAction],
  );
  return { run, notice };
}
