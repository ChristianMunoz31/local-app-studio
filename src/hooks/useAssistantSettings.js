import { useSyncedSetting } from './useSyncedSetting';
import {
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  normalizeAssistantAdvisorButton,
  normalizeAssistantAutoAdvise,
} from '../constants/settingsDefaults';

/** @returns {{ showButton: boolean, autoAdvise: boolean }} */
export function useAssistantSettings() {
  const [button] = useSyncedSetting(SETTINGS_KEYS.assistantAdvisorButton, SETTINGS_DEFAULTS.assistantAdvisorButton);
  const [auto] = useSyncedSetting(SETTINGS_KEYS.assistantAutoAdvise, SETTINGS_DEFAULTS.assistantAutoAdvise);
  return {
    showButton: normalizeAssistantAdvisorButton(button),
    autoAdvise: normalizeAssistantAutoAdvise(auto),
  };
}
