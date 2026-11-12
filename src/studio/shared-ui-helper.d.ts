// Types for the kit's Ollama setup pieces that the Studio Describe flow uses.
declare module '@/components/shared/OllamaSetup.jsx' {
  import type { ComponentType } from 'react';
  const OllamaSetup: ComponentType<{
    onReady?: () => void;
    onBusyChange?: (busy: boolean) => void;
    /** Who needs the model, in the intro and ready texts. Defaults to "Assistant". */
    subject?: string;
  }>;
  export default OllamaSetup;
}
declare module '@/hooks/useOllamaSetup.js' {
  export interface OllamaSetupState {
    ollama: 'missing' | 'stopped' | 'unreachable' | 'running' | 'remote' | 'disabled';
    ready: boolean;
    models?: string[];
    canPull?: boolean;
    provider?: string;
  }
  export function useOllamaSetup(options?: { enabled?: boolean }): {
    setup: OllamaSetupState | null;
    isLoading: boolean;
    isFetching: boolean;
    error: unknown;
    checkAgain: () => Promise<void>;
  };
}
