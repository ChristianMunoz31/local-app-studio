// Public stub of the licensing module (docs/ARCHITECTURE.md, 'The pro seam'): licensing is off in this build, so
// everything, Pro capabilities included, is available and there is nothing to activate. A pro build swaps this file for
// pro/server/license/index.js; the export names are the same. This file never touches a store, the network, a trial
// record or config/store.json (that file is pro).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envDir, getAppVersion } from '../runtime.js';
import { loadBuildInfo } from './buildInfo.js';
import { STORE_ERROR_STATUS, storeErrorMessage } from './messages.js';

const REPO_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const TRIAL_NOTICE_NAMES = Object.freeze(['welcome', 'ending_soon', 'ended']);

export class LicenseError extends Error {
  /**
   * @param {{ httpStatus: number, code: string, publicMessage: string, detail?: object }} info
   */
  constructor({ httpStatus, code, publicMessage, detail }) {
    super(code);
    this.name = 'LicenseError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.publicMessage = publicMessage;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, store = null) => new LicenseError({ httpStatus: STORE_ERROR_STATUS[code] ?? 502, code, publicMessage: storeErrorMessage(code, { store: store?.label ?? null }) });

// The two stores a build with licensing could offer, as the status lists them (id, label) with the shape of their keys, so this
// stub answers an activation like the pro build does with no store set up: a bad key shape first, then "no store set up".
// pro/server/__tests__/licenseStubParity.test.js compares these with the stores of the pro twin.
const MAX_KEY_INPUT_CHARS = 128;
const STORES = Object.freeze([
  { id: 'gumroad', label: 'Gumroad', normalize: (raw) => raw.replace(/\s+/g, '').toUpperCase(), shape: /^[0-9A-F]{8}(-[0-9A-F]{8}){3}$/ },
  {
    id: 'lemonsqueezy',
    label: 'Lemon Squeezy',
    normalize: (raw) => raw.replace(/\s+/g, '').toLowerCase(),
    shape: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  },
]);
const matches = (store, raw) => raw.length <= MAX_KEY_INPUT_CHARS && store.shape.test(store.normalize(raw));

/** Licensing is off: nothing to start, nothing to read. */
export function initLicense() {}

/** @returns {{ pro: boolean, edition: string | null, reasons: string[] }} */
export function getEntitlements() {
  return { pro: true, edition: null, reasons: ['licensing_off'] };
}

/** @returns {object} the GET /api/license body for a build with licensing off */
export function getLicenseStatus() {
  const buildInfo = loadBuildInfo({ distDir: envDir('APP_DIST_DIR') ?? REPO_DIST });
  return {
    state: 'licensing_off',
    pro: true,
    edition: null,
    reasons: ['licensing_off'],
    message: 'Licensing is not set up in this copy of Local App Studio, so every feature, Pro included, is available.',
    invalidReason: null,
    license: null,
    trialDaysLeft: null,
    build: { date: buildInfo.buildDateIso, source: buildInfo.source, version: getAppVersion() },
    clock: { rollbackDetected: false },
    licenseState: 'licensing_off',
    proSource: 'licensing_off',
    trial: { state: 'unavailable', startedAt: null, endsAt: null, daysLeft: null, remindToday: false, notice: null },
    perks: {},
    stores: STORES.map((s) => ({ id: s.id, label: s.label, configured: false })),
    purchaseUrl: null,
    supportContact: null,
  };
}

/**
 * No store is set up, so a key cannot be activated. The codes are the pro build's with no store configured: invalid_request
 * (no key text, or a store id that is not one of the two), invalid_key_format (the key does not look like the named store's
 * or either store's), else store_not_configured.
 * @param {{ licenseKey: unknown, store?: string }} [input]
 * @returns {Promise<never>}
 * @throws {LicenseError}
 */
export async function activateLicense({ licenseKey, store: storeId } = {}) {
  const named = storeId === undefined || storeId === null ? null : (STORES.find((s) => s.id === storeId) ?? null);
  if (typeof licenseKey !== 'string' || (storeId !== undefined && storeId !== null && named === null)) throw fail('invalid_request');
  const store = named ?? STORES.find((s) => matches(s, licenseKey)) ?? null;
  if (store === null || !matches(store, licenseKey)) throw fail('invalid_key_format', named);
  throw fail('store_not_configured', store);
}

/**
 * Nothing is activated, so there is nothing to release.
 * @param {{ licenseKey?: unknown }} [input]
 * @returns {Promise<never>}
 * @throws {LicenseError}
 */
export async function deactivateLicense({ licenseKey } = {}) {
  throw fail(licenseKey !== undefined && licenseKey !== null && typeof licenseKey !== 'string' ? 'invalid_request' : 'nothing_to_deactivate');
}

/** @returns {Promise<object>} LicenseStatus (idempotent: there is no license to remove) */
export async function removeLicense() {
  return getLicenseStatus();
}

/**
 * @param {unknown} notice 'welcome' | 'ending_soon' | 'ended'
 * @returns {object} LicenseStatus
 * @throws {LicenseError} 400 invalid_request
 */
export function dismissTrialNotice(notice) {
  if (typeof notice !== 'string' || !TRIAL_NOTICE_NAMES.includes(notice)) throw fail('invalid_request');
  return getLicenseStatus();
}

export function resetLicenseForTests() {}
