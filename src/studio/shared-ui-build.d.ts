// Types for the kit's network opt-in hooks and switch, used by the Build tab.
declare module '@/hooks/useNetworkSettings.js' {
  export interface NetworkFeatureInfo {
    id: string;
    enabled: boolean;
    available?: boolean;
    label: string;
    description: string;
    hosts?: string[];
  }
  export function useNetworkSettings(opts?: { enabled?: boolean }): {
    features: NetworkFeatureInfo[] | null;
    isLoading: boolean;
    error: unknown;
    refetch: () => Promise<unknown>;
    setEnabled: (id: string, enabled: boolean) => Promise<unknown>;
  };
}
declare module '@/hooks/useNetworkFeature.js' {
  export function useNetworkFeature(id: string): {
    settingsLoading: boolean;
    enabled: boolean;
    offError: Error | null;
  };
}
declare module '@/components/settings/SwitchToggle.jsx' {
  import type { ComponentType, Ref } from 'react';
  const SwitchToggle: ComponentType<{
    checked: boolean;
    disabled?: boolean;
    labelledBy?: string;
    describedBy?: string;
    onChange: (next: boolean) => void;
    buttonRef?: Ref<HTMLButtonElement>;
  }>;
  export default SwitchToggle;
}
