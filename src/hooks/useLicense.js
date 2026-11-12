import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { licenseService } from '../services/licenseService';

export const LICENSE_QUERY_KEY = ['license'];

const LICENSE_QUERY_OPTIONS = {
  queryKey: LICENSE_QUERY_KEY,
  queryFn: licenseService.get,
  staleTime: 30_000,
  retry: false,
  refetchOnWindowFocus: true,
};

/** License status plus activate/deactivate/remove/dismissTrialNotice actions. Each returns the new status and updates the cache. */
export function useLicense() {
  const queryClient = useQueryClient();
  const query = useQuery(LICENSE_QUERY_OPTIONS);

  const actions = useMemo(
    () =>
      Object.fromEntries(
        ['activate', 'deactivate', 'remove', 'dismissTrialNotice'].map((name) => [
          name,
          async (input) => {
            const status = await licenseService[name](input);
            queryClient.setQueryData(LICENSE_QUERY_KEY, status);
            return status;
          },
        ]),
      ),
    [queryClient],
  );

  return {
    status: query.data ?? null,
    // A retry after a failed load keeps the error view (with a disabled Retry) instead of the skeleton.
    isLoading: query.isPending && query.errorUpdateCount === 0,
    isFetching: query.isFetching,
    refetch: query.refetch,
    ...actions,
  };
}

const UNKNOWN_FLAGS = Object.freeze({ known: false, pro: false, trial: null });

const selectFlags = (status) =>
  status
    ? {
        known: true,
        pro: status.pro === true,
        trial: status.trial ?? null,
      }
    : UNKNOWN_FLAGS;

/**
 * Small derived view of the license status for chrome that must not re-render with
 * every field (theme, gating). `known` is false while the status is loading or failed
 * to load (for example a 401 before login), so callers keep their saved preference.
 */
export function useLicenseFlags() {
  const { data } = useQuery({ ...LICENSE_QUERY_OPTIONS, select: selectFlags });
  return data ?? UNKNOWN_FLAGS;
}
