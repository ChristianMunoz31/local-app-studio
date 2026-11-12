import { useQuery } from '@tanstack/react-query';
import { ASSISTANT_STATUS_KEY as KEY, fetchAssistantStatus } from './useCachedAssistantAi';

// Reads GET /api/assistant/status: { available, provider, model, reason? }. The provider and
// model are changed in Settings > AI (see useAiSettings), which refreshes this query.
export function useAssistantStatus() {
  const query = useQuery({
    queryKey: KEY,
    queryFn: fetchAssistantStatus,
    staleTime: 60 * 1000,
  });

  return {
    status: query.data || null,
    loading: query.isPending,
    error: query.error ?? null,
  };
}
