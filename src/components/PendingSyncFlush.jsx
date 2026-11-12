import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import { flushPendingSync, getPendingKeys } from '../utils/syncMode';

/** Renders nothing. On app load, retries saving any settings whose save did not complete. */
export default function PendingSyncFlush() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const toasted = useRef(false);
  useEffect(() => {
    if (getPendingKeys().length > 0) {
      flushPendingSync(queryClient)
        .then((result) => {
          if (result.failed > 0 && !toasted.current) {
            toasted.current = true;
            toast({
              message: "Some settings haven't been saved yet. Local App Studio will retry.",
              type: 'error',
            });
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);
  return null;
}
