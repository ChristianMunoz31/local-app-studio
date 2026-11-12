// Whether the helper is known to be down (Ollama not ready). A build without the helper has nothing to check: no request is made
// and the answer is always false.
import { useOllamaSetup } from '@/hooks/useOllamaSetup.js';
import { PRO_PARTS } from '@/proParts.js';

export function useHelperDown(): boolean {
  const { setup } = useOllamaSetup({ enabled: PRO_PARTS.helper });
  return PRO_PARTS.helper && setup !== null && !setup.ready;
}
