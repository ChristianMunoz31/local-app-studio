# Document ingest

`parseDocument(bytes, { kind, signal })` turns a text PDF, a DOCX or a UTF-8 text file into page text with positions. Parsing runs in a **child process** so a native crash in the PDF library (Burrow issue #67: `0xC0000005` in a worker thread on Node 24 win-arm64) can only cost that child, never the sidecar. Code: `server/ingest/`. Route: `POST /api/ingest/parse`. No tables, no migration, no UI.

## Contract

Success:

```
{ ok: true, kind: 'pdf' | 'docx' | 'text',
  pages: [{ page, text, runs?, width?, height?, rotation?, paragraphs? }],
  meta: { pageCount, paginated, truncated, producer?, title?, unreadablePages? } }
```

Failure: `{ ok: false, code, message }`. `message` is a fixed text per code, never library, OS or stderr text.

| code | from | meaning |
| --- | --- | --- |
| `unsupported` | child or host | not a PDF, DOCX or UTF-8 text (also: `kind` does not match the bytes) |
| `encrypted` | child | password protected PDF |
| `empty` | child or host | no text found (scanned PDF, blank document, zero bytes) |
| `parse_failed` | child | damaged file, or the library threw |
| `too_large` | host | over 25 MB |
| `doc_busy` | host | the queue is full |
| `doc_timeout` | host | 20 s wall clock, child killed |
| `doc_crashed` | host | signal, non-zero exit, oversized or invalid output |
| `doc_unavailable` | host | the child could not be started |
| `aborted` | host | the `AbortSignal` fired |

**PDF.** One entry per page, `page` is the 1-based page number. `runs` are `{ x, y, w, h, text }` in pdf.js user space: PDF points (1/72 inch), origin bottom-left, x grows right, y grows up. `(x, y)` is the baseline origin of the run's first glyph, `w` the advance width, `h` the font height. `x` and `y` are measured from the bottom-left corner of the visible page box (pdf.js `page.view`: the CropBox clipped to the MediaBox), so a box that does not start at 0,0 (for example `/MediaBox [36 36 576 756]`) still maps onto `width` x `height`: the host subtracts the box origin from every run. `width` and `height` are the size of that box, `rotation` the page `/Rotate`; runs are not rotated. Rotated text keeps these definitions.

**DOCX and text have no pages.** The result has exactly one entry with `page: null`, `meta.paginated: false` and `meta.pageCount: null`. Never show a page number for them (product code must not invent one). A DOCX entry carries `paragraphs: [{ index, start, end }]`, offsets into `text`, so a citation can say "paragraph 12". DOCX has no runs with positions.

`meta.truncated` is true when a cap cut the output (200 pages, 2,000,000 characters, 150,000 runs). A DOCX paragraph that crosses the character cap keeps its prefix (a surrogate pair is never split). On a PDF page the character cap also drops the runs whose text it removed, and `truncated` is set only when something was actually left out (a run budget that is met exactly is not a drop).

## Process model

```
index.js parseDocument -> parserHost.js (queue, limits) -> spawn -> parserChild.js (pdf.js / fflate)
```

- **Single slot, FIFO.** One child at a time; up to 8 jobs wait, the next gets `doc_busy`. A new child per job (no reuse, see open items). The slot is held until the child's pipes close; after a timeout or abort kill, if no close comes within 5 s (`killGraceMs`, a descendant holding a pipe or a failed kill) the host destroys the pipes and answers anyway, so a stuck child cannot make every later job `doc_busy`.
- **Spawn command.** Dev: `process.execPath --max-old-space-size=512 server/entry.js --role parser`. SEA: `process.execPath --role parser` with `NODE_OPTIONS=--max-old-space-size=512`. SEA is detected with `node:sea` `isSea()`. A Node SEA cannot load script files from disk (that is why Burrow embedded a worker as a string), so the sidecar exe starts itself.
- **Dispatcher entry.** `server/entry.js` is the esbuild entry of the sidecar bundle and the dev spawn target. It reads the role with `server/role.js` (pure `roleFromArgv`; an unknown, missing or repeated role exits 2) and loads `ingest/parserChild.js` or `server.js` with a dynamic `import()`, so the other branch never evaluates (esbuild wraps both in lazy initializers; `ingestBundle.test.js` checks it). The switch cannot live in `server.js`: a top-level await in the first import does not hold back its sibling imports in Node 24 (checked: `a.mjs` imports `r.mjs` (top-level await, then `process.exit`) and then `b.mjs`; `b` evaluates before `r` finishes), and esbuild's cjs output rejects top-level await. `node server.js --role ...` refuses (exit 2) before `startServer` runs, so a parser flag can never open the database.
- **Isolation.** `stdio: ['pipe','pipe','pipe']` (no inherited handles), `windowsHide`, and an empty environment. On Windows libuv adds a baseline of variables to a child that lacks them, copying the parent's values; `minimalChildEnv()` blanks `PATH`, `TEMP`, `USERNAME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER` and `USERDOMAIN`, and leaves only `SYSTEMROOT`, `WINDIR`, `SYSTEMDRIVE` and `PROCESSOR_ARCHITECTURE` (Windows machine constants; the real parse works with the rest blanked, on Windows 11 ARM64). On other platforms the env is `{}`. The child's working directory is the folder of the running executable (`path.dirname(process.execPath)`), not the parent's cwd and not anything derived from the environment. The only addition to the environment is `NODE_OPTIONS` in a SEA. The child captures the real stdout writer first and redirects `console.log/info/warn/debug` and any other `process.stdout.write` to stderr, so stray library logging cannot corrupt the one-line result. The child replaces `fetch` with a rejecting stub before it reads the job and imports no fs, db or env code.
- **Memory cap.** `--max-old-space-size=512` gives a `heap_size_limit` of about 704 MB on Node 24 (V8 adds young generation space; measured). A dev child gets it as a command line flag. In a SEA, node flags on the command line are NOT parsed (verified: `exe --max-old-space-size=8 --role parser` ran a job normally), `v8.setFlagsFromString` after start does not move the limit (measured 4288 MB before and after), and `NODE_OPTIONS` is honored (verified: `NODE_OPTIONS=--max-old-space-size=8` makes the exe die with V8 "Allocation failed", exit 134, which the host reports as `doc_crashed`). So the SEA branch uses `NODE_OPTIONS`. The cap covers the JS heap, not typed arrays or WASM memory; the 25 MB input cap and the timeout bound those.

## Framing

stdin: one JSON header line, then exactly `bytes` raw document bytes, then EOF.

```
{"v":1,"kind":"pdf"|"docx"|"text","bytes":<n>}\n<n raw bytes>
```

The header is capped at 256 bytes and `bytes` at 25 MB; a malformed or short frame answers `parse_failed`. stdout: one JSON line (the contract), then exit 0. The host drops anything over 32 MB of stdout (and kills the child), keeps at most 16,384 characters of stderr for the `onDiagnostic` hook (logged as code, exit status and signal only; never sent to a client), and validates the shape of the result, dropping unknown fields: a PDF needs an integer `pageCount` of at least the pages returned, every other kind `pageCount: null`, DOCX paragraph offsets must lie inside the text, and totals stay within the character and run caps.

## Limits

| Limit | Default |
| --- | --- |
| Input bytes | 25 MB |
| Timeout (then SIGKILL) | 20 s |
| Heap (`--max-old-space-size`) | 512 MB |
| Queue | 8 waiting |
| Stdout bytes / stderr characters | 32 MB / 16,384 |
| PDF pages / characters / runs | 200 / 2,000,000 / 150,000 |
| DOCX entries / per entry / total inflated | 5,000 / 20 MB / 40 MB (zip-bomb guards, as Burrow) |

pdf.js runs with `isEvalSupported: false`, `disableFontFace`, `useSystemFonts: false`, `enableXfa: false`, no worker fetch, no range or stream loading. DOCX text is read with a small tokenizer, not an XML parser (no entity expansion, DTD or external reference).

## Route

`POST /api/ingest/parse`, body `{ "data": "<base64>", "kind"?: "pdf" | "docx" | "text" }`, its own JSON limit (about 34 MB), `Cache-Control: no-store`, the same host guard, CORS, global rate limit and auth gate as other `/api` routes, plus 60 requests per 15 minutes. Not Pro-gated (a comment marks where `requirePro` would go). Every answer is `no-store`, including the route's own 400 and 413 from the body parser. When the parse queue is already full the route answers 429 `doc_busy` before it reads the body, and it drops the parsed JSON (the base64 string) as soon as the bytes are decoded, so a queued job holds only its bytes.

| status | `error` | when |
| --- | --- | --- |
| 200 | | the contract above |
| 400 | `invalid_request` | body is not `{ data: base64, kind? }` |
| 413 | `too_large` | document or body over the cap |
| 422 | `unsupported`, `encrypted`, `empty`, `parse_failed` | the document cannot be read |
| 429 | `doc_busy`, `rate_limited` | queue full, rate limit |
| 500 | `doc_crashed` | the parser died or answered nonsense |
| 503 | `doc_unavailable` | the parser could not be started |
| 504 | `doc_timeout` | 20 s limit |

Errors are `{ ok: false, error, code, message }`. A client that disconnects aborts the parse (the child is killed).

## Adding a format

1. Add `server/ingest/<format>.js` exporting a function from bytes to the `ParseOutcome` shape (`result.js`). It is the only place its library may be imported.
2. Add the kind to `KINDS` in `limits.js`, a branch in `parserChild.js` (lazy `import()`), the shape rule in `validPage` in `parserHost.js`, and magic-byte sniffing in `index.js`.
3. Add the library to `BUNDLED_COMPONENTS` in `scripts/lib/kitPackage.js` if it bundles code the lock file does not list, and to the allowlist in `server/__tests__/ingestBoundary.test.js`.
4. Add tests with a synthetic document generated in the test (no binary fixtures).

## Known gaps

- Scanned PDFs have no text layer and come back as `empty`. OCR is out of scope.
- CJK PDFs that use predefined CMaps (not embedded ones) can lose text: pdf.js runs here with no character maps loaded from anywhere (`cMapUrl` unset), so those glyphs map to nothing. Not tested.

## Privacy invariant

Bytes in, text out. The child has no environment, no file handles, no network (fetch stubbed) and never opens the data folder or the database. Library error text never reaches a response or a log.

## Dependencies and licenses

- `unpdf` 1.8.1, MIT, pinned exactly (`engines.node >= 22`; Node 24 works, no newer version needed).
- pdf.js (`pdfjs-dist` 6.1.200) is bundled inside unpdf, Apache-2.0. The lock file does not list it and the npm package carries no license file, so the text is vendored in `scripts/lib/bundled-licenses/pdfjs-dist/LICENSE` and `collectBundledComponents` in `scripts/lib/kitPackage.js` adds it to `THIRD_PARTY_NOTICES.md` ("Components bundled inside npm packages"). Update the version in `BUNDLED_COMPONENTS` when unpdf's bundled pdf.js changes.
- `fflate` (MIT) was already a dependency.

## Smoke test of the built exe

`npm run build`, `npm run desktop:sidecar`, then `node scripts/desktop/smokeParser.js`. It runs the exe with `--role parser` on a generated PDF, then the same exe through `createParserHost` with the SEA spawn spec, then checks that a tiny `NODE_OPTIONS` heap cap is honored. Each run uses a temp `APP_DATA_DIR` that must stay empty.

## Sidecar size

From `node scripts/desktop/buildSidecar.js --minify`: bundle 1723 KB to 3325 KB, SEA exe 80462 KB to 82065 KB (about 1.6 MB, mostly the pdf.js build). No budget exists for the sidecar (`bundle-budget.json` covers the UI only and is unchanged).

## Open items

- Windows Job Object: `src-tauri/src/sidecar.rs` assigns the sidecar to a Job Object so it dies with the app. A child it spawns joins that job by default (nested jobs, Windows 8 and later), but this was not verified end to end. Check that killing the app also ends a running parser.
- Node permission model (`--permission`) could restrict the child further (no fs, no child processes). Not enabled; its behavior in a SEA is unverified.
- Request body: the route takes base64 JSON (about 1.33x the document, parsed and decoded in the sidecar before the child starts). A raw `application/octet-stream` body would avoid the base64 copy and the JSON parse. Not done in this spike.
- Isolation is by construction, not enforced: the child gets no environment or data folder path and imports no fs or database code, but nothing stops a future change to `parserChild.js` from doing so except `ingestBoundary.test.js` and review.
- Child reuse: one process per job costs roughly 0.4 to 0.8 s of startup; reusing a child across jobs would trade isolation for speed.
