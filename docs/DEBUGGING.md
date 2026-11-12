# Debugging

What to look at when something goes wrong in Local App Studio, in a source checkout or in an installed copy. Everything here is read from the code: `server/errors.js`, `server/log.js`, `server/processGuards.js`, `server/diagnostics/`, `scripts/doctor.js`, `scripts/debugE2e.js` and `scripts/ci/gate*.js`.

## The error envelope

Every error the server sends has the same JSON shape, and so does the payload of an SSE `error` event:

```json
{
  "error": "That app does not exist. It may have been deleted.",
  "code": "app_not_found",
  "action": "Go back to Apps.",
  "requestId": "9f2c4e1a7b3d5e60",
  "message": "That app does not exist. It may have been deleted."
}
```

- `error` is one plain sentence for the person. `code` is the stable machine code (snake_case). `action` is the one next step. `requestId` is 16 hex characters and equals the `X-Request-Id` response header.
- `message` is a deprecated alias equal to `error`. It stays for this phase so existing screens keep their words.
- `details` is optional and diagnostic only. It is always redacted. The server fills it only in debug mode (the error name, its code and the first stack frame outside `node_modules`) or when a call site passes it.
- Code-specific extras stay at the top level: `issues`, `field`, `revision`, `feature`, `reason`, `hint`, `retryMs`, `apps`, `features`, `ok`.
- Every code, sentence and action is in the "Error codes" table in [DESIGN.md](DESIGN.md). An unknown code is logged as `errors.unknown_code` and sent as `server_error`.

Built apps: menu slot parts (menu.start and menu.end) are drawn by the menu frame, outside the page boundary, so they stay on screen when a page fails; parts that portal into the menu from the failed page disappear with it.

Success bodies are unchanged. A route never builds its own error body: `server/__tests__/errorEnvelopeBypass.test.js` fails on a `res.status(4xx or 5xx).json(` outside `server/errors.js`.

## Where the logs live

`server/log.js` writes one JSON line per record. Three places hold the same redacted lines:

| Place | What | Size |
| --- | --- | --- |
| Memory ring | the last 500 records, served by Settings > Diagnostics | 500 lines |
| `<data folder>/logs/server.jsonl` | the rolling file | rolls at 2 MB; `server.1.jsonl` to `server.3.jsonl` are kept, so at most 8 MB on disk |
| stderr | warn and above as one human line; a desktop run prints only error and fatal | not kept by the server |

In an installed copy the shell keeps stderr in `server.log` (see [ARCHITECTURE.md](ARCHITECTURE.md)); the structured file is in the data folder, not next to it. The data folder is `%APPDATA%\Local App Studio` by default. A Preview child writes its own `logs/` under its scratch data folder. Under Vitest nothing is written to a file or stream unless `APP_LOG_TEST=1`.

A record looks like this. The fields come in this order: `level`, `time`, `requestId`, `event`, then `route`, `status`, `code`, `durationMs` when present, then the event's own fields, then `role` (`studio`, `runtime`, `preview` or `parser`).

```json
{"level":"warn","time":"2026-11-04T10:12:03.412Z","requestId":"9f2c4e1a7b3d5e60","event":"http.request","route":"PUT /api/studio/apps/:id","status":409,"code":"revision_conflict","durationMs":12.4,"role":"studio"}
```

- One `http.request` record per request. `route` is the route template, never the raw URL. A `GET` that answers below 400 is level `debug` (kept only in debug mode, so the Preview status poll does not fill the ring); other requests are `info`, `warn` (4xx) or `error` (5xx).
- Every record of one request shares its `requestId`: the request line, the Describe or Build stage lines, a slow query. A client may send its own `X-Request-Id` (8 to 64 letters, digits or hyphens); anything else is replaced. The Preview proxy forwards the id to the Preview child, so the child's lines carry it too.
- Never logged: request or response bodies, query strings, headers, cookies, prompts, spec content, record values, file contents. Strings are cut to 300 characters, home folders become `<home>`, the data folder `<data>`, and secrets `[redacted]`.
- Startup migrations log under the request id `startup`.

To follow one failure: take the `requestId` from the envelope, from the `X-Request-Id` header, or from Copy details, then search `server.jsonl` for it.

## How to read a report

Settings > Diagnostics is closed until you press Show diagnostics (a link ending in `#diagnostics` opens it), so a plain Settings visit runs no check. Save a report then downloads `local-app-studio-report-YYYYMMDD-HHMM.zip` (`GET /api/studio/diagnostics/report`). Copy summary gives the same first lines as text. Every text entry went through the redactor again, and the logs are capped at 8 MB (oldest lines dropped first).

| Entry | What it tells you |
| --- | --- |
| `README.txt` | When the report was made, and that no app designs, records, keys or passwords are in it |
| `summary.txt` | The short version: Studio version, channel and mode, Node and bundle sha256 (or "running from source"), data folder, helper state, doctor counts, debug mode, error count in the last 200 lines |
| `versions.json` | `versions` (Studio, Node, `bundle.sea`, `bundle.sha256`) and `mode` (`app`, `channel`, `desktop`) |
| `doctor.txt`, `doctor.json` | The doctor table (below), as text and as JSON |
| `apps.json` | One row per app with counts only: `id`, `name`, `slug`, `revision`, `tables`, `pages`, `updatedAt`, `hasInstaller`, `problems`. No spec, no description, no records |
| `logs/server.jsonl`, `logs/server.1.jsonl` ... | The log files, newest first |

Never in a report: the database, `secrets.key`, specs, `.env`, the audit log, prompts, records or backup files.

Read it in this order: `summary.txt` for the state, `doctor.txt` for a Missing or Problem line, then the log for lines of level `error` or `fatal`, then the lines around them with the same `requestId`. `process.exit_unsafe` (fatal) means the server stopped itself, see "Process guards".

## The doctor

```powershell
npm run doctor                  # the table
npm run doctor -- --json        # the report as JSON
npm run doctor -- --strict      # exit 1 when any line is Missing or a Problem (else always 0)
```

One line per check, in this order. Each is Found, Missing or Problem, and every line that is not Found names the one next action. The same checks run behind Settings > Diagnostics > Checks.

| Line | Found when |
| --- | --- |
| Node.js, npm, Rust, Cargo, Microsoft C++ build tools, Windows SDK, WebView2 | the build toolchain check finds it; these lines come from the same module and names as the Build step's tool table, so the two never disagree. A Rust older than the minimum is a Problem: "Run rustup update stable, then check again." |
| Free disk space | at least 5 GB free where the data folder is (a Problem otherwise) |
| Free memory | at least 1 GB free (a Problem otherwise) |
| Port 4321 (Local App Studio) | free, or held by this app |
| Port 5174 (development page) | free, or held by this copy's Vite |
| Data folder | a temporary file can be written and deleted there |
| The helper (Ollama) | the host answers within 2 seconds and a model that can use tools is installed. Missing when Ollama does not answer; a Problem when no model can use tools, when the helper is set to another computer (not checked) or when it is turned off |
| Playwright browsers (tests only) | a `chromium-*` folder exists. Left out in an installed copy |

A port held by something else is a Problem with the PID and command line (redacted, 300 characters). The doctor never stops a process: it only reads `netstat` and `Get-CimInstance` (Windows) or `lsof` and `ps`, and a test fails if the source names a kill command. The output ends with a count line such as `11 found, 2 missing, 1 problem.`

## Debug mode

Debug mode keeps more detail. Turn it on with `APP_DEBUG=1` when the server starts, or with the switch on Settings > Diagnostics (`POST /api/studio/diagnostics/debug`), which lasts until Local App Studio stops and cannot turn off an `APP_DEBUG=1` start.

| Area | Normal | Debug mode |
| --- | --- | --- |
| Log level kept | info and above | debug and above (GET request lines too) |
| Slow queries | not timed | each statement is timed; one over 100 ms logs `db.slow_query` at warn with `op`, `table` and `durationMs` (never SQL values) |
| Error envelopes | no `details` from the server | `sendErrorFrom` adds redacted `details { errorName, errorCode, at }` |
| Playwright | trace kept on failure | also a video and a screenshot of a failure |

Stage timings are `stage` records at info, so they are always logged, in debug mode or not. The fields are `stage` and `durationMs`:

- Describe: `describe.tables`, `describe.outline`, `describe.page` (field `pageId`), `describe.repair` (field `round`), `describe.total`.
- Build: `build.<step id>` for each build step, and `build.total`.
- Migrations: `migrate.backup`, `migrate.apply` (field `version`) and `migrate.total`, with a `track` of `core` or `app`.

### Debugging one e2e spec

```powershell
npm run build                                   # e2e needs dist/
npm run debug:e2e -- e2e/flows/diagnostics.spec.js
npm run debug:e2e -- e2e/flows/studio.spec.js --project flows -g "title of one test"
```

`scripts/debugE2e.js` accepts one spec under `e2e/` ending in `.spec.js` (else it prints the usage and exits 2), plus `--project <name>` and `-g <title>`. It runs Playwright headed, with one worker and no retries, `--trace=on`, `APP_DEBUG=1` and `PW_VIDEO=on`. When it ends it names `test-results/`; open a trace with `npx playwright show-trace <the trace.zip in that folder>`. Each spec starts its own sandboxed server, so no real data is touched.

### The ten slowest unit tests

Every unit run through `scripts/ci/runUnitTests.js` and the gate prints `Ten slowest tests` and ten lines like `  12.31 s  <file> > <full test name>` at the end. It is `scripts/ci/slowestReporter.js`, a Vitest reporter, and it needs no flag.

### Source maps

A Dev build of the sidecar (`scripts/desktop/buildDev.js` passes `--sourcemap`) bakes in source maps so a stack trace names real files. Run from source (`npm start`, `npm run desktop:dev`) and traces already do. Set `APP_SOURCE_MAPS=1` to ask for the same by hand. Source maps are never in the shipped installer, the release workflows or the budget build.

## Process guards

`server.js` installs `uncaughtException` and `unhandledRejection` handlers (`server/processGuards.js`) for the Studio server and for a built app's server, which is the same file in runtime mode. `server/entry.js` has a small early guard for the time before that.

| Case | Result |
| --- | --- |
| An unhandled rejection | logs `process.unhandled_rejection`, answers the request it belongs to with `server_error` when no headers were sent, never exits |
| An uncaught exception that is not one of the cases below (a throwing timer, an event callback, a background job) | logs `process.uncaught`, answers the request in context with `server_error` (on an open SSE stream, an `error` event, then the stream ends), keeps running. Diagnostics shows "Recovered from an unexpected error at <time>." |
| A SQLite transaction is open on the main handle | exit 5 (`transaction_open`): the handle's state is unknown |
| A damaged or unreadable database (`SQLITE_CORRUPT`, `SQLITE_NOTADB`, `SQLITE_IOERR*`, `SQLITE_CANTOPEN`, also through `cause`) | exit 5 (`database_damaged`) |
| Maximum call stack size exceeded | exit 5 (`stack_overflow`) |
| Out of memory, or heap use over 90 percent of the limit | exit 5 (`out_of_memory`) |
| A second uncaught exception within 60 seconds of the first | exit 5 (`repeat`) |
| Before the server finished starting | exit 1 (`startup`, as before) |
| The document parser child | exit 1 (`parser`): the parent treats the child as disposable |

Before exiting with 5 the server logs `process.exit_unsafe` at fatal with the reason, writes the log file synchronously, finishes every open response (`server_error` JSON, or an SSE `error` event, or closes the socket), runs its normal stop with a 2 second cap, then exits. A closed stdout or stderr pipe (EPIPE) is ignored.

Exit code 5 means "stopped after an unexpected error left it in an unsafe state". The Preview manager treats it like any other failure (preview failed, data kept).

The Tauri shell does not restart the sidecar. On any unexpected exit it navigates the window to its bundled error page and shows a dialog ("Local App Studio stopped unexpectedly") with Open log folder, Copy details (the last 40 stderr lines) and Quit, or the restore recovery dialog for exit 3. There is no restart path in `src-tauri/src`. With the guards, a recoverable error no longer reaches the shell; an unsafe one ends in that dialog, with the `process.exit_unsafe` line at the end of the stderr tail.

## The gate's classifications and quarantine

`npm run gate` and the `ci.yml` unit and e2e steps share the same scripts (`scripts/ci/gateClassify.js`, `gateState.js`). The rules (the rerun alone, flaky against real, the steps that are always real, the rerun caps, the quarantine and the protected gate) are in [PIPELINE.md](PIPELINE.md), "Classifying a failure" and "Quarantine". Two facts live here only:

- `release.yml` sets `GATE_PROTECTED=1` on its unit run, so a release quarantines nothing.
- To clear a quarantine early, fix the race and delete the entry from `.gate/flaky.json` (an ignored file), or let it expire.

## Reverting a mechanical commit

`npm run gate -- --repair` (the pre-push hook passes it) runs `eslint --fix` on the changed files only; there is no formatter in this repo. It commits as `chore(gate): mechanical fixes` only when no string or template literal changed and every changed line lies inside a range eslint reported as fixable; otherwise it restores the files and says so. It skips a file with uncommitted changes, and does nothing when changes are staged. It never runs in CI. When it commits during a push, the push stops with "Push again to include it."

The commit body names the files and rules and ends with the revert command. To undo it:

```powershell
git revert <sha>            # when it is already pushed
git reset --soft HEAD~1     # when it is not pushed and is the latest commit
```

## e2e teardown fails with EPERM

A spec can pass and still fail in its fixture teardown with `EPERM` from `fs.rmSync` on a Windows temp folder. Root cause: Node 24 `fs.rmSync` does not retry EPERM even when `maxRetries` and `retryDelay` are set, so a short-lived holder of the folder (the preview child's working directory, an indexer) fails it at once. `e2e/support/appServer.js` therefore retries by hand for 10 seconds (EPERM, EBUSY and ENOTEMPTY, every 200 ms). When it still fails, the error message ends with `Still present under <folder> (first <n>): ...`, the first 20 entries left in the folder, because the EPERM message alone names only the temp root.

## Removing a phase worktree

Do not delete a phase worktree by hand: a dev server, a Vitest worker or a browser may still hold it as its current directory, and Windows then refuses the delete halfway. Use `scripts/phase/cleanup.js`. The rules and flags are in [PIPELINE.md](PIPELINE.md), "Phase cleanup".

1. Run it as a dry run first, from the main checkout or any folder outside the worktree: `npm run phase:cleanup -- --phase <N>`. It changes nothing.
2. Read the process table. Every row says why it matched and whether it would be stopped or `refused: <why>`. Check the worktree path in the first line and that the folders named below it are the phase's own.
3. Only then run `npm run phase:cleanup -- --phase <N> --force`, and only on the phase's own finished worktree. Never use it on a live phase (one still being worked on) and never aim it at the main checkout (it refuses that, but do not try).
4. When a row is refused, the process stays and the worktree may stay with it. The reason says what to do: a process of another worktree or of the main checkout is not yours to stop here; an owner process or port is the owner's; `not a dev tool` means look at it by hand. Close it yourself or add it to the owner list with `--owner-pid`, then run the dry run again.
5. When the run ends with `worktree not removed`, read the reason. "cd out of the worktree first" means this shell is inside it. "still held by pid" means a process the scan found after the stop is still in it; run the dry run again. "git worktree remove refused" means uncommitted or locked work: commit or discard it, then run again. Use `--keep-worktree` to do the rest and leave the folder.
6. While something is left the run is not finished (exit codes and the `not finished: <steps>` line: PIPELINE.md, "Phase cleanup"). Run the dry run again to see what; the cleanup can be repeated.

The current-directory scan is `scripts/phase/lib/cwdScan.ps1`. It reads each process's current directory read only and never stops anything, and `cleanup.js` uses it for the table. It replaces a by-hand scan of current directories; do not write a new one. A 32-bit process may show an empty current directory.

## The fake helper in the sandbox

In the sandbox the fake helper answers the Prompt step with canned designs chosen by the words in your prompt (loans, borrow or due: three tables with links and dates; task or project: two tables; a change request on an existing app adds a Notes field; anything else: a crew roster), so the helper path works end to end; pass --plain-ai (or --plain for npm run fake:ollama) for one fixed line instead, or --no-ai for no helper at all.

```powershell
npm run sandbox                      # canned designs
npm run sandbox -- --plain-ai        # one fixed line for every chat
npm run sandbox -- --no-ai           # no helper
npm run fake:ollama                  # canned designs; add -- --plain for one fixed line
```

The canned answers are in `scripts/lib/fakeDescribeAnswers.js`. `--real-ai` still uses your real Ollama.
