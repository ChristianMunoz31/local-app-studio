// Cloud AI safeguards: ids, defaults and consent constants shared by the Settings > AI UI.
// Pure module with no imports. server/__tests__/cloudAiParity.test.js imports it and checks it
// against server/ai/privacy.js and server/ai/consent.js, so keep them in step. The list mirrors studio mode
// (the Studio module contributes the `features` category); built apps bake cloud AI out. Add one id per
// kind of data a module has that a user may want to keep off a cloud provider.

/** Data kinds the user can allow or withhold from a cloud AI provider, in display order. */
export const CLOUD_CATEGORY_IDS = Object.freeze(['features']);

/** What a fresh install allows. */
export const CLOUD_CATEGORY_DEFAULTS = Object.freeze({
  features: true,
});

/** Bumped whenever the consent wording changes, which asks existing users again. */
export const CLOUD_CONSENT_VERSION = 1;

/** The two statements the user must tick before cloud AI turns on. */
export const CLOUD_CONSENT_ACKS = Object.freeze(['sends_data', 'pay_provider']);

/** Plain-language label (and optional hint) for each data kind. */
export const CLOUD_CATEGORY_LABELS = Object.freeze({
  features: Object.freeze({ label: 'Saved features', hint: 'Names, descriptions and settings of the features you saved' }),
});
