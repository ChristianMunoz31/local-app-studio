// Cloud AI: under a cloud client a tool whose category the user did not share returns a not-shared
// placeholder instead of running, and every model call carries a scope the client checks (see
// server/ai/privacy.js). The user gets one notice per turn.
//
// Assistant turn orchestrator: builds context (system prompt + prior turns), runs the tool-calling
// loop on the local tool model, streams progress via onEvent, and persists the turn. Conversation
// access is best-effort (try/catch) so the assistant still works before the assistant_* tables
// exist; it just won't persist.
//
// Robustness for small local models:
//   - tool calls are normalized and validated against the ASSISTANT_TOOLS schema; invalid
//     calls get an { error } tool result instead of running;
//   - tool calls written as text are recovered (toolCalls.extractTextToolCalls);
//   - one corrective retry per run on an empty reply or a broken embedded call;
//   - writes wait for the user's confirmation (ASSISTANT_CONFIRM_WRITES, default on); a write
//     recovered from reply text always waits, whatever that setting says.
import { randomBytes } from 'node:crypto';
import {
  CLOUD_CATEGORY_IDS,
  CloudScopeError,
  cloudHistoryUserRows,
  createAiPolicy,
  createStreamSanitizer,
  getAiClient,
  getCloudCategories,
  isCloudTargetCurrent,
  sanitizeModelText,
  withheldMessage,
  withheldToolResult,
} from '../ai/index.js';
import { ASSISTANT_TOOLS, INTERNAL_TOOLS, WRITE_TOOLS, canonicalizeToolCall, executeTool, precheckWrite } from './assistantTools.js';
import { UNKNOWN_TOOL_SENTENCE, clipToolName, extractTextToolCalls, normalizeToolCalls, refuseTextToolCalls, validateToolArgs } from './toolCalls.js';
import { withNoChangeNote } from './changeClaim.js';
import { readTarget, readVerb, withRefusedReadGuard } from './refusedRead.js';
import { withNumberGround } from './numberGround.js';
import { plainToolWords } from './toolWords.js';
import {
  APPROVED_TOOL_RESULT,
  DECLINED_TOOL_RESULT,
  FAILED_SAVE_TOOL_RESULT,
  confirmWritesEnabled,
  createPendingAction,
  describeWrite,
  takeApprovalSinceLastTurn,
} from './pendingActions.js';
import { assistantSystemPrompt } from './prompts.js';
import { getDisplayName } from '../profile.js';
import * as data from '../dataAccess.js';
import { getAppSpec } from '../spec/source.js';
import { ASSISTANT_PAGE_LABELS, isAssistantPage } from '../assistant/pages.js';
import { log } from '../log.js';

const envInt = (name, fallback) => {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const maxRounds = () => envInt('ASSISTANT_MAX_ROUNDS', 5);
const writeCap = () => envInt('ASSISTANT_WRITE_CAP', 3);
// Must not be shorter than the first-token timeout (APP_AI_FIRST_TOKEN_TIMEOUT_MS, 300 s):
// a cold first round on a CPU-only machine measured 95 to 150 s.
const roundTimeoutMs = () => envInt('ASSISTANT_ROUND_TIMEOUT_MS', 300_000);

const MAX_TOKENS = 1024;
const TEMPERATURE = 0.2;
// Text recovery knows the model's tool names and the canonical per-table ones (a model may copy a name from its history).
const CALL_START_RE = /\{\s*"(?:name|function)"|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\(/;
const TOOL_NAMES = [...new Set([...ASSISTANT_TOOLS, ...INTERNAL_TOOLS].map((t) => t.function.name))];

/**
 * Validate one model call. A call that cannot run is a `refusal` (an unknown name gets the fixed
 * sentence, bad arguments get their own words); otherwise `args` are the cleaned arguments.
 * @param {{ name: string, args?: Record<string, unknown>, error?: string }} call
 * @returns {{ refusal: { reason: 'unknown_tool' | 'invalid_args', error: string } | null, args: Record<string, unknown> }}
 */
function checkCall(call) {
  if (call.error) {
    const known = TOOL_NAMES.includes(call.name);
    return { refusal: known ? { reason: 'invalid_args', error: call.error } : { reason: 'unknown_tool', error: UNKNOWN_TOOL_SENTENCE }, args: {} };
  }
  const v = validateToolArgs(call.name, call.args || {}, INTERNAL_TOOLS);
  return v.ok ? { refusal: null, args: v.args, coerced: v.coerced === true } : { refusal: { reason: v.reason, error: v.error }, args: {} };
}

export const OUT_OF_STEPS_MESSAGE = 'I gathered information but ran out of steps. Ask me to continue.';
export const EMPTY_REPLY_MESSAGE = "I couldn't come up with an answer. Try asking again.";
export const RETRY_NUDGE =
  'Your last reply was empty or contained a broken tool call. Either call a tool with valid JSON arguments using the tool-calling format, or answer the user in plain text.';

// Date only (no time) for the Assistant system prompt: the system text and tool list then stay
// byte-identical all day, so Ollama can reuse its cached prompt prefix between requests.
// On a CPU-only machine that prefix (about 1,600 tokens) costs over a minute to evaluate.
// Server-local day.
const todayString = () => {
  const d = new Date();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const pad = (n) => String(n).padStart(2, '0');
  return `${weekday}, ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Reconstruct OpenAI-format messages from persisted rows.
const toLlmMessage = (m) => {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content || '' };
  if (m.role === 'assistant' && m.toolCalls) {
    return { role: 'assistant', content: m.content || '', tool_calls: m.toolCalls };
  }
  return { role: m.role, content: m.content || '' };
};

// The only words that may replace a parked call's placeholder: what the server wrote after the person answered.
const ANSWER_SENTENCES = new Set([DECLINED_TOOL_RESULT, APPROVED_TOOL_RESULT, FAILED_SAVE_TOOL_RESULT]);
// A parked call's own result: the object the loop stored, not a record whose text happens to hold the word.
const isPlaceholder = (content) => {
  try {
    return JSON.parse(content)?.status === 'awaiting_confirmation';
  } catch {
    return false;
  }
};

/**
 * Persisted rows -> model messages. A later tool row for the same call (a confirmed or
 * declined write) replaces the earlier "awaiting_confirmation" one. The history window can start
 * mid-turn, so every row before the first user row (an assistant reply or tool result whose turn
 * was cut off) is dropped.
 *
 * Under a cloud client (`cloud: true`) only earlier user messages are kept. assistant_messages has no
 * column that records which model wrote a row, so an earlier assistant or tool row cannot be told
 * apart from one a local model produced from withheld data, and none is sent. The
 * user prompt of a turn that used a withheld tool (or any later turn) is withheld too, so that
 * check runs on the full rows first (`policy`, default cloud categories when omitted).
 * `taintRows` (role, tool_calls, tool_call_id of the whole conversation) extends that check
 * beyond the history window.
 * @param {Array<object>} rows
 * @param {{ cloud?: boolean, policy?: object, taintRows?: Array<object> }} [opts]
 * @returns {Array<object>}
 */
export function historyToMessages(rows, { cloud = false, policy, taintRows } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (cloud) {
    const pol = policy ?? createAiPolicy({ isCloud: true });
    let windowed = cloudHistoryUserRows(list, pol);
    if (taintRows !== undefined) {
      // Whole-conversation check: only rows strictly before the first tainted turn survive.
      const clean = new Set(cloudHistoryUserRows(taintRows, pol).map((r) => r.id));
      windowed = windowed.filter((r) => clean.has(r.id));
    }
    return windowed.map(toLlmMessage);
  }
  const firstUser = list.findIndex((r) => r?.role === 'user');
  if (firstUser === -1) return [];
  const out = [];
  const toolIndex = new Map();
  for (const row of list.slice(firstUser)) {
    const msg = toLlmMessage(row);
    // Only a parked call's placeholder is replaced, and only by the server's own sentence for the answer (call ids are unique
    // per turn, but rows stored before that may repeat): a read result never overwrites an earlier row.
    if (msg.role === 'tool' && msg.tool_call_id && ANSWER_SENTENCES.has(msg.content) && toolIndex.has(msg.tool_call_id) && isPlaceholder(out[toolIndex.get(msg.tool_call_id)].content)) {
      out[toolIndex.get(msg.tool_call_id)] = msg;
      continue;
    }
    if (msg.role === 'tool' && msg.tool_call_id) toolIndex.set(msg.tool_call_id, out.length);
    out.push(msg);
  }
  return out;
}

const persist = async (conversationId, msg) => {
  if (!conversationId) return;
  try {
    await data.appendMessage(conversationId, msg);
  } catch {
    // local database unavailable: chat continues without history
  }
};

/**
 * Run one assistant turn.
 * @param {{ conversationId?: string|null, prompt: string, page?: string|null, onEvent?: (e: object) => void,
 *   abort?: { aborted?: boolean }, signal?: AbortSignal, client?: object }} opts
 *   `client` is the tools AiClient (resolved here when omitted).
 * @returns {Promise<{ finalAnswer: string, provider: string, model: string, ai: object | null, writes: number, pending: number, calls: number, aborted?: boolean }>}
 */
export async function runAssistant({ conversationId, prompt, page, onEvent, abort = {}, signal, client }) {
  const ai = client || (await getAiClient({ purpose: 'tools' }));
  const policy = ai.policy ?? createAiPolicy({ isCloud: false });
  const isCloud = policy.isCloud;
  const summary = (extra = {}) => ({
    provider: ai.provider,
    model: ai.model,
    ai: ai.ai ?? null,
    writes: ctx.writeCount,
    pending,
    calls: ai.stats?.calls ?? 0,
    ...extra,
  });

  // Category names this turn's tool calls used or were refused (cloud only), for the call
  // scope and the one withheld notice.
  const sharedNow = new Set();
  const withheldNow = new Set();
  const inOrder = (set) => CLOUD_CATEGORY_IDS.filter((id) => set.has(id));
  const callScope = () => ({ categories: inOrder(sharedNow), withheld: inOrder(withheldNow) });
  let noticeSent = false;
  const emitNotice = () => {
    if (noticeSent || withheldNow.size === 0) return;
    noticeSent = true;
    const categories = inOrder(withheldNow);
    onEvent?.({ type: 'notice', code: 'cloud_withheld', categories, message: withheldMessage(categories) });
  };

  let history = [];
  let taintRows;
  if (conversationId) {
    try {
      history = await data.getMessages(conversationId, { limit: 30 });
    } catch {
      /* no messages table yet */
    }
    if (isCloud) {
      try {
        taintRows = await data.getConversationTaintRows(conversationId);
      } catch {
        // fail closed: without the whole conversation no earlier prompt goes to the cloud
        history = [];
      }
    }
  }

  const displayName = await getDisplayName();
  const messages = [{ role: 'system', content: assistantSystemPrompt({ now: todayString(), displayName }) }];
  messages.push(...historyToMessages(history, { cloud: isCloud, policy, taintRows }));
  // The page is a hint for the model only: the persisted turn and the audit context stay the bare prompt.
  const pageLabel = isAssistantPage(page) && policy.pageDecision(page).allowed ? ASSISTANT_PAGE_LABELS[page] : null;
  messages.push({ role: 'user', content: pageLabel ? `(I'm on the ${pageLabel} page.)\n${prompt}` : prompt });
  await persist(conversationId, { role: 'user', content: prompt });

  const ctx = { writeCount: 0, writeCap: writeCap(), ...(isCloud ? { policy } : {}) };
  const confirmWrites = confirmWritesEnabled();
  let finalText = '';
  let pending = 0;
  let retried = false;
  // Read tool runs of this turn (table, whether it ran, the refusal sentence): a reply with a number after a refused read is replaced.
  const reads = [];
  // An approval since the previous turn made a change outside this loop: a claim about it may be true.
  const approvedSinceLastTurn = takeApprovalSinceLastTurn(conversationId);
  // Every tool result of this turn: the only numbers (besides the person's own) a reply may hold.
  const results = [];
  // Call ids are unique across turns (a model may reuse "call_0"): a stored row is matched to its call by id.
  const runTag = randomBytes(4).toString('hex');
  let callSeq = 0;
  const tableLabel = (id) => getAppSpec()?.tables?.find((t) => t.id === id)?.label ?? id.replace(/_/g, ' ');
  // A tool call written as text that nothing ran (an unknown tool) is never shown as the answer.
  const withoutTextCalls = (text) => {
    const refused = refuseTextToolCalls(text, TOOL_NAMES);
    refused.names.forEach((name) => log('warn', 'assistant.tool_refused', { name: clipToolName(name), reason: 'text_call' }));
    return refused.text;
  };
  const guard = (text) =>
    plainToolWords(
      withNoChangeNote(withNumberGround(withRefusedReadGuard(withoutTextCalls(text), reads), { results, prompt: `${prompt} ${todayString()}` }), {
        wrote: ctx.writeCount > 0,
        parked: pending > 0,
        readOk: reads.some((r) => r.ok),
        approved: approvedSinceLastTurn,
      }),
      tableLabel,
    );
  const aborted = () => abort.aborted || signal?.aborted;
  // The client was built from the settings of the moment the run started. A run can take minutes,
  // so before every model round look again: cloud turned off, or a category this turn already used
  // withheld since, stops the run (nothing more is sent) instead of continuing on stale choices.
  const recheckCloud = async () => {
    if (!isCloud) return;
    // Same destination as the client was built for (base URL, host, model), not just "some cloud".
    // A cloud client without a target cannot be verified, so it fails closed.
    const stillTarget = ai.cloudTarget ? await isCloudTargetCurrent(ai.cloudTarget) : false;
    if (!stillTarget) throw new CloudScopeError('cloud_disabled');
    const current = await getCloudCategories();
    const denied = inOrder(sharedNow).filter((c) => !current[c]);
    if (denied.length) throw new CloudScopeError('cloud_scope_denied', denied);
  };

  try {
    let round = 0;
    while (round < maxRounds()) {
      if (aborted()) return { finalAnswer: finalText, aborted: true, ...summary() };
      await recheckCloud();
      onEvent?.({ type: 'thinking', round });

      // Stream visible text as deltas, but hold a round that starts like an embedded
      // tool call (<tool_call>, JSON, a code fence) so raw JSON never flashes in the UI.
      const sanitizer = createStreamSanitizer();
      let raw = '';
      let held = null;
      // Once the text reads like a call (a name or function key, or a tool-like name and "("), no more
      // deltas go out for this reply; the final event carries the guarded text.
      let stopped = false;
      const emit = (text) => {
        if (text && !stopped) onEvent?.({ type: 'delta', round, content: text });
      };
      const onToken = (t) => {
        raw += t;
        if (!stopped && CALL_START_RE.test(raw)) stopped = true;
        if (held === null) {
          const start = raw.trimStart();
          if (!start) return;
          held = /^[<{[`]/.test(start);
          if (!held) emit(sanitizer.push(raw));
          return;
        }
        if (!held) emit(sanitizer.push(t));
      };

      const { message } = await ai.chatWithTools({
        messages,
        tools: ASSISTANT_TOOLS,
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        signal,
        timeoutMs: roundTimeoutMs(),
        onToken,
        scope: callScope(),
      });
      if (held === false) emit(sanitizer.flush());

      let calls = normalizeToolCalls(message.tool_calls);
      const rawContent = typeof message.content === 'string' ? message.content : '';
      let content = rawContent;
      let broken = false;
      if (calls.length === 0) {
        const found = extractTextToolCalls(rawContent, TOOL_NAMES);
        // Embedded <tool_call> tags are never shown to the user.
        content = found.text;
        broken = found.malformed;
        if (found.calls.length) {
          calls = found.calls.map((c, i) => ({
            id: `call_r${round}_${i}`,
            name: c.name,
            args: c.arguments,
            fromText: true,
            ...(c.error ? { error: c.error } : {}),
          }));
        } else if ((broken || !content.trim()) && !retried) {
          retried = true;
          messages.push({ role: 'assistant', content: rawContent });
          messages.push({ role: 'system', content: RETRY_NUDGE });
          continue;
        }
      }
      // Runtime mode: a call to a generic verb becomes its canonical per-table name, before anything else sees it.
      calls = calls.map(canonicalizeToolCall).map((c) => ({ ...c, id: `call_${runTag}_${callSeq++}` }));
      // A broken tool call that survived the retry is never shown as the answer.
      if (calls.length === 0 && broken) content = '';

      if (calls.length === 0) {
        finalText = guard(sanitizeModelText(content).trim() || EMPTY_REPLY_MESSAGE);
        emitNotice();
        onEvent?.({ type: 'final', content: finalText });
        await persist(conversationId, { role: 'assistant', content: finalText });
        break;
      }

      // Check every call before it is echoed anywhere. A refused call (unknown name, bad arguments)
      // runs nothing; its name is clipped and its arguments are dropped wherever it is shown or kept.
      const checked = calls.map((c) => checkCall(c));
      checked.forEach((chk, i) => {
        if (chk.refusal) log('warn', 'assistant.tool_refused', { name: clipToolName(calls[i].name), reason: chk.refusal.reason });
      });
      const toolCalls = calls.map((c, i) => ({
        id: c.id,
        type: 'function',
        function: checked[i].refusal
          ? { name: clipToolName(c.name), arguments: '{}' }
          : { name: c.name, arguments: JSON.stringify(c.args || {}) },
      }));
      messages.push({ role: 'assistant', content, tool_calls: toolCalls });
      await persist(conversationId, { role: 'assistant', content, toolCalls });

      const parked = [];
      for (const [i, call] of calls.entries()) {
        if (aborted()) return { finalAnswer: finalText, aborted: true, ...summary() };
        const { refusal } = checked[i];
        let result;
        let args = refusal ? {} : checked[i].args;
        if (refusal) result = { error: refusal.error };
        const shownName = refusal ? clipToolName(call.name) : call.name;
        onEvent?.({ type: 'tool.start', id: call.id, name: shownName, args });
        // Cloud: a tool that reads or writes a category the user did not share never runs, is
        // never parked, and answers with the not-shared placeholder.
        if (!result) {
          const decision = policy.toolDecision(call.name, args);
          for (const c of decision.withheld) withheldNow.add(c);
          ai.noteWithheld?.(decision.withheld);
          if (decision.allowed) {
            args = decision.args;
            for (const c of decision.categories) sharedNow.add(c);
          } else {
            result = withheldToolResult(decision.withheld);
          }
        }
        // Text-recovered writes (and native calls whose arguments had to be unwrapped or parsed from a JSON string) are always
        // confirmed: reply text can echo stored data, and a reshaped call is not what the model sent.
        if (!result && WRITE_TOOLS.has(call.name) && (confirmWrites || call.fromText || call.recovered || checked[i].coerced)) {
          if (ctx.writeCount + parked.length >= ctx.writeCap) {
            result = {
              error: `Write limit (${ctx.writeCap}) reached for this turn. Summarize what you changed and ask the user before making more changes.`,
            };
          } else {
            const pre = await precheckWrite(call.name, args);
            if (!pre.ok) {
              // Hand the candidates back so a small model can retry with a real id.
              result = { ...pre };
              delete result.ok;
            } else {
              args = pre.args;
              const what = describeWrite(call.name, args);
              const token = createPendingAction({ conversationId: conversationId || null, name: call.name, args, callId: call.id, ctx });
              parked.push({ token, name: call.name, args, summary: what });
              result = { status: 'awaiting_confirmation', summary: what };
              onEvent?.({ type: 'confirm.required', token, name: call.name, args, summary: what });
            }
          }
        }
        if (!result) result = await executeTool(call.name, args, ctx);
        onEvent?.({ type: 'tool.done', id: call.id, name: shownName, result });
        const target = readTarget(call.name);
        if (target) reads.push({ table: target.table, verb: readVerb(call.name), ok: !refusal && result?.error === undefined, ...(refusal ? { refusal: refusal.error } : {}) });
        if (!refusal) log('info', 'assistant.tool', { name: clipToolName(call.name), ok: result?.error === undefined });
        results.push(result);
        const toolContent = JSON.stringify(result);
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent });
        await persist(conversationId, { role: 'tool', content: toolContent, toolCallId: call.id });
      }

      if (parked.length) {
        pending = parked.length;
        finalText = `Confirm to go ahead: ${parked.map((p) => p.summary).join('; ')}.`;
        emitNotice();
        onEvent?.({ type: 'final', content: finalText });
        await persist(conversationId, { role: 'assistant', content: finalText });
        break;
      }
      round += 1;
    }
  } catch (err) {
    // Lets the route audit a failed run with the provider and model that were in use.
    if (err !== null && typeof err === 'object') {
      err.auditProvider = ai.provider;
      err.auditModel = ai.model;
      err.auditCalls = ai.stats?.calls ?? 0;
      err.auditReport = typeof ai.dataReport === 'function' ? ai.dataReport() : null;
    }
    throw err;
  }

  // Ran out of rounds with tools still pending: one final no-tools pass to answer.
  if (!finalText && !aborted()) {
    await recheckCloud().catch((err) => {
      err.auditProvider = ai.provider;
      err.auditModel = ai.model;
      err.auditCalls = ai.stats?.calls ?? 0;
      err.auditReport = typeof ai.dataReport === 'function' ? ai.dataReport() : null;
      throw err;
    });
    try {
      const { message } = await ai.chatWithTools({
        messages,
        tools: [],
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        signal,
        timeoutMs: roundTimeoutMs(),
        scope: callScope(),
      });
      finalText = guard(sanitizeModelText(message.content || '').trim() || OUT_OF_STEPS_MESSAGE);
    } catch (err) {
      // A refused cloud send (cloud turned off or a category withheld since the recheck above) is
      // not "out of steps": rethrow so the route answers with the fixed cloud copy. Any other
      // failure keeps the out-of-steps answer.
      if (err instanceof CloudScopeError) {
        err.auditProvider = ai.provider;
        err.auditModel = ai.model;
        err.auditCalls = ai.stats?.calls ?? 0;
        err.auditReport = typeof ai.dataReport === 'function' ? ai.dataReport() : null;
        throw err;
      }
      finalText = OUT_OF_STEPS_MESSAGE;
    }
    emitNotice();
    onEvent?.({ type: 'final', content: finalText });
    await persist(conversationId, { role: 'assistant', content: finalText });
  }

  onEvent?.({ type: 'run.done', model: ai.model, ai: ai.ai ?? null, writes: ctx.writeCount, pending });
  return { finalAnswer: finalText, ...summary() };
}
