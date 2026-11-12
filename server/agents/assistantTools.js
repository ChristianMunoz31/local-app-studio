// Assistant tool registry: OpenAI-format tool specs + an executor that reuses the shared data-access
// layer. Read tools are free of side effects; write tools are counted against a per-run cap passed in
// via ctx so a hallucinating model cannot make unbounded changes to real data.
//
// Studio mode offers the read-only tools of server/modules/studio.tools.js (list_features); there is no write
// tool in studio mode. Runtime mode builds its tools from the app spec (server/runtime/assistantTools.js).
//
// To add a Studio tool: add its spec and a case to server/modules/studio.tools.js (and the stub twin), its
// category to toolCategories in server/modules/studio.data.js (cloud data categories: its category, or an array
// of categories when its result spans several, all of which must be shared) and, if it writes, its name to
// WRITE_TOOLS here and a line to describeWrite() in pendingActions.js.
import { withheldToolResult } from '../ai/index.js';
import { NetworkOptInError } from '../netPolicy.js';
import { isDbError } from '../db/errors.js';
import { getAppMode } from '../appMode.js';
import { RUNTIME_TABLE_VERBS } from '@local-app-studio/runtime/server/toolNames.js';
import { STUDIO_TOOLS, runStudioTool } from '../modules/studio.tools.js';
import { clipToolName } from './toolCalls.js';
import {
  buildRuntimeInternalTools,
  buildRuntimeModelTools,
  precheckRuntimeWrite,
  runRuntimeTool,
  runtimeTableIds,
  runtimeWriteToolNames,
} from '@local-app-studio/runtime/server/assistantTools.js';

// A built app (runtime mode) has no Studio tools: its tools come from the app spec (server/runtime/assistantTools.js).
const RUNTIME = getAppMode() === 'runtime';
const RUNTIME_TABLES = RUNTIME ? runtimeTableIds() : [];

export const WRITE_TOOLS = new Set(RUNTIME ? runtimeWriteToolNames(RUNTIME_TABLES) : []);

/** The tools the model is offered. Runtime mode: describe_data, list_records, get_stats and save_record with a `table` enum. */
export const ASSISTANT_TOOLS = RUNTIME ? buildRuntimeModelTools(RUNTIME_TABLES) : STUDIO_TOOLS;

/** The specs a call is validated against: in runtime mode describe_data plus one spec per table and verb. */
export const INTERNAL_TOOLS = RUNTIME ? buildRuntimeInternalTools(RUNTIME_TABLES) : ASSISTANT_TOOLS;

/**
 * Joins whole names with ", " up to `max` characters; a name that would not fit whole is left out, never cut.
 * @param {string[]} names
 * @param {number} max
 * @returns {string}
 */
export const joinWholeNames = (names, max) =>
  names.reduce((list, name) => {
    const next = list ? `${list}, ${name}` : name;
    return next.length <= max ? next : list;
  }, '');

/**
 * Rewrites a runtime call to a generic verb to its canonical per-table name (`list_records` + table crews becomes
 * `list_records__crews`) so validation, the cloud policy, parking and history all see one category per table. A bad
 * `table` marks the call with an error. Studio mode and canonical names pass through unchanged.
 * @template {{ name: string, args?: Record<string, unknown>, error?: string }} T
 * @param {T} call
 * @returns {T}
 */
export function canonicalizeToolCall(call) {
  if (!RUNTIME || !call || !RUNTIME_TABLE_VERBS.includes(call.name)) return call;
  const { table, ...rest } = call.args ?? {};
  if (typeof table === 'string' && RUNTIME_TABLES.includes(table)) {
    return { ...call, name: `${call.name}__${table}`, args: rest };
  }
  if (call.error) return call;
  const clipped = clipToolName(call.name);
  const did = clipped.startsWith('save_record') ? 'Nothing was saved.' : 'Nothing was read.';
  const perTable = joinWholeNames(RUNTIME_TABLES.map((t) => `${call.name}__${t}`), 160);
  return {
    ...call,
    error: `Argument "table" must be one of: ${RUNTIME_TABLES.join(', ')}. ${did} Call ${clipped} again with table as one of those names${perTable ? `, or call one of: ${perTable}` : ''}.`,
  };
}

const MAX_TOOL_LIMIT = 100;
// LLM-supplied limits can be fractional, negative or huge: floor, default, and cap them.
export const clampLimit = (value, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TOOL_LIMIT) : fallback;
};

async function dispatch(name, args = {}, policy) {
  if (RUNTIME) {
    if (RUNTIME_TABLE_VERBS.includes(name)) return { error: 'Unknown tool. Name a table.' };
    return await runRuntimeTool(name, args, policy ? { allows: (table) => policy.allows(table) } : {});
  }
  return await runStudioTool(name, args);
}

/**
 * Check a write before it is parked for the user's confirmation, so the user is never asked to
 * approve something that cannot work. Returns the cleaned args or an { error } the model can use
 * to correct its call.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ ok: true, args: Record<string, unknown>, label?: string } | { ok: false, error: string }>}
 */
export async function precheckWrite(name, args = {}) {
  if (RUNTIME) return await precheckRuntimeWrite(name, args);
  // Studio mode has no write tool, so this is not reached today.
  return { ok: true, args };
}

// Fixed text for a failed tool, safe to show the model and the UI. Only the data layer's own
// validation errors (4xx: "Feature not found", ...) pass through, because
// the model needs them to correct its call; anything else (storage, network, upstream
// bodies) is mapped so internal detail never reaches the model or the SSE stream.
export const TOOL_ERRORS = Object.freeze({
  timeout: 'The tool took too long to answer. Try again later.',
  network: 'That data source is turned off in Settings > Network.',
  storage: "The app's database is unavailable right now.",
  upstream: "That data source didn't answer. Try again later.",
  failed: 'The tool failed. Try again later.',
});

// Tools that call a third-party service: their errors can carry upstream text. None today; add
// the names of any network-backed tools you create.
const UPSTREAM_TOOLS = new Set([]);

/**
 * @param {string} name Tool name.
 * @param {unknown} err
 * @returns {string}
 */
export function toolErrorMessage(name, err) {
  if (err?.isToolTimeout) return TOOL_ERRORS.timeout;
  if (err instanceof NetworkOptInError) return TOOL_ERRORS.network;
  if (isDbError(err)) return TOOL_ERRORS.storage;
  if (UPSTREAM_TOOLS.has(name)) return TOOL_ERRORS.upstream;
  const status = Number(err?.status);
  if ((status === 400 || status === 404) && typeof err?.message === 'string') return err.message.slice(0, 200);
  return TOOL_ERRORS.failed;
}

// Execute one tool. ctx = { writeCount, writeCap, policy? }; writeCount is mutated on a
// successful write so the loop can enforce the cap across rounds. With ctx.policy (a cloud AI
// run) this is the second layer behind the agent loop: a tool whose category the policy
// withholds returns the not-shared placeholder and never runs.
export async function executeTool(name, args, ctx = {}) {
  if (ctx.policy) {
    const decision = ctx.policy.toolDecision(name, args);
    if (!decision.allowed) return withheldToolResult(decision.withheld);
    args = decision.args;
  }
  const isWrite = WRITE_TOOLS.has(name);
  if (isWrite) {
    const cap = ctx.writeCap ?? 3;
    if ((ctx.writeCount ?? 0) >= cap) {
      return {
        error: `Write limit (${cap}) reached for this turn. Summarize what you changed and ask the user before making more changes.`,
      };
    }
  }
  const timeoutMs = Number(process.env.ASSISTANT_TOOL_TIMEOUT_MS) || 12000;
  let timer;
  try {
    // Writes are local SQLite calls: they are awaited to the end, never raced against a
    // timer, so a write that lands late is still counted toward the cap.
    const work = dispatch(name, args || {}, ctx.policy);
    const result = isWrite
      ? await work
      : await Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('tool timeout'), { isToolTimeout: true })), timeoutMs);
          }),
        ]);
    if (isWrite && !result?.error) ctx.writeCount = (ctx.writeCount ?? 0) + 1;
    return result;
  } catch (err) {
    return { error: toolErrorMessage(name, err) };
  } finally {
    clearTimeout(timer);
  }
}
