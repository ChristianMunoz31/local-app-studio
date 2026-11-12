// Opt-in update check. Asks GitHub's public releases API whether a newer Local App Studio release exists. The stable
// check reads the PUBLIC downloads repo (releasesRepo in config/release.json, same vX.Y.Z tags as the private source repo), because
// an installed app cannot read a private repo anonymously. Only the Local App Studio Dev check still lists the private repo.
// Gated by the `updates` network feature (server/netPolicy.js). Nothing about the user or
// their data is sent, nothing is downloaded or installed, and release body text is never
// forwarded: the result is only a status, two version strings and a releases-page link.
// While the repo owner is still the template placeholder the check resolves to reason 'not_configured' with no request.
// Upstream failures resolve to { status: 'unavailable' } and never throw.
import fs from 'node:fs';
import fetch from 'node-fetch';
import { DEV_TAG_RE, DEV_VERSION_RE, getChannel } from './channel.js';
import { assertNetworkEnabled } from './netPolicy.js';
import { recordNetworkCall, statusFromHttp } from './networkCall.js';
import { RELEASE_CONFIG, isPlaceholderRepo } from '../scripts/release/releaseConfig.js';
import { BUNDLED_APP_VERSION } from './runtime.js';

const UPDATE_API_ORIGIN = 'https://api.github.com';
/** Stable updates: the public downloads repo (publishPublic.js publishes every stable release there, tag vX.Y.Z). */
export const UPDATE_REPO = RELEASE_CONFIG.releasesRepo;
export const RELEASES_PAGE = `https://github.com/${UPDATE_REPO}/releases`;
/** Local App Studio Dev updates: dev pre-releases are published to the private source repo (see dev-build.yml). */
export const DEV_UPDATE_REPO = RELEASE_CONFIG.sourceRepo;
export const DEV_RELEASES_PAGE = `https://github.com/${DEV_UPDATE_REPO}/releases`;

const MAX_BODY_BYTES = 256 * 1024;
const MAX_LIST_BYTES = 1024 * 1024;
const DEV_LIST_SIZE = 20;
const OK_TTL_MS = 6 * 60 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 15 * 60 * 1000;
const REFRESH_MIN_INTERVAL_MS = 60 * 1000;

const readAppVersion = () => {
  if (BUNDLED_APP_VERSION) return BUNDLED_APP_VERSION;
  try {
    const raw = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const version = JSON.parse(raw).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
};

export const APP_VERSION = readAppVersion();

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const parseSemver = (value) => {
  if (typeof value !== 'string') return null;
  const m = SEMVER.exec(value.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
};

const comparePre = (a, b) => {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]);
    const nb = /^\d+$/.test(pb[i]);
    if (na && nb) {
      const d = Number(pa[i]) - Number(pb[i]);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
};

/**
 * Compare two x.y.z[-pre] versions (leading "v" allowed).
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1|null} null when either side is not a valid version
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return comparePre(pa.pre, pb.pre);
}

const isAbortError = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

let cache = null; // { key, value, until }
let inflight = null; // { key, promise }
let lastFetchAt = 0;

/** Test hook: drop the cached result and any in-flight request. */
export function __resetUpdateCacheForTests() {
  cache = null;
  inflight = null;
  lastFetchAt = 0;
}

const unavailable = (current, reason, channel = 'stable') => ({
  status: 'unavailable',
  current,
  reason,
  channel,
  checkedAt: new Date().toISOString(),
});

async function readCappedText(response, limit) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  const text = await response.text();
  return typeof text === 'string' && text.length <= limit ? text : null;
}

async function readCappedJson(response) {
  const text = await readCappedText(response, MAX_BODY_BYTES);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readCappedJsonArray(response) {
  const text = await readCappedText(response, MAX_LIST_BYTES);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const releaseUrl = (release, page = RELEASES_PAGE) => {
  const htmlUrl = typeof release.html_url === 'string' ? release.html_url : '';
  return htmlUrl.startsWith(`${page}/`) ? htmlUrl : page;
};

const releaseDate = (release) =>
  typeof release.published_at === 'string' && !Number.isNaN(Date.parse(release.published_at))
    ? release.published_at
    : null;

/**
 * One dev pre-release that is internally consistent: published pre-release, tag dev-<date>-<sha7>, title
 * "Local App Studio Dev <version>" and a version whose date and sha equal the tag's. Anything else is ignored.
 * @returns {{ version: string, core: string, dateStamp: string, sha: string, publishedMs: number, release: object } | null}
 */
function parseDevRelease(release) {
  if (release === null || typeof release !== 'object') return null;
  if (release.draft === true || release.prerelease !== true) return null;
  const tag = DEV_TAG_RE.exec(typeof release.tag_name === 'string' ? release.tag_name : '');
  const named = /^Local App Studio Dev (\S+)$/.exec(typeof release.name === 'string' ? release.name : '');
  if (!tag || !named) return null;
  const v = DEV_VERSION_RE.exec(named[1]);
  if (!v || v[4] !== tag[1] || v[5] !== tag[2]) return null;
  const published = releaseDate(release);
  return {
    version: named[1],
    core: `${v[1]}.${v[2]}.${v[3]}`,
    dateStamp: v[4],
    sha: v[5],
    publishedMs: published === null ? 0 : Date.parse(published),
    release,
  };
}

async function queryStable({ fetchImpl, currentVersion, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Local App Studio' },
      redirect: 'manual',
      size: MAX_BODY_BYTES,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return unavailable(currentVersion, isAbortError(err) ? 'timeout' : 'network');
  }

  if (response.status === 404) return unavailable(currentVersion, 'not_found');
  if (response.status === 403 || response.status === 429) return unavailable(currentVersion, 'rate_limited');
  if (!response.ok) return unavailable(currentVersion, 'bad_response');

  let release;
  try {
    release = await readCappedJson(response);
  } catch (err) {
    return unavailable(currentVersion, isAbortError(err) ? 'timeout' : 'bad_response');
  }
  if (!release) return unavailable(currentVersion, 'bad_response');
  if (release.draft === true || release.prerelease === true) return unavailable(currentVersion, 'not_found');

  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  const latest = tag.replace(/^v/, '');
  const order = compareSemver(latest, currentVersion);
  if (!parseSemver(tag) || order === null) return unavailable(currentVersion, 'bad_response');

  const checkedAt = new Date().toISOString();
  if (order <= 0) return { status: 'current', current: currentVersion, latest, channel: 'stable', checkedAt };

  return {
    status: 'available',
    current: currentVersion,
    latest,
    url: releaseUrl(release),
    publishedAt: releaseDate(release),
    channel: 'stable',
    checkedAt,
  };
}

/** Newest first: published_at, then the date in the version. */
const newerFirst = (a, b) => {
  if (a.publishedMs !== b.publishedMs) return b.publishedMs - a.publishedMs;
  if (a.dateStamp === b.dateStamp) return 0;
  return a.dateStamp < b.dateStamp ? 1 : -1;
};

async function queryDev({ fetchImpl, currentVersion, timeoutMs }) {
  const fail = (reason) => unavailable(currentVersion, reason, 'dev');
  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${DEV_UPDATE_REPO}/releases?per_page=${DEV_LIST_SIZE}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Local App Studio' },
      redirect: 'manual',
      size: MAX_LIST_BYTES,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return fail(isAbortError(err) ? 'timeout' : 'network');
  }

  if (response.status === 404) return fail('not_found');
  if (response.status === 403 || response.status === 429) return fail('rate_limited');
  if (!response.ok) return fail('bad_response');

  let list;
  try {
    list = await readCappedJsonArray(response);
  } catch (err) {
    return fail(isAbortError(err) ? 'timeout' : 'bad_response');
  }
  if (!list) return fail('bad_response');

  const kept = list.map(parseDevRelease).filter(Boolean).sort(newerFirst);
  if (kept.length === 0) return fail('not_found');
  const newest = kept[0];

  const checkedAt = new Date().toISOString();
  const current = DEV_VERSION_RE.exec(currentVersion);
  let available = true;
  if (current) {
    if (current[5] === newest.sha) {
      available = false;
    } else {
      const order = compareSemver(newest.core, `${current[1]}.${current[2]}.${current[3]}`);
      if (order === -1 || (order === 0 && newest.dateStamp < current[4])) available = false;
    }
  }
  if (!available) {
    return { status: 'current', current: currentVersion, latest: newest.version, channel: 'dev', checkedAt };
  }
  return {
    status: 'available',
    current: currentVersion,
    latest: newest.version,
    url: releaseUrl(newest.release, DEV_RELEASES_PAGE),
    publishedAt: releaseDate(newest.release),
    channel: 'dev',
    checkedAt,
  };
}

const query = (args) => (args.channel === 'dev' ? queryDev(args) : queryStable(args));

/**
 * Check GitHub for a newer release. Throws NetworkOptInError while the `updates` feature is off;
 * every upstream failure resolves to { status: 'unavailable', reason }. Concurrent calls share one
 * request, and `refresh` is ignored when the last upstream fetch was under 60 s ago.
 * @param {{ fetchImpl?: typeof fetch, currentVersion?: string, timeoutMs?: number, refresh?: boolean,
 *   channel?: 'stable' | 'dev' }} [options] `channel` picks the update source: stable asks for the latest release
 *   (pre-releases are rejected), dev lists recent releases and keeps only Local App Studio Dev pre-releases
 * @returns {Promise<object>} UpdateStatus
 */
export async function checkForUpdate({
  fetchImpl = fetch,
  currentVersion = APP_VERSION,
  timeoutMs = 5000,
  refresh = false,
  channel = getChannel(),
} = {}) {
  await assertNetworkEnabled('updates');
  // An un-renamed build still points at a placeholder GitHub handle anyone could register: never query it.
  if (isPlaceholderRepo(channel === 'dev' ? DEV_UPDATE_REPO : UPDATE_REPO)) {
    return unavailable(currentVersion, 'not_configured', channel);
  }
  const key = `${channel}:${currentVersion}`;
  const now = Date.now();
  const cached = cache && now < cache.until && cache.key === key ? cache.value : null;
  const refreshAllowed = refresh && now - lastFetchAt >= REFRESH_MIN_INTERVAL_MS;
  if (cached && !refreshAllowed) return cached;
  if (inflight && inflight.key === key) return inflight.promise;

  lastFetchAt = now;
  // Result rule (server/networkCall.js): ok only when GitHub answered 2xx or 3xx and nothing timed out.
  let httpStatus = null;
  const trackedFetch = async (...args) => {
    const response = await fetchImpl(...args);
    httpStatus = response?.status;
    return response;
  };
  const promise = query({ fetchImpl: trackedFetch, currentVersion, timeoutMs, channel })
    .then(async (value) => {
      const failed = value.status === 'unavailable' && (value.reason === 'timeout' || value.reason === 'network');
      await recordNetworkCall('updates', UPDATE_API_ORIGIN, failed ? 'error' : statusFromHttp(httpStatus));
      cache = {
        key,
        value,
        until: Date.now() + (value.status === 'unavailable' ? UNAVAILABLE_TTL_MS : OK_TTL_MS),
      };
      return value;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { key, promise };
  return promise;
}
