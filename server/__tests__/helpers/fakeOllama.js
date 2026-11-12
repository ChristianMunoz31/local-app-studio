// A fake Ollama for tests: install it on a mocked node-fetch (vi.mock('node-fetch')).
// Answers /api/version, /api/tags, /api/show, /api/chat and /api/pull (NDJSON, split into small chunks
// so line reassembly is exercised). Records every URL so tests can assert loopback-only use.
import { Readable } from 'node:stream';

export const MODELS = Object.freeze([
  {
    name: 'qwen2.5:7b',
    model: 'qwen2.5:7b',
    size: 4683087332,
    digest: 'd7',
    modified_at: '2026-01-01T00:00:00Z',
    details: { family: 'qwen2', parameter_size: '7.6B', quantization_level: 'Q4_K_M', context_length: 32768 },
    capabilities: ['completion', 'tools'],
  },
  {
    name: 'qwen2.5:3b',
    model: 'qwen2.5:3b',
    size: 1929912432,
    digest: 'd3',
    modified_at: '2026-01-01T00:00:00Z',
    details: { family: 'qwen2', parameter_size: '3.1B', quantization_level: 'Q4_K_M', context_length: 32768 },
    capabilities: ['completion', 'tools'],
  },
  {
    name: 'moondream:latest',
    model: 'moondream:latest',
    size: 1738451197,
    digest: 'dm',
    modified_at: '2026-01-01T00:00:00Z',
    details: { family: 'phi2', parameter_size: '1B', quantization_level: 'Q4_0', context_length: 2048 },
    capabilities: ['completion', 'vision'],
  },
]);

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
  headers: { get: () => null },
});

/**
 * An NDJSON streaming response, cut into `chunkSize`-character pieces.
 * @param {object[]} objects
 * @param {number} [chunkSize]
 */
export function ndjson(objects, chunkSize = 7) {
  const text = objects.map((o) => `${JSON.stringify(o)}\n`).join('');
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(Buffer.from(text.slice(i, i + chunkSize)));
  return { ok: true, status: 200, body: Readable.from(chunks), headers: { get: () => null } };
}

/** NDJSON frames for a plain text reply split into tokens. */
export function textReply(text, { model = 'qwen2.5:3b', tokens } = {}) {
  const parts = tokens || text.match(/\S+\s*|\s+/g) || [''];
  return [
    ...parts.map((t) => ({ model, message: { role: 'assistant', content: t }, done: false })),
    { model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: parts.length },
  ];
}

/** NDJSON frames for a native tool-call reply. */
export function toolReply(calls, { model = 'qwen2.5:7b' } = {}) {
  return [
    {
      model,
      message: { role: 'assistant', content: '', tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.arguments || {} } })) },
      done: false,
    },
    { model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 20, eval_count: 5 },
  ];
}

/** Typical frames of a successful `ollama pull`. */
export function pullFrames({ total = 1000, steps = 4 } = {}) {
  const digest = 'sha256:abc123';
  const layer = Array.from({ length: steps }, (_v, i) => ({ status: `pulling ${digest.slice(7, 19)}`, digest, total, completed: Math.round((total * (i + 1)) / steps) }));
  return [
    { status: 'pulling manifest' },
    ...layer,
    { status: 'verifying sha256 digest' },
    { status: 'writing manifest' },
    { status: 'removing any unused layers' },
    { status: 'success' },
  ];
}

/**
 * A streaming /api/pull response: one NDJSON frame per `delayMs` (0: all at once), cut into
 * small chunks. `hangAfter` frames, the stream stalls (until aborted). Honours `signal`:
 * an abort destroys the body with an AbortError and sets `state.pullAborted`.
 */
function pullResponse(frames, { delayMs = 0, hangAfter = Infinity }, signal, state) {
  const onAbort = () => {
    state.pullAborted = true;
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const wait = (ms) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        },
        { once: true },
      );
    });
  async function* gen() {
    let sent = 0;
    for (const f of frames) {
      if (sent >= hangAfter) await wait(3_600_000);
      if (delayMs > 0) await wait(delayMs);
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const text = `${JSON.stringify(f)}
`;
      for (let i = 0; i < text.length; i += 9) yield Buffer.from(text.slice(i, i + 9));
      sent += 1;
    }
    if (sent >= hangAfter) await wait(3_600_000);
  }
  return { ok: true, status: 200, body: Readable.from(gen()), headers: { get: () => null } };
}

/**
 * Install the fake on a mocked fetch.
 * @param {import('vitest').Mock} fetchMock
 * @param {{ models?: object[], down?: boolean, chat?: (body: object, init: object) => unknown, version?: string }} [opts]
 *   `chat` returns NDJSON frames (array) or a full response object; a queue of replies can be
 *   given as an array of arrays via `replies`.
 *   `pull` configures /api/pull: `{ frames?, delayMs?, hangAfter?, status? }` (frames default to
 *   pullFrames(); a non-2xx `status` answers an HTTP error with a text body).
 * @returns {{ urls: string[], chatBodies: object[], pullBodies: object[], pullAborted: boolean }}
 */
export function installFakeOllama(fetchMock, { models = MODELS, down = false, chat, replies, version = '0.32.14', pull = {} } = {}) {
  const state = { urls: [], chatBodies: [], pullBodies: [], pullAborted: false };
  const queue = Array.isArray(replies) ? [...replies] : null;
  fetchMock.mockImplementation(async (url, init = {}) => {
    state.urls.push(String(url));
    if (down) throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED', name: 'FetchError', type: 'system' });
    const { pathname } = new URL(url);
    if (pathname === '/api/version') return json({ version });
    if (pathname === '/api/tags') return json({ models });
    if (pathname === '/api/show') return json({ capabilities: ['completion'], model_info: {} });
    if (pathname === '/api/chat') {
      const body = JSON.parse(init.body);
      state.chatBodies.push(body);
      let out;
      if (chat) out = await chat(body, init);
      else if (queue) out = queue.length > 1 ? queue.shift() : queue[0];
      else out = textReply('Hello there.');
      return Array.isArray(out) ? ndjson(out) : out;
    }
    if (pathname === '/api/pull') {
      state.pullBodies.push(JSON.parse(init.body));
      if (pull.status && pull.status >= 400) return json({ error: 'upstream secret detail' }, pull.status);
      return pullResponse(pull.frames || pullFrames(), pull, init.signal, state);
    }
    return json({ error: 'not found' }, 404);
  });
  return state;
}

/** A /api/chat implementation that never answers until aborted (for timeout tests). */
export const hangingChat = (body, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
