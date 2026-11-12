import { MODULE_SHELL } from '../modules';
import { useNetworkSettings } from './useNetworkSettings';

const SHELL_HIDDEN = MODULE_SHELL?.hiddenNetworkFeatures ?? [];

/**
 * True in a built app, false in Studio. A built app always has a module shell (the runtime module provides one, Studio does not), even when
 * that shell hides no network feature. A built app words its Settings as "this app", never Local App Studio.
 */
export const IS_BUILT_APP = MODULE_SHELL != null;
/** What Settings calls the product in a sentence. */
export const PRODUCT_NAME = IS_BUILT_APP ? 'this app' : 'Local App Studio';
/** The product name at the start of a sentence ("This app" in a built app). */
export const PRODUCT_NAME_START = PRODUCT_NAME.charAt(0).toUpperCase() + PRODUCT_NAME.slice(1);

/**
 * Ids of the network features Settings leaves out. A built app has no license or update check, so it hides them, unless
 * one is switched on in the saved settings: that row stays so it can be switched off. Studio hides nothing and fetches nothing here.
 */
export function useHiddenNetworkFeatures() {
  const { features } = useNetworkSettings({ enabled: SHELL_HIDDEN.length > 0 });
  if (SHELL_HIDDEN.length === 0) return SHELL_HIDDEN;
  const on = new Set((features ?? []).filter((f) => f.enabled === true).map((f) => f.id));
  return SHELL_HIDDEN.filter((id) => !on.has(id));
}
