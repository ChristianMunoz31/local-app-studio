import { useLicenseFlags } from './useLicense';

/**
 * What the user may use, from the shared license query. `known` is false while the status is
 * loading or failed to load: callers must not show a Pro prompt then (the server still enforces
 * Pro, and a 403 pro_required is handled where the call is made).
 */
export const useEntitlements = useLicenseFlags;

/** True when the user is known not to have Pro (never while the status is unknown). */
export const isKnownFree = (e) => e.known && !e.pro;
