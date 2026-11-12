// Public stub of the Pro gating seam (docs/ARCHITECTURE.md, 'The pro seam', docs/LICENSING.md, 'Adding a Pro feature').
// Licensing is off in this build, so every capability is on: isProEnabled() is true and requirePro / assertPro pass, as
// the licensed module does when no store is set up. A pro build swaps this file for pro/server/pro.js; the export names
// are the same. Gate by CAPABILITY, never by quota or provider.

/**
 * Registry of Pro capabilities. Add one entry per gated feature, then guard its route with
 * requirePro('<id>') and its library entry point with assertPro('<id>'). `used: false` reserves
 * an id for a feature you plan but have not built: nothing checks it yet.
 */
export const PRO_FEATURES = Object.freeze({
  example_pro: Object.freeze({ used: false, label: 'Example Pro capability' }),
});

export const MSG_PRO_REQUIRED =
  'This is a Local App Studio Pro feature. Activate a license in Settings > License. Your data and everything in Local App Studio Free keep working.';

/** @param {string} feature @returns {void} */
function assertKnownFeature(feature) {
  if (!Object.hasOwn(PRO_FEATURES, feature)) throw new Error(`Unknown Pro feature: ${String(feature)}`);
}

/** A Pro capability was used without Pro. Always a 403. Never thrown in this build. */
export class ProRequiredError extends Error {
  /** @param {string} feature A PRO_FEATURES id. */
  constructor(feature) {
    super(MSG_PRO_REQUIRED);
    this.name = 'ProRequiredError';
    this.code = 'pro_required';
    this.httpStatus = 403;
    this.feature = feature;
    this.publicMessage = MSG_PRO_REQUIRED;
  }
}

/** @returns {boolean} always true: licensing is off */
export function isProEnabled() {
  return true;
}

/**
 * @param {string} feature A PRO_FEATURES id.
 * @returns {void}
 */
export function assertPro(feature) {
  assertKnownFeature(feature);
}

/**
 * @param {string} feature A PRO_FEATURES id.
 * @returns {import('express').RequestHandler}
 */
export function requirePro(feature) {
  assertKnownFeature(feature);
  return (req, res, next) => next();
}
