// Shared Pro switch for component tests that render a Pro entry point without a QueryClient.
// A test file adds, at the top level (the path is relative to the test file):
//
//   vi.mock('../../../hooks/useEntitlements', async () => (await import('../../../test-utils/entitlements.js')).entitlementsModule());
//
// useEntitlements() then returns the state below (a known Pro user by default). Call
// setEntitlementsState(...) in a test to prove the free and loading cases, resetEntitlementsState() after.
export const PRO_STATE = Object.freeze({ known: true, pro: true, edition: 'standard', proSource: 'license', trial: null });
export const FREE_STATE = Object.freeze({
  known: true,
  pro: false,
  edition: null,
  proSource: null,
  trial: Object.freeze({ state: 'ended', startedAt: null, endsAt: null, daysLeft: 0, remindToday: false, notice: null }),
});
export const UNKNOWN_STATE = Object.freeze({ known: false, pro: false, edition: null, proSource: null, trial: null });

let current = PRO_STATE;

export const setEntitlementsState = (next) => {
  current = next;
};
export const resetEntitlementsState = () => {
  current = PRO_STATE;
};

export function entitlementsModule() {
  return {
    useEntitlements: () => current,
    isKnownFree: (e) => e.known && !e.pro,
  };
}
