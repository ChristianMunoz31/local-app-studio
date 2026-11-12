// Outbound-network opt-in. Every feature that calls a third-party host (other than a
// local Ollama on this machine) is OFF until the user turns it on in
// Settings → Network, or pre-enables it with APP_NETWORK_OPTIN=cloudAi,updates,...
//
// State is persisted in app_state under `network.optIn` as { [featureId]: boolean }.
// A stored value wins over the env default; when storage is unavailable only the env
// default applies.
import { getState, setState } from './dataAccess.js';
import { sendError } from './errors.js';
import { FeatureUnavailableError, featureUnavailableBody, isFeatureInBuild } from './buildFeatures.js';
import { mergeLists } from './modules/data.js';

export { featureUnavailableBody, isFeatureInBuild };

export const NETWORK_STATE_KEY = 'network.optIn';
const CACHE_TTL_MS = 30_000;
const FAILURE_TTL_MS = 5_000;

const KIT_NETWORK_FEATURES = [
  Object.freeze({
    id: 'cloudAi',
    label: 'Cloud AI provider',
    description: 'Use a cloud AI provider (sends data off your machine). Prompts and the data the assistant reads go to the endpoint you set.',
    hosts: Object.freeze(['the endpoint you set in Settings > AI']),
  }),
  Object.freeze({
    id: 'aiLan',
    label: 'Ollama on another machine',
    description: 'Use an Ollama server on another machine. Prompts and the data the assistant reads go to that machine.',
    hosts: Object.freeze(['the Ollama host you set in Settings > AI']),
  }),
  Object.freeze({
    id: 'updates',
    label: 'Update check',
    description:
      'Asks GitHub whether a newer release of this app exists when you open Settings. Nothing about you or your data is sent; GitHub sees your IP address like any website.',
    hosts: Object.freeze(['api.github.com']),
  }),
  Object.freeze({
    id: 'license',
    label: 'License activation',
    description:
      'Contacts Gumroad or Lemon Squeezy only when you click Activate or Move to another computer in Settings > License. Your license key goes to the store you bought from. Clicking one of those buttons turns this on.',
    hosts: Object.freeze(['api.gumroad.com', 'api.lemonsqueezy.com']),
  }),
];

/** Fixed order: this is the order the settings API returns. The kit's features first, then the active modules' (server/modules/*.data.js). */
export const NETWORK_FEATURES = Object.freeze([
  ...KIT_NETWORK_FEATURES,
  ...mergeLists('networkFeatures', KIT_NETWORK_FEATURES.map((f) => f.id)).map((f) =>
    Object.freeze({ id: f.id, label: f.label, description: f.description, hosts: Object.freeze([...f.hosts]) }),
  ),
]);

const BY_ID = new Map(NETWORK_FEATURES.map((f) => [f.id, f]));

/** @param {unknown} id */
export const isFeatureId = (id) => typeof id === 'string' && BY_ID.has(id);

const envDefaults = (env = process.env) =>
  new Set(
    (env.APP_NETWORK_OPTIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => BY_ID.has(s)),
  );

let cache = null; // { stored: Record<string, boolean>, until: number }

const sanitizeStored = (raw) => {
  const out = {};
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const f of NETWORK_FEATURES) if (typeof raw[f.id] === 'boolean') out[f.id] = raw[f.id];
  }
  return out;
};

async function loadStored() {
  if (cache && Date.now() < cache.until) return cache.stored;
  try {
    const stored = sanitizeStored(await getState(NETWORK_STATE_KEY, null));
    cache = { stored, until: Date.now() + CACHE_TTL_MS };
    return stored;
  } catch {
    // Storage unavailable: fall back to the env default, retry shortly.
    cache = { stored: {}, until: Date.now() + FAILURE_TTL_MS };
    return {};
  }
}

/**
 * Whether a feature may call the internet right now. Never throws.
 * @param {string} id one of the NETWORK_FEATURES ids
 * @returns {Promise<boolean>}
 */
export async function isEnabled(id) {
  if (!BY_ID.has(id)) return false;
  // A feature this build does not contain is off whatever is stored or pre-enabled.
  if (!isFeatureInBuild(id)) return false;
  const stored = await loadStored();
  return id in stored ? stored[id] : envDefaults().has(id);
}

/**
 * The settings payload: every feature with its effective state, in fixed order.
 * @returns {Promise<{ features: Array<{ id: string, enabled: boolean, available: boolean, label: string, description: string, hosts: string[] }> }>}
 */
export async function listNetworkFeatures() {
  const stored = await loadStored();
  const defaults = envDefaults();
  return {
    features: NETWORK_FEATURES.map((f) => {
      const available = isFeatureInBuild(f.id);
      return {
        id: f.id,
        enabled: available && (f.id in stored ? stored[f.id] : defaults.has(f.id)),
        available,
        label: f.label,
        description: f.description,
        hosts: [...f.hosts],
      };
    }),
  };
}

/**
 * Persist one feature's opt-in. Throws when storage is unavailable.
 * @param {string} id
 * @param {boolean} enabled
 */
export async function setNetworkFeature(id, enabled) {
  if (!BY_ID.has(id)) throw new Error('Unknown network feature');
  if (enabled && !isFeatureInBuild(id)) throw new FeatureUnavailableError(id);
  const current = sanitizeStored(await getState(NETWORK_STATE_KEY, null));
  const next = { ...current, [id]: enabled };
  await setState(NETWORK_STATE_KEY, next);
  cache = { stored: next, until: Date.now() + CACHE_TTL_MS };
}

/** The 403 body returned when a gated-off feature is called. */
export function networkRequiredBody(id) {
  const feature = BY_ID.get(id);
  return {
    error: 'network_opt_in_required',
    feature: id,
    message: `${feature ? feature.label : id} is turned off. Enable it in Settings → Network (this calls the internet).`,
  };
}

/** Thrown by library code (not routes) when a gated-off feature is invoked. */
export class NetworkOptInError extends Error {
  /** @param {string} id */
  constructor(id) {
    super(networkRequiredBody(id).message);
    this.name = 'NetworkOptInError';
    this.status = 403;
    this.feature = id;
  }
}

/**
 * Throws NetworkOptInError unless the feature is enabled.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function assertNetworkEnabled(id) {
  if (BY_ID.has(id) && !isFeatureInBuild(id)) throw new FeatureUnavailableError(id);
  if (!(await isEnabled(id))) throw new NetworkOptInError(id);
}

/**
 * Express middleware: 403 network_opt_in_required while the feature is off, 403 feature_unavailable when this build lacks it.
 * @param {string} id
 * @returns {import('express').RequestHandler}
 */
export function requireNetwork(id) {
  return async (req, res, next) => {
    try {
      if (!isFeatureInBuild(id)) {
        res.set('Cache-Control', 'no-store');
        const body = featureUnavailableBody(id);
        return sendError(res, 'feature_unavailable', { message: body.message, extra: { feature: id } });
      }
      if (await isEnabled(id)) return next();
      res.set('Cache-Control', 'no-store');
      return sendError(res, 'network_opt_in_required', { message: networkRequiredBody(id).message, extra: { feature: id } });
    } catch (err) {
      return next(err);
    }
  };
}

/** Test hook: drop the cached opt-in state. */
export function __resetNetPolicyForTests() {
  cache = null;
}
