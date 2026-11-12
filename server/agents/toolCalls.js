// Tool-call hygiene for small local models: normalize native tool calls, validate their
// arguments against the tool's JSON schema, and recover calls a model wrote as text
// (<tool_call>{...}</tool_call>; a fenced json block or bare JSON only when it is the whole
// reply, or the first object of a copied, unfinished tool list). Small models also nest a call wrapper or echo the tool schema inside the arguments;
// those are unwrapped and flagged `recovered`. Argument objects never carry __proto__ / constructor / prototype keys.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Keys that reach an object's prototype when copied with plain assignment.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ARG_DEPTH = 20;
const UNSAFE_ARGS_ERROR = 'Tool arguments use a reserved key name.';

/**
 * True when `value` (parsed JSON) has an unsafe key at any depth, or nests too deeply.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {boolean}
 */
export function hasUnsafeKeys(value, depth = 0) {
  if (depth > MAX_ARG_DEPTH) return true;
  if (Array.isArray(value)) return value.some((v) => hasUnsafeKeys(v, depth + 1));
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key) || hasUnsafeKeys(value[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Parse tool arguments (object, JSON string, or empty) into an object.
 * @param {unknown} raw
 * @returns {{ ok: true, args: Record<string, unknown>, coerced?: true } | { ok: false, error: string }}
 */
export function parseToolArgs(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, args: {} };
  let v = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Tool arguments must be a JSON object.' };
    }
    if (v === null) return { ok: true, args: {} };
  }
  if (!isPlainObject(v)) return { ok: false, error: 'Tool arguments must be a JSON object.' };
  if (hasUnsafeKeys(v)) return { ok: false, error: UNSAFE_ARGS_ERROR };
  return { ok: true, args: v };
}

const cleanName = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Name and raw arguments of one call object as written, in any shape small models emit:
 * `{ function: { name, arguments | parameters } }` (OpenAI), the same with an extra top-level
 * `parameters`, `{ name, arguments | parameters | args }`, and `{ function: "name", ... }`.
 * @param {unknown} obj
 * @returns {{ name: string, rawArgs: unknown }}
 */
function rawCallParts(obj) {
  if (!isPlainObject(obj)) return { name: '', rawArgs: undefined };
  const fn = obj.function;
  if (isPlainObject(fn)) {
    return {
      name: cleanName(fn.name) || cleanName(obj.name),
      rawArgs: fn.arguments ?? fn.parameters ?? obj.arguments ?? obj.parameters ?? obj.args ?? fn.args,
    };
  }
  return {
    name: cleanName(obj.name) || cleanName(fn),
    rawArgs: obj.arguments ?? obj.parameters ?? obj.args,
  };
}

// An argument value as an object when it is one (or a JSON string of one); undefined otherwise.
const asObject = (v) => {
  if (isPlainObject(v)) return v;
  if (typeof v !== 'string') return undefined;
  try {
    const parsed = JSON.parse(v);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const ARG_KEYS = ['arguments', 'parameters', 'args'];
// A call wrapper copied into the arguments: { type: 'function', function: 'x' | { name }, parameters }.
// Tool parameters must not be named like these keys (enforced by assistantToolArgNames.test.js),
// so this never swallows real arguments.
const isCallWrapper = (o) =>
  isPlainObject(o) &&
  (typeof o.function === 'string' || isPlainObject(o.function) || (typeof o.name === 'string' && ARG_KEYS.some((k) => Object.hasOwn(o, k))));
// The tool's own schema echoed back as arguments: { type: 'object', properties: {...} }.
const isSchemaEcho = (o) => isPlainObject(o) && (o.type === 'object' || isPlainObject(o.properties));

/**
 * Clean the arguments of one call: unwrap a call wrapper nested inside them (one level), then
 * drop a schema echo. Ollama's native calls from small models arrive like
 * `arguments: { type: 'function', function: 'list_features', parameters: { query: 'kpi' } }`.
 * `recovered` is true when the model's own words were reshaped (a wrapper unwrapped or a schema
 * echo dropped), so the caller can treat the call like one recovered from text.
 * @param {string} name
 * @param {unknown} rawArgs
 * @returns {{ name: string, rawArgs: unknown, recovered: boolean }}
 */
function cleanCallArgs(name, rawArgs) {
  let obj = asObject(rawArgs);
  if (obj === undefined) return { name, rawArgs, recovered: false };
  let outName = name;
  let outRaw = rawArgs;
  let recovered = false;
  if (isCallWrapper(obj)) {
    const inner = rawCallParts(obj);
    outName = name || inner.name;
    outRaw = inner.rawArgs;
    recovered = true;
    obj = asObject(outRaw);
    if (obj === undefined) return { name: outName, rawArgs: outRaw, recovered };
  }
  if (isSchemaEcho(obj)) return { name: outName, rawArgs: undefined, recovered: true };
  return { name: outName, rawArgs: outRaw, recovered };
}

function callParts(obj) {
  const { name, rawArgs } = rawCallParts(obj);
  return cleanCallArgs(name, rawArgs);
}

/**
 * OpenAI-shaped (or wrapper-shaped, see callParts) tool calls ->
 * [{ id, name, args, error?, recovered? }]. `recovered: true` marks a call whose arguments were
 * unwrapped or stripped of an echoed schema, or whose name came from a fallback position: the
 * agent parks a recovered write for confirmation even when direct writes are on.
 * @param {unknown} calls
 * @returns {Array<{ id: string, name: string, args: Record<string, unknown>, error?: string, recovered?: true }>}
 */
export function normalizeToolCalls(calls) {
  if (!Array.isArray(calls)) return [];
  return calls
    .filter((c) => c && typeof c === 'object')
    .map((c, i) => {
      const { name, rawArgs, recovered: cleaned } = callParts(c);
      const id = typeof c.id === 'string' && c.id ? c.id : `call_${i}`;
      const standardName = name !== '' && isPlainObject(c.function) && cleanName(c.function.name) === name;
      const parsed = parseToolArgs(rawArgs);
      const base = parsed.ok ? { id, name, args: parsed.args } : { id, name, args: {}, error: parsed.error };
      return name && (cleaned || !standardName) ? { ...base, recovered: true } : base;
    });
}

/** The one sentence a refused (unknown) tool call gets; it never repeats the model's text. */
export const UNKNOWN_TOOL_SENTENCE = 'That tool is not available here, so nothing was done.';

const TOOL_NAME_ECHO_MAX = 64;

/**
 * A model-sent tool name made safe to echo (events, history, logs): a string of at most 64 characters.
 * @param {unknown} name
 * @returns {string}
 */
export const clipToolName = (name) => (typeof name === 'string' ? name.slice(0, TOOL_NAME_ECHO_MAX) : '');

const article = (type) => (type === 'integer' || type === 'object' || type === 'array' ? 'an' : 'a');

/**
 * The closing words of a refused argument: what ran (nothing) and how to call again. A write tool says "saved".
 * @param {string} name tool name
 * @param {string} key argument name
 * @param {string} type the JSON type the argument must have
 * @param {boolean} required a required argument cannot be left out
 * @returns {string}
 */
export function retryWords(name, key, type, required = false) {
  const clipped = clipToolName(name);
  const did = clipped.startsWith('save_record') ? 'Nothing was saved.' : 'Nothing was read.';
  return ` ${did} Call ${clipped} again with ${key} as ${article(type)} ${type}${required ? '' : ', or without it'}.`;
}

const typeOk = (schema, value) => {
  switch (schema?.type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return true;
  }
};

// Small models often send "7" for an integer, "true" for a boolean or '{"status":"active"}' for an object: coerce those
// only. An array, null or a non-JSON string stays as sent and fails the type check.
const coerce = (schema, value) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if ((schema?.type === 'integer' || schema?.type === 'number') && /^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return schema.type === 'integer' && !Number.isInteger(n) ? value : n;
  }
  if (schema?.type === 'boolean' && (t === 'true' || t === 'false')) return t === 'true';
  if (schema?.type === 'object' && t.startsWith('{')) return asObject(t) ?? value;
  return value;
};

/**
 * Validate (and lightly coerce) arguments against a tool's parameters schema:
 * required keys, primitive types, enums, array item types, additionalProperties:false.
 * Optional keys sent as null or "" are dropped.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {Array<{ function: { name: string, parameters?: object } }>} tools
 * @returns {{ ok: true, args: Record<string, unknown> } | { ok: false, error: string, reason: 'unknown_tool' | 'invalid_args' }}
 */
export function validateToolArgs(name, args, tools) {
  const tool = (Array.isArray(tools) ? tools : []).find((t) => t?.function?.name === name);
  if (!tool) return { ok: false, error: UNKNOWN_TOOL_SENTENCE, reason: 'unknown_tool' };
  const v = checkToolArgs(name, args, tool);
  return v.ok ? v : { ...v, reason: 'invalid_args' };
}

function checkToolArgs(name, args, tool) {
  const schema = tool.function.parameters || { type: 'object', properties: {} };
  const props = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!isPlainObject(args)) return { ok: false, error: 'Tool arguments must be a JSON object.' };
  if (hasUnsafeKeys(args)) return { ok: false, error: UNSAFE_ARGS_ERROR };

  // Own-property lookups only: a key like "__proto__" or "toString" must never resolve to
  // something inherited from Object.prototype.
  const out = {};
  let coerced = false;
  for (const [key, raw] of Object.entries(args)) {
    const prop = Object.hasOwn(props, key) ? props[key] : null;
    if (!isPlainObject(prop)) {
      if (schema.additionalProperties === false) {
        return {
          ok: false,
          error: `Unknown argument "${key}" for ${name}. Allowed: ${Object.keys(props).join(', ') || 'none'}. Call ${name} again without it.`,
        };
      }
      continue;
    }
    if ((raw === null || raw === '') && !required.includes(key)) continue;
    const value = coerce(prop, raw);
    // An object parsed out of a JSON string is a reshaped call: the caller treats it like a recovered one.
    if (prop.type === 'object' && typeof raw === 'string' && isPlainObject(value)) coerced = true;
    if (hasUnsafeKeys(value)) return { ok: false, error: UNSAFE_ARGS_ERROR };
    if (!typeOk(prop, value)) {
      return { ok: false, error: `Argument "${key}" for ${name} must be ${article(prop.type)} ${prop.type}.${retryWords(name, key, prop.type, required.includes(key))}` };
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      return { ok: false, error: `Argument "${key}" for ${name} must be one of: ${prop.enum.join(', ')}.` };
    }
    if (prop.type === 'array' && prop.items) {
      for (const item of value) {
        if (!typeOk(prop.items, item) || (Array.isArray(prop.items.enum) && !prop.items.enum.includes(item))) {
          return { ok: false, error: `Argument "${key}" for ${name} has an invalid item.` };
        }
      }
    }
    out[key] = value;
  }
  for (const key of required) {
    if (!Object.hasOwn(out, key) || out[key] === undefined) {
      return { ok: false, error: `Missing required argument "${key}" for ${name}.` };
    }
  }
  return coerced ? { ok: true, args: out, coerced: true } : { ok: true, args: out };
}

const TOOL_CALL_TAG_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const FENCED_JSON_RE = /```(?:json)?\s*([[{][\s\S]*?[\]}])\s*```/gi;
// One fenced block and nothing else.
const WHOLE_FENCE_RE = /^```(?:json)?\s*([[{][\s\S]*[\]}])\s*```$/i;

const toCall = (obj, known) => {
  const { name, rawArgs } = callParts(obj);
  if (!name || !known.has(name)) return null;
  const parsed = parseToolArgs(rawArgs ?? {});
  return { name, arguments: parsed.ok ? parsed.args : {}, ...(parsed.ok ? {} : { error: parsed.error }) };
};

const looksLikeCall = (text) => /"(?:name|function)"\s*:/.test(text);

/**
 * The first complete top-level JSON object at the start of `text` (braces inside strings do not
 * count), or null while it is unfinished.
 * @param {string} text
 * @returns {string | null}
 */
function firstJsonObject(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  return null;
}

function parseCalls(jsonText, known) {
  let v;
  try {
    v = JSON.parse(jsonText);
  } catch {
    return { calls: [], malformed: looksLikeCall(jsonText) };
  }
  const list = Array.isArray(v) ? v : [v];
  const calls = list.map((o) => toCall(o, known)).filter(Boolean);
  return { calls, malformed: false };
}

/**
 * Find tool calls a model wrote as text instead of using native tool calling.
 * Only known tool names count. Matched text is stripped from the returned text.
 * <tool_call> blocks are recovered anywhere in the reply; a fenced json block or bare JSON
 * only when it is the entire reply, so prose that quotes JSON (from a note, say) is never
 * run. The one exception is a copied tool list that runs on unfinished: the leading object
 * counts when only list punctuation follows it. A fenced call mixed with prose is reported as malformed instead.
 * Callers must treat every recovered write as needing the user's confirmation.
 * @param {string} content
 * @param {Iterable<string>} knownNames
 * @returns {{ calls: Array<{ name: string, arguments: Record<string, unknown> }>, text: string, malformed: boolean }}
 */
export function extractTextToolCalls(content, knownNames) {
  const known = new Set(knownNames);
  const text = typeof content === 'string' ? content : '';
  if (!text.trim()) return { calls: [], text, malformed: false };

  const calls = [];
  let malformed = false;
  let rest;

  // Small models sometimes drop the opening tag: `{...}\n</tool_call>`. Restore it only when
  // the reply starts with that JSON; a stray closing tag after prose is a broken call.
  const trimmedAll = text.trim();
  const firstClose = trimmedAll.search(/<\/tool_call>/i);
  const firstOpen = trimmedAll.search(/<tool_call>/i);
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    if (trimmedAll.startsWith('{')) return extractTextToolCalls(`<tool_call>${trimmedAll}`, known);
    return { calls: [], text: text.replace(/<\/?tool_call>/gi, '').trim(), malformed: true };
  }

  if (/<tool_call>/i.test(text)) {
    rest = text.replace(TOOL_CALL_TAG_RE, (_m, inner) => {
      calls.push(...parseCalls(inner, known).calls);
      return '';
    });
    // An opening tag that never closed is dropped from the visible text.
    rest = rest.replace(/<tool_call>[\s\S]*$/i, '');
    // Tags that yielded no known tool (bad JSON, an unclosed tag, or an invented name)
    // count as a broken call.
    return { calls, text: rest.trim(), malformed: calls.length === 0 };
  }

  const trimmed = text.trim();
  const whole = WHOLE_FENCE_RE.exec(trimmed);
  if (whole) {
    const r = parseCalls(whole[1], known);
    if (r.calls.length) return { calls: r.calls, text: '', malformed: false };
    if (r.malformed) malformed = true;
  } else if (/```/.test(text)) {
    // Fenced JSON inside prose is never run; if it looks like a call, ask for a clean retry.
    for (const m of text.matchAll(FENCED_JSON_RE)) {
      const r = parseCalls(m[1], known);
      if (r.calls.length || r.malformed) malformed = true;
    }
  }

  if (/^[[{]/.test(trimmed) && /[\]}]$/.test(trimmed)) {
    const r = parseCalls(trimmed, known);
    if (r.calls.length) return { calls: r.calls, text: '', malformed: false };
    if (r.malformed) malformed = true;
  }
  // A model that copies the tool list as text writes `{"type":"function","function":{"name":...`
  // and runs on until the token cap, so the reply never ends in "}". Its first complete object
  // is the call (the schema it echoes as parameters is dropped). Only a reply that starts with
  // the object counts, only a known tool name, and only when what follows the object continues
  // the copied list (nothing, or a `,` `{` `[` `]`). JSON followed by prose is never run.
  if (trimmed.startsWith('{')) {
    const first = firstJsonObject(trimmed);
    if (first && /^\s*(?:$|[,{[\]])/.test(trimmed.slice(first.length))) {
      const r = parseCalls(first, known);
      if (r.calls.length) return { calls: r.calls, text: '', malformed: false };
    }
  }
  return { calls: [], text, malformed };
}

const FENCE_BLOCK_RE = /```[a-z]*[ \t]*\r?\n?([\s\S]*?)```/gi;
const FENCE_SPLIT_RE = /(```[\s\S]*?```)/;
const NAME_TEXT_RE = /"(?:name|function)"\s*:\s*"([^"]*)"/;
const ARGS_TEXT_RE = /"(?:arguments|parameters|args)"\s*:/;
// Wider keys read only for a name that looks like a tool name (snake case with an underscore).
const WIDE_NAME_TEXT_RE = /"(?:name|function|tool)"\s*:\s*"([^"]*)"/;
const WIDE_ARGS_TEXT_RE = /"(?:arguments|parameters|args|input|command)"\s*:/;
const WIDE_NAME_KEYS = ['name', 'function', 'tool'];
const WIDE_ARG_KEYS = ['arguments', 'parameters', 'args', 'input', 'command'];
const TOOL_LIKE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
// A call written as code: run_command("dir"), with a string first argument.
const CALL_SYNTAX_RE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\(\s*(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')[^)\n]*\)/g;

// The tool names a JSON text writes as a call ("name"/"function" plus arguments/parameters), or null
// when it is not call-shaped. A name that is not a known tool is also read from the keys "tool",
// "command" and "input" when it looks like a tool name. A text that is not valid JSON is read by
// its keys alone.
function writtenCallNames(jsonText, known) {
  let v;
  try {
    v = JSON.parse(jsonText);
  } catch {
    const name = NAME_TEXT_RE.exec(jsonText);
    if (name && ARGS_TEXT_RE.test(jsonText)) return [name[1].trim()];
    const wide = WIDE_NAME_TEXT_RE.exec(jsonText);
    const wideName = wide ? wide[1].trim() : '';
    return wide && WIDE_ARGS_TEXT_RE.test(jsonText) && TOOL_LIKE_RE.test(wideName) && !known.has(wideName) ? [wideName] : null;
  }
  const names = [];
  for (const o of Array.isArray(v) ? v : [v]) {
    if (!isPlainObject(o)) continue;
    const { name } = rawCallParts(o);
    const fn = isPlainObject(o.function) ? o.function : {};
    const hasArgs = ARG_KEYS.some((k) => Object.hasOwn(o, k) || Object.hasOwn(fn, k));
    if (name && hasArgs) {
      names.push(name);
      continue;
    }
    const wideName = WIDE_NAME_KEYS.map((k) => o[k]).find((n) => typeof n === 'string' && TOOL_LIKE_RE.test(n.trim()));
    if (wideName && !known.has(wideName.trim()) && WIDE_ARG_KEYS.some((k) => Object.hasOwn(o, k))) names.push(wideName.trim());
  }
  return names.length ? names : null;
}

/**
 * A final reply that holds a tool call written as text which was not run (an unknown tool name):
 * each such JSON object, an unclosed one (its last brace missing, replaced to the end of the text),
 * code block or call written as name("...") is replaced by the fixed unknown-tool sentence. A known
 * tool is left alone (recovery or the write park already dealt with it); JSON that names no tool,
 * parentheses in prose and code that names no tool stay.
 * @param {string} text
 * @param {Iterable<string>} knownNames
 * @returns {{ text: string, names: string[] }} names as written (clip before logging)
 */
export function refuseTextToolCalls(text, knownNames) {
  const known = new Set(knownNames);
  const names = [];
  const refusedNames = (jsonText) => {
    const found = writtenCallNames(jsonText, known);
    if (!found) return null;
    const unknown = found.filter((n) => !known.has(n));
    if (!unknown.length) return null;
    names.push(...unknown);
    return unknown;
  };
  // A code block that is only one such call is a call; a longer block of code that happens to use a snake case function stays.
  const wholeCall = (code) => {
    const m = new RegExp(`^${CALL_SYNTAX_RE.source}$`).exec(code);
    if (!m || known.has(m[1])) return false;
    names.push(m[1]);
    return true;
  };
  const src = typeof text === 'string' ? text : '';
  const out = src.replace(FENCE_BLOCK_RE, (m, inner) => (refusedNames(inner.trim()) || wholeCall(inner.trim()) ? UNKNOWN_TOOL_SENTENCE : m));
  let result = '';
  let i = 0;
  while (i < out.length) {
    if (out[i] === '{') {
      const obj = firstJsonObject(out.slice(i));
      if (obj) {
        result += refusedNames(obj) ? UNKNOWN_TOOL_SENTENCE : obj;
        i += obj.length;
        continue;
      }
      if (refusedNames(out.slice(i))) return { text: result + UNKNOWN_TOOL_SENTENCE, names };
    }
    result += out[i];
    i += 1;
  }
  const withCalls = result
    .split(FENCE_SPLIT_RE)
    .map((part, idx) =>
      idx % 2 === 1
        ? part
        : part.replace(CALL_SYNTAX_RE, (m, name) => {
            if (known.has(name)) return m;
            names.push(name);
            return UNKNOWN_TOOL_SENTENCE;
          }),
    )
    .join('');
  return { text: withCalls, names };
}
