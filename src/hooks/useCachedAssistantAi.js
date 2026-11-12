import { useQuery } from '@tanstack/react-query';

export const ASSISTANT_STATUS_KEY = ['assistant-status'];

export const fetchAssistantStatus = async () => {
  const res = await fetch('/api/assistant/status');
  return res.ok ? res.json() : null;
};

/**
 * Where the assistant runs ({ kind, host }) from the status already in the query cache, with no request
 * of its own: the panel's useAssistantStatus fetches it when the assistant opens, and this follows the
 * cache. For code that must not call the server on mount.
 * @returns {{ ai: { kind: string, host: string | null } | null }}
 */
export function useCachedAssistantAi() {
  const query = useQuery({ queryKey: ASSISTANT_STATUS_KEY, queryFn: fetchAssistantStatus, enabled: false });
  return { ai: query.data?.ai ?? null };
}
