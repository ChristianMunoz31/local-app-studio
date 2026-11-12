// Cloud AI data categories and the enforcement that keeps withheld ones off the wire.
//
// Local Ollama (and an aiLan Ollama) is trusted: every category works. A cloud provider only
// ever receives the categories the user ticked. The single choke point is
// enforceCloudScope(), called from createAiClient events() for every cloud call; page,
// tool and advice code filters earlier so the model also learns what it cannot see.
// "null" in a mapping means the data has no category and is always allowed; a name missing from
// a mapping is unknown and therefore not allowed under cloud. An entry may also be an array of
// categories when the data spans several: all of it must be shared. An unknown string, or an empty
// or unknown list, is malformed and refused like a missing entry.

import { mergeLists, mergeRecords } from '../modules/data.js';

const KIT_CATEGORY_IDS = [];
const MODULE_CATEGORIES = mergeLists('cloudCategories', KIT_CATEGORY_IDS);

// The kit's categories first, then the ones the active modules contribute (server/modules/*.data.js).
export const CLOUD_CATEGORY_IDS = Object.freeze([...KIT_CATEGORY_IDS, ...MODULE_CATEGORIES.map((c) => c.id)]);

// The kit has no categories of its own: each module contributes its own (one id per kind of data a user may
// want to keep local) through cloudCategories in server/modules/*.data.js.
export const CLOUD_CATEGORY_DEFAULTS = Object.freeze({
  ...Object.fromEntries(MODULE_CATEGORIES.map((c) => [c.id, c.default])),
});

/** Internal scope for any assistant memory you add: never sent to a cloud provider, never in the UI. */
export const MEMORY_SCOPE = 'memory';

/** Noun used in user-facing and model-facing copy, and whether it reads as plural. */
export const CATEGORY_NOUNS = Object.freeze({
  ...Object.fromEntries(MODULE_CATEGORIES.map((c) => [c.id, Object.freeze({ noun: c.noun, plural: c.plural })])),
});

const freeze = (o) => Object.freeze({ ...o });

// Page key -> category, or a non-empty array of categories when the page context spans several (all
// must be shared). null: nothing private on the page (always allowed); a page missing from this
// map, or mapped to an empty or unknown list, is refused under cloud. Mirrors src/constants/assistantPages.js.
const KIT_PAGE_CATEGORIES = { home: null, settings: null };
export const PAGE_CATEGORIES = freeze({
  ...KIT_PAGE_CATEGORIES,
  ...mergeRecords('pageCategories', Object.keys(KIT_PAGE_CATEGORIES)),
});

// Tool name -> category, or an array of categories when the result spans several (all must be
// shared). The kit has no tools of its own; modules contribute theirs (toolCategories in server/modules/*.data.js).
const KIT_TOOL_CATEGORIES = {};
export const TOOL_CATEGORIES = freeze({
  ...KIT_TOOL_CATEGORIES,
  ...mergeRecords('toolCategories', Object.keys(KIT_TOOL_CATEGORIES)),
});

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const lookup = (table, key) => (typeof key === 'string' && has(table, key) ? table[key] : undefined);
const isCategoryId = (v) => typeof v === 'string' && CLOUD_CATEGORY_IDS.includes(v);
const inOrder = (ids) => CLOUD_CATEGORY_IDS.filter((id) => ids.has(id));

/**
 * Normalize a mapping entry to a list of category ids. A string naming a known category becomes a
 * one-item list; any other string is malformed. An array must be non-empty and hold only known
 * category ids; it is deduped and put in CLOUD_CATEGORY_IDS order. Anything else is malformed.
 * @param {unknown} entry
 * @returns {string[] | undefined} undefined when malformed.
 */
export function categoryList(entry) {
  if (typeof entry === 'string') return isCategoryId(entry) ? [entry] : undefined;
  if (!Array.isArray(entry) || entry.length === 0 || !entry.every(isCategoryId)) return undefined;
  return inOrder(new Set(entry));
}

// null and undefined pass through, the rest becomes a list (or undefined).
const resolveEntry = (e) => (e === null || e === undefined ? e : categoryList(e));

/** Fixed copy when cloud AI was turned off (or changed) while a call waited, so nothing was sent. */
export const MSG_CLOUD_DISABLED = 'Cloud AI was turned off, so nothing was sent. Try again to use the AI on this computer.';

/** The user chose not to share these with cloud AI, or enforcement dropped them; or cloud was turned off before sending ('cloud_disabled'). */
export class CloudScopeError extends Error {
  /**
   * @param {'cloud_scope_missing'|'cloud_scope_denied'|'cloud_disabled'} code
   * @param {string[]} [categories] Category ids that were refused (names only).
   */
  constructor(code, categories = []) {
    super(code);
    this.name = 'CloudScopeError';
    this.code = code;
    this.categories = inOrder(new Set(categories.filter(isCategoryId)));
  }
}

/**
 * Keep only known category ids with boolean values.
 * @param {unknown} raw
 * @returns {Partial<Record<string, boolean>>}
 */
export function sanitizeCloudCategories(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const id of CLOUD_CATEGORY_IDS) if (typeof raw[id] === 'boolean') out[id] = raw[id];
  return out;
}

/**
 * Every category with its effective boolean (missing keys use the defaults).
 * @param {unknown} raw
 * @returns {Record<string, boolean>}
 */
export function resolveCloudCategories(raw) {
  const given = sanitizeCloudCategories(raw);
  return Object.fromEntries(CLOUD_CATEGORY_IDS.map((id) => [id, id in given ? given[id] : CLOUD_CATEGORY_DEFAULTS[id]]));
}

/**
 * Deterministic copy for withheld categories, for example
 * "Your saved features aren't shared with cloud AI. You can change that in Settings > AI."
 * @param {string[]} ids
 * @returns {string}
 */
export function withheldMessage(ids) {
  const known = inOrder(new Set((Array.isArray(ids) ? ids : []).filter(isCategoryId)));
  const tail = 'You can change that in Settings > AI.';
  if (known.length === 0) return `That isn't shared with cloud AI. ${tail}`;
  const list = joinNouns(known);
  const single = known.length === 1 && !CATEGORY_NOUNS[known[0]].plural;
  return `Your ${list} ${single ? "isn't" : "aren't"} shared with cloud AI. ${tail}`;
}

// "a", "a and b", "a, b and c" for known category ids.
function joinNouns(ids) {
  const nouns = ids.map((id) => CATEGORY_NOUNS[id].noun);
  return nouns.length === 1 ? nouns[0] : `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}`;
}

/**
 * What a withheld tool returns instead of data. One category gives `category`; several give
 * `categories` (and a null `category`); none known gives the generic placeholder.
 * @param {string | string[] | null | undefined} categoryOrList
 * @returns {{ not_shared: true, category: string | null, categories?: string[], message: string }}
 */
export function withheldToolResult(categoryOrList) {
  const given = Array.isArray(categoryOrList) ? categoryOrList : [categoryOrList];
  const ids = inOrder(new Set(given.filter(isCategoryId)));
  if (ids.length === 0) {
    return { not_shared: true, category: null, message: 'That data is not shared with cloud AI. Do not guess it.' };
  }
  if (ids.length === 1) {
    const { noun, plural } = CATEGORY_NOUNS[ids[0]];
    return { not_shared: true, category: ids[0], message: `The user's ${noun} ${plural ? 'are' : 'is'} not shared with cloud AI. Do not guess it.` };
  }
  return { not_shared: true, category: null, categories: ids, message: `The user's ${joinNouns(ids)} are not shared with cloud AI. Do not guess them.` };
}

/**
 * @typedef {object} AiPolicy
 * @property {boolean} isCloud
 * @property {ReadonlySet<string>} allowed Categories that may leave this machine (every category when local).
 * @property {(category: string | null | undefined) => boolean} allows
 * @property {(page: string) => { allowed: boolean, mode: 'single'|'public', categories: string[], withheld: string[] }} pageDecision
 *   A page entry may be a list: it is one all-or-nothing gate (mode 'single'), allowed only when every
 *   category in it is shared; `withheld` names the denied ones. An empty or unknown list is refused under cloud.
 * @property {(name: string, args?: object) => { allowed: boolean, args: object, categories: string[], withheld: string[] }} toolDecision
 *   A tool entry may be a list: allowed only when every category in it is shared.
 */

/**
 * @param {{ isCloud: boolean, categories?: unknown, pageCategories?: object }} opts `categories` is the saved
 *   (partial or resolved) category map; ignored when local. `pageCategories` (@internal) is a test seam
 *   for the page map, read only by pageDecision.
 * @returns {AiPolicy}
 */
export function createAiPolicy({ isCloud, categories, pageCategories = PAGE_CATEGORIES } = { isCloud: false }) {
  const cloud = isCloud === true;
  const resolved = resolveCloudCategories(categories);
  const allowed = Object.freeze(new Set(CLOUD_CATEGORY_IDS.filter((id) => !cloud || resolved[id])));

  const allows = (category) => {
    if (!cloud) return true;
    if (category === null || category === undefined) return true;
    if (category === MEMORY_SCOPE) return false;
    return allowed.has(category);
  };

  const pageDecision = (page) => {
    const mapped = lookup(pageCategories, page);
    if (mapped === null) return { allowed: true, mode: 'public', categories: [], withheld: [] };
    const list = categoryList(mapped);
    if (list === undefined) {
      return cloud ? { allowed: false, mode: 'single', categories: [], withheld: [] } : { allowed: true, mode: 'single', categories: [], withheld: [] };
    }
    const denied = list.filter((c) => !allows(c));
    return { allowed: denied.length === 0, mode: 'single', categories: list, withheld: denied };
  };

  const toolDecision = (name, args = {}) => {
    const mapped = resolveEntry(lookup(TOOL_CATEGORIES, name));
    const base = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    if (!cloud) return { allowed: true, args: base, categories: [], withheld: [] };
    if (mapped === undefined) return { allowed: false, args: base, categories: [], withheld: [] };
    if (mapped === null) return { allowed: true, args: base, categories: [], withheld: [] };
    const denied = mapped.filter((c) => !allows(c));
    const ok = denied.length === 0;
    return { allowed: ok, args: base, categories: ok ? mapped : [], withheld: denied };
  };

  return Object.freeze({ isCloud: cloud, allowed, allows, pageDecision, toolDecision });
}

// Prior assistant messages in the client-supplied thread cannot be trusted under cloud: the
// reply may have been written by a local model from data this policy withholds. Only the user's
// own messages are kept. The prompt needs alternating roles, so they are joined into one message.
const userMessagesOnly = (messages) => {
  const users = (Array.isArray(messages) ? messages : []).filter((m) => m?.role === 'user' && typeof m.content === 'string');
  if (users.length === 0) return [];
  return [{ role: 'user', content: users.map((m) => m.content).join('\n\n') }];
};

/**
 * Filter an assistant page advice request for the active policy. Local: unchanged.
 * @param {{ page: string, context: string, messages: Array<{ role: string, content: string }> }} input
 * @param {AiPolicy} policy
 * @returns {{ allowed: boolean, context: string, messages: Array<{ role: string, content: string }>, categories: string[], withheld: string[] }}
 */
export function applyPagePolicy({ page, context, messages }, policy) {
  if (!policy.isCloud) return { allowed: true, context, messages, categories: [], withheld: [] };
  const decision = policy.pageDecision(page);
  if (!decision.allowed) return { allowed: false, context: '', messages: [], categories: [], withheld: decision.withheld };
  return { allowed: true, context, messages: userMessagesOnly(messages), categories: decision.categories, withheld: [] };
}

const PLACEHOLDER_ANY = JSON.stringify(withheldToolResult(null));

function toolCallsOf(message) {
  return Array.isArray(message?.tool_calls) ? message.tool_calls : [];
}

const callName = (call) => (typeof call?.function?.name === 'string' ? call.function.name : '');

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** What a tool maps to: undefined (unknown or malformed), null (no user data) or a list of categories. */
const toolCategory = (name) => resolveEntry(lookup(TOOL_CATEGORIES, name));

// Does one persisted tool call touch a category the policy refuses (or an unknown tool)?
function callWithheld(call, policy) {
  const cat = toolCategory(callName(call));
  if (cat === undefined) return true;
  if (cat === null) return false;
  return cat.some((c) => !policy.allows(c));
}

// The persisted tool_calls of an assistant row as a list, or undefined when it cannot be trusted
// (fail closed): jsonb decoding can yield null (bad JSON), a string (double encoding) or an object.
// null/undefined means "no calls"; a string gets one JSON.parse; anything left that is not an
// array, or not null, is untrusted.
function persistedCalls(raw) {
  let value = raw;
  if (typeof value === 'string') value = parseJson(value);
  if (value === null) return [];
  if (value === undefined) return typeof raw === 'string' ? undefined : [];
  return Array.isArray(value) ? value : undefined;
}

// Does one turn (user rows plus the rows after them) taint cloud history? True when any assistant
// row has untrusted or withheld tool calls, or a tool row answers a call this turn never declared
// (the interleaving or cut-off case: its origin cannot be proven clean).
function turnTainted(rows, policy) {
  const declared = new Set();
  let tainted = false;
  for (const row of rows) {
    if (row?.role !== 'assistant') continue;
    const calls = persistedCalls(row.toolCalls);
    if (calls === undefined) {
      tainted = true;
      continue;
    }
    for (const c of calls) {
      if (typeof c?.id === 'string') declared.add(c.id);
      if (callWithheld(c, policy)) tainted = true;
    }
  }
  if (tainted) return true;
  return rows.some((r) => r?.role === 'tool' && !(typeof r.toolCallId === 'string' && declared.has(r.toolCallId)));
}

/**
 * Cloud history for the assistant: the earlier USER prompts only, minus every turn that used a withheld
 * tool and every later turn. The prompt of a withheld turn ("rename my feature: ...") is itself
 * withheld data, so detection runs on the full persisted rows, before assistant and tool rows
 * are dropped. Rows before the first user row (a cut-off turn) are dropped. A user row directly
 * followed by another user row (concurrent runs interleaving) is unresolved: it shares the fate
 * of the turn that follows. Untrusted tool_calls values and tool rows without a declaring
 * assistant call in the same turn taint the turn.
 * @param {Array<object>} rows Persisted rows (`role`, `content`, `toolCalls`, `toolCallId`).
 * @param {AiPolicy} policy
 * @returns {Array<object>} The user rows to send.
 */
export function cloudHistoryUserRows(rows, policy) {
  const list = Array.isArray(rows) ? rows : [];
  const firstUser = list.findIndex((r) => r?.role === 'user');
  if (firstUser === -1) return [];
  const turns = [];
  let turn = null;
  for (const row of list.slice(firstUser)) {
    if (row?.role === 'user') {
      if (turn && turn.rest.length === 0) turn.users.push(row);
      else {
        turn = { users: [row], rest: [] };
        turns.push(turn);
      }
    } else turn.rest.push(row);
  }
  const out = [];
  let tainted = false;
  for (const t of turns) {
    if (!tainted && turnTainted(t.rest, policy)) tainted = true;
    if (tainted) break;
    out.push(...t.users);
  }
  return out;
}

/**
 * The enforcement choke point for cloud calls (local: input returned unchanged).
 * Throws CloudScopeError before anything is sent when the scope is missing or names a
 * withheld category; otherwise returns messages with withheld tool data removed.
 * @param {{ messages: object[], tools?: object[], scope?: { categories?: string[], withheld?: string[] }, policy: AiPolicy }} input
 * @returns {{ messages: object[], tools: object[] | undefined, shared: string[], withheld: string[] }}
 */
export function enforceCloudScope({ messages, tools, scope, policy }) {
  if (!policy.isCloud) return { messages, tools, shared: [], withheld: [] };
  if (!scope || typeof scope !== 'object' || !Array.isArray(scope.categories) || scope.categories.some((c) => typeof c !== 'string')) {
    throw new CloudScopeError('cloud_scope_missing');
  }
  const denied = scope.categories.filter((c) => !isCategoryId(c) || !policy.allows(c));
  if (denied.length) throw new CloudScopeError('cloud_scope_denied', denied);

  const list = Array.isArray(messages) ? messages : [];
  const shared = new Set(scope.categories);
  const withheld = new Set((Array.isArray(scope.withheld) ? scope.withheld : []).filter(isCategoryId));

  const names = new Map();
  for (const m of list) for (const call of toolCallsOf(m)) if (typeof call?.id === 'string') names.set(call.id, callName(call));

  const lastUser = list.map((m) => m?.role).lastIndexOf('user');
  // Earlier turns: a turn that used a withheld tool is dropped whole, and so is every later
  // earlier turn (it may have been answered from the withheld data).
  const keep = new Array(list.length).fill(true);
  let tainted = false;
  let turnStart = -1;
  const flushTurn = (end) => {
    if (turnStart === -1) return;
    if (!tainted) {
      for (let i = turnStart; i < end; i += 1) {
        for (const call of toolCallsOf(list[i])) {
          const cat = toolCategory(callName(call));
          if (cat === undefined) tainted = true;
          else if (Array.isArray(cat)) {
            const denied = cat.filter((c) => !policy.allows(c));
            if (denied.length) {
              tainted = true;
              for (const c of denied) if (isCategoryId(c)) withheld.add(c);
            }
          }
        }
      }
    }
    if (tainted) for (let i = turnStart; i < end; i += 1) keep[i] = false;
    turnStart = -1;
  };
  for (let i = 0; i < Math.max(lastUser, 0); i += 1) {
    if (list[i]?.role === 'system') continue;
    if (list[i]?.role === 'user') {
      flushTurn(i);
      turnStart = i;
    } else if (turnStart === -1) turnStart = i;
  }
  flushTurn(Math.max(lastUser, 0));

  const out = [];
  list.forEach((m, i) => {
    if (!keep[i]) return;
    if (m?.role === 'tool') {
      const name = names.get(m.tool_call_id);
      const cat = name === undefined ? undefined : toolCategory(name);
      if (cat === undefined) {
        out.push({ ...m, content: PLACEHOLDER_ANY });
        return;
      }
      if (cat === null) {
        out.push(m);
        return;
      }
      const denied = cat.filter((c) => !policy.allows(c));
      if (denied.length === 0) {
        for (const c of cat) shared.add(c);
        out.push(m);
      } else {
        for (const c of denied) if (isCategoryId(c)) withheld.add(c);
        out.push({ ...m, content: JSON.stringify(withheldToolResult(denied)) });
      }
      return;
    }
    if (m?.role === 'assistant' && toolCallsOf(m).length) {
      const calls = toolCallsOf(m).map((call) => {
        const cat = toolCategory(callName(call));
        if (cat === null) return call;
        if (Array.isArray(cat) && cat.every((c) => policy.allows(c))) return call;
        return { ...call, function: { ...call.function, arguments: '{}' } };
      });
      out.push({ ...m, tool_calls: calls });
      return;
    }
    out.push(m);
  });
  return { messages: out, tools, shared: inOrder(shared), withheld: inOrder(withheld) };
}

/**
 * Audit meta for a model call: names only, never content. Local and LAN clients record the
 * kind alone; cloud clients also record the host and the shared and withheld category names.
 * @param {{ ai?: { kind?: string, host?: string | null }, dataReport?: () => { shared: string[], withheld: string[] } } | null | undefined} client
 * @returns {{ ai_kind: string, ai_host?: string, shared?: string[], withheld?: string[] }}
 */
export function aiAuditMeta(client) {
  const kind = client?.ai?.kind;
  if (kind !== 'cloud') return { ai_kind: kind === 'lan' ? 'lan' : 'local' };
  const report = typeof client.dataReport === 'function' ? client.dataReport() : { shared: [], withheld: [] };
  return {
    ai_kind: 'cloud',
    ai_host: typeof client.ai.host === 'string' ? client.ai.host : '',
    shared: report.shared,
    withheld: report.withheld,
  };
}
