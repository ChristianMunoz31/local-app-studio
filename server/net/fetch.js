// The one HTTP client for outbound calls (Ollama, the update check, store license calls, the cloud
// model provider). Callers never import a client library; tests mock this module's path.
//
// Two transports behind one `fetch(url, init)`:
//   - no `init.agent`: Node's built-in fetch (undici).
//   - `init.agent` (a node:http or node:https Agent): the request goes through node:http(s) `request`
//     with that agent, so an agent's connect-time DNS `lookup` (the cloud SSRF guard,
//     server/ai/cloudGuard.js) still runs. Built-in fetch ignores `agent`.
//
// Supported init: method, headers, body (string, URLSearchParams, Buffer), signal, redirect,
// agent, size. `redirect`: 'manual' returns a 3xx as is; 'error' refuses it (the agent transport
// never follows a redirect, so it refuses in every other case too). `size` caps text() and json() and rejects with
// code ERR_BODY_TOO_LARGE past the cap.
//
// The response has ok, status, statusText, headers.get(), text(), json() and `body`, an async
// iterable with destroy(): Node's IncomingMessage on the agent path, a web ReadableStream (with a
// destroy() that aborts the request) on the built-in path. An abort always rejects with an error
// named AbortError, including a timeout signal.
import http from 'node:http';
import https from 'node:https';

const abortError = (cause) => Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR', cause });

const tooLarge = () => Object.assign(new Error('content size over limit'), { name: 'BodyTooLargeError', code: 'ERR_BODY_TOO_LARGE', type: 'max-size' });

const refusedRedirect = () => Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') });

/**
 * Read an async-iterable body to text, never buffering more than `size` bytes plus one chunk.
 * @param {AsyncIterable<Uint8Array|string>|null|undefined} body
 * @param {number|undefined} size
 * @param {() => void} destroy
 * @returns {Promise<string>}
 */
async function readText(body, size, destroy) {
  if (!body) return '';
  const cap = Number.isFinite(size) && size > 0 ? size : Infinity;
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > cap) {
      destroy();
      throw tooLarge();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const declaredTooLarge = (headers, size) => {
  const declared = Number(headers.get('content-length'));
  return Number.isFinite(size) && size > 0 && Number.isFinite(declared) && declared > size;
};

/** Detaches the listener of an abandoned response whose body was never read (the closure holds no reference to the response). */
const abandoned = new FinalizationRegistry((detach) => detach());

const BODY_METHODS = ['text', 'json', 'arrayBuffer', 'blob', 'bytes', 'formData'];

/**
 * Runs `detach` once the response body is done: a body-reading method settled, the stream was iterated or read to its end or
 * cancelled, or the caller destroyed it. So a long-lived caller signal does not keep one listener per finished request.
 */
function detachWhenBodyEnds(res, detach) {
  for (const name of BODY_METHODS) {
    const original = res[name];
    if (typeof original !== 'function') continue;
    Object.defineProperty(res, name, {
      value: async (...args) => {
        try {
          return await original.apply(res, args);
        } finally {
          detach();
        }
      },
      configurable: true,
    });
  }
  const body = res.body;
  if (!body) return;
  const iterate = body[Symbol.asyncIterator];
  if (typeof iterate === 'function') {
    Object.defineProperty(body, Symbol.asyncIterator, {
      value: async function* iterateBody(...args) {
        try {
          yield* iterate.apply(body, args);
        } finally {
          detach();
        }
      },
      configurable: true,
    });
  }
  const getReader = body.getReader;
  if (typeof getReader === 'function') {
    Object.defineProperty(body, 'getReader', {
      value: (...args) => {
        const reader = getReader.apply(body, args);
        const read = reader.read.bind(reader);
        const cancel = reader.cancel.bind(reader);
        reader.read = async () => {
          try {
            const out = await read();
            if (out.done) detach();
            return out;
          } catch (err) {
            detach();
            throw err;
          }
        };
        reader.cancel = (...a) => {
          detach();
          return cancel(...a);
        };
        return reader;
      },
      configurable: true,
    });
  }
  const cancel = body.cancel;
  if (typeof cancel === 'function') {
    Object.defineProperty(body, 'cancel', {
      value: (...args) => {
        detach();
        return cancel.apply(body, args);
      },
      configurable: true,
    });
  }
}

/** Built-in fetch with abort normalisation, a destroyable body and the `size` cap. */
async function viaBuiltIn(url, init) {
  const { size, signal, ...rest } = init;
  delete rest.agent;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  // The caller's signal may outlive many requests (a long-lived shutdown signal): the listener comes off when this request is done.
  const detach = () => signal?.removeEventListener('abort', onAbort);
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    res = await globalThis.fetch(url, { ...rest, signal: ctrl.signal });
  } catch (err) {
    detach();
    if (ctrl.signal.aborted && err?.name !== 'AbortError') throw abortError(err);
    throw err;
  }
  const destroy = () => {
    detach();
    ctrl.abort();
  };
  if (res.body) Object.defineProperty(res.body, 'destroy', { value: destroy, configurable: true });
  if (Number.isFinite(size) && size > 0) {
    const text = async () => {
      if (declaredTooLarge(res.headers, size)) {
        destroy();
        throw tooLarge();
      }
      try {
        return await readText(res.body, size, destroy);
      } finally {
        detach();
      }
    };
    Object.defineProperty(res, 'text', { value: text, configurable: true });
    Object.defineProperty(res, 'json', { value: async () => JSON.parse(await text()), configurable: true });
  }
  if (signal) {
    if (res.body) {
      detachWhenBodyEnds(res, detach);
      abandoned.register(res, detach);
    } else {
      detach();
    }
  }
  return res;
}

const toRequestBody = (body) => {
  if (body === undefined || body === null) return { data: null, type: null };
  if (typeof body === 'string') return { data: Buffer.from(body), type: null };
  if (body instanceof URLSearchParams) return { data: Buffer.from(body.toString()), type: 'application/x-www-form-urlencoded;charset=UTF-8' };
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return { data: Buffer.from(body), type: null };
  throw new TypeError('Unsupported request body');
};

/** node:http(s) request with the caller's agent. */
function viaAgent(url, init) {
  const { agent, size, signal, redirect, method = 'GET', headers } = init;
  const target = new URL(url);
  const transport = target.protocol === 'http:' ? http : target.protocol === 'https:' ? https : null;
  if (!transport) return Promise.reject(new TypeError(`Unsupported protocol ${target.protocol}`));
  const { data, type } = toRequestBody(init.body);
  const outHeaders = Object.fromEntries(new Headers(headers ?? {}));
  if (type && !outHeaders['content-type']) outHeaders['content-type'] = type;
  if (data && !outHeaders['content-length']) outHeaders['content-length'] = String(data.length);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }
    let received = null;
    const req = transport.request(target, { method, headers: outHeaders, agent }, (incoming) => {
      received = incoming;
      // An abort after the response resolved but before the body is read destroys `incoming` with an error: with no listener that
      // would be an unhandled 'error' event. Iteration still sees the error (the stream rejects the pending read).
      incoming.on('error', () => {});
      const status = incoming.statusCode ?? 0;
      if (status >= 300 && status < 400 && redirect !== 'manual') {
        incoming.destroy();
        reject(refusedRedirect());
        return;
      }
      const responseHeaders = {
        get(name) {
          const v = incoming.headers[String(name).toLowerCase()];
          return v === undefined ? null : Array.isArray(v) ? v.join(', ') : String(v);
        },
      };
      const destroy = () => incoming.destroy();
      const text = async () => {
        if (declaredTooLarge(responseHeaders, size)) {
          destroy();
          throw tooLarge();
        }
        return readText(incoming, size, destroy);
      };
      resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: incoming.statusMessage ?? '',
        headers: responseHeaders,
        body: incoming,
        text,
        json: async () => JSON.parse(await text()),
      });
    });
    // The abort is handled here (not by request({ signal })) so a mid-body abort also surfaces as AbortError.
    const onAbort = () => {
      const err = abortError(signal.reason);
      received?.destroy(err);
      req.destroy(err);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.once('close', () => signal?.removeEventListener('abort', onAbort));
    req.on('error', (err) => reject(err?.name === 'AbortError' ? err : signal?.aborted ? abortError(err) : err));
    if (data) req.end(data);
    else req.end();
  });
}

/**
 * Outbound HTTP request. See the file header for the supported options and the response shape.
 * @param {string|URL} url
 * @param {{ method?: string, headers?: HeadersInit, body?: string|URLSearchParams|Uint8Array, signal?: AbortSignal,
 *   redirect?: 'manual'|'error'|'follow', agent?: http.Agent|https.Agent, size?: number }} [init]
 * @returns {Promise<{ ok: boolean, status: number, statusText: string, headers: { get: (name: string) => string|null },
 *   body: (AsyncIterable<Uint8Array> & { destroy: () => void })|null, text: () => Promise<string>, json: () => Promise<unknown> }>}
 */
export default function fetch(url, init = {}) {
  return init.agent ? viaAgent(String(url), init) : viaBuiltIn(String(url), init);
}
