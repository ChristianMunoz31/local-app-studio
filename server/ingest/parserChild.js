// The parser process: `<exe> --role parser` (server/entry.js). Reads ONE job from stdin, parses it, writes ONE
// JSON result line to stdout and exits 0. It gets bytes only: no environment, no file handles, and it never
// touches the data folder, the database or the network. Anything native that goes wrong here (issue #67)
// kills this process and nothing else; the host maps that to doc_crashed (parserHost.js).
//
// Job frame on stdin (docs/INGEST.md): one JSON header line, then exactly `bytes` raw document bytes, then EOF:
//   {"v":1,"kind":"pdf"|"docx"|"text","bytes":<n>}\n<n raw bytes>
// Result on stdout: one line of JSON (the contract in docs/INGEST.md) followed by \n.
import { KINDS, LIMITS } from './limits.js';

const FRAME_VERSION = 1;

/**
 * Reads one job frame. Resolves null for any malformed frame (never throws, never echoes the input).
 * @param {NodeJS.ReadableStream} stdin
 * @returns {Promise<{ kind: string, bytes: Buffer } | null>}
 */
export function readJob(stdin) {
  return new Promise((resolve) => {
    const chunks = [];
    let have = 0;
    let header = null;
    let bodyStart = 0;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const total = () => Buffer.concat(chunks, have);
    stdin.on('data', (chunk) => {
      if (settled) return;
      chunks.push(chunk);
      have += chunk.length;
      if (header === null) {
        const buf = total();
        const nl = buf.indexOf(0x0a);
        if (nl === -1) {
          if (have > LIMITS.maxHeaderBytes) done(null);
          return;
        }
        if (nl > LIMITS.maxHeaderBytes) return done(null);
        try {
          header = JSON.parse(buf.subarray(0, nl).toString('utf8'));
        } catch {
          return done(null);
        }
        const ok =
          header !== null &&
          typeof header === 'object' &&
          header.v === FRAME_VERSION &&
          KINDS.includes(header.kind) &&
          Number.isSafeInteger(header.bytes) &&
          header.bytes > 0 &&
          header.bytes <= LIMITS.maxInputBytes;
        if (!ok) return done(null);
        bodyStart = nl + 1;
      }
      // Stop reading as soon as more than the declared bytes arrive: the frame is wrong.
      if (have - bodyStart > header.bytes) done(null);
    });
    stdin.on('error', () => done(null));
    stdin.on('end', () => {
      if (header === null || have - bodyStart !== header.bytes) return done(null);
      done({ kind: header.kind, bytes: total().subarray(bodyStart) });
    });
  });
}

// The real stdout writer, captured before any library loads; null until runParserChild() has sealed stdout.
let writeResultLine = null;

/**
 * stdout carries exactly one line, the result. Stray logging from a library (console.log, or a direct
 * process.stdout.write) would corrupt that protocol, so after the real writer is captured every other path to
 * stdout is redirected to stderr (which the host only keeps for its diagnostic hook).
 */
function sealStdout() {
  const real = process.stdout.write.bind(process.stdout);
  writeResultLine = (line, done) => real(line, done);
  const toStderr = (...args) => process.stderr.write(`${args.map(String).join(' ')}\n`);
  console.log = toStderr;
  console.info = toStderr;
  console.warn = toStderr;
  console.debug = toStderr;
  process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);
}

/** Writes the result line and exits. The exit waits for the stdout flush. */
function finish(result) {
  const write = writeResultLine ?? ((line, done) => process.stdout.write(line, done));
  write(`${JSON.stringify(result)}\n`, () => process.exit(0));
}

/**
 * Child entry. Loads the format parsers lazily (unpdf is several MB), after the network stub is in place.
 * @returns {Promise<void>}
 */
export async function runParserChild() {
  sealStdout();
  // The parser never needs the network: any attempt to fetch fails at once.
  globalThis.fetch = () => Promise.reject(new Error('network disabled'));
  const job = await readJob(process.stdin);
  if (job === null) return finish({ ok: false, code: 'parse_failed' });
  try {
    let outcome;
    if (job.kind === 'pdf') outcome = await (await import('./pdf.js')).parsePdf(job.bytes);
    else if (job.kind === 'docx') outcome = (await import('./docx.js')).parseDocx(job.bytes);
    else outcome = (await import('./text.js')).parseText(job.bytes);
    return finish(outcome);
  } catch {
    // Message text is dropped on purpose: library errors can quote document content.
    return finish({ ok: false, code: 'parse_failed' });
  }
}
