import { useQuery } from '@tanstack/react-query';
import { getAppInfo } from '../services/appInfoService';

export const APP_INFO_QUERY_KEY = ['app', 'info'];

/** The running app's version and channel. `info` is null until it loads or when it cannot be read. */
export function useAppInfo() {
  const query = useQuery({
    queryKey: APP_INFO_QUERY_KEY,
    queryFn: getAppInfo,
    staleTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return { info: query.data ?? null };
}
