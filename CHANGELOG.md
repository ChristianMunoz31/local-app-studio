# Changelog

## Unreleased

Everything below is on `main` and not yet in a numbered release. Entries marked "pro build" describe parts that are not in the public build (see README, "What the public build does not include").

### Cards, Show as and Enlarge

* **studio:** section cards wrap their action buttons under the title instead of crushing it, names and descriptions clamp to two lines, and cards in the Apps grid and the Features shelf have equal heights
* **studio:** Show as moved into the frame around the app on Preview and Design, and Enlarge (Preview) fills the window with the app
* **studio:** a Create button on the Apps page opens the new app dialog

### Example apps

* **studio:** eight example apps (Crew Board, Job Tracker, Invoices and Clients, Inventory, Appointments, Expense Log, Membership and Attendance, Reading List) with sample records, to open, try in Preview and change
* **studio:** Reset on Preview brings the sample records back

### Free grid

* **design:** a Grid can place parts freely on 12 columns. Drop a part on a cell, drag a placed part to move it, resize it with handles, or use Alt+Arrow to move and Alt+Shift+Arrow to resize. Refusals are spoken to screen readers
* **design:** a Place section in a part's settings (column, width, row, height) and "Choose column and row..." in Move to
* **runtime:** built apps draw a free Grid as a 12 column grid from the medium width up, and stack the parts in reading order below it

### Helper and free grid (pro build)

* **helper:** the helper can place parts on a free Grid when you ask for a dashboard, tiles or a position, and an ask keeps the places of parts you did not name
* **studio:** the review beside the prompt says what moved, in words such as "Placed Number tile at column 1, row 5, 3 columns wide"

### Built apps match the design

* **runtime:** a built app shows the app you designed and nothing else: its own menu bar, an Assistant button and Settings, and a way back from Settings and Data. Settings show only the sections the app uses plus "About this app"
* **design:** the canvas shows the app's live Preview records when Preview runs the latest saved design, else the example's records
* **installer:** uninstalling removes the shell's leftovers (logs, window position, the install folder registry key) and never your data

### Fix all and a way to add records

* **design:** "Fix all" connects the open page's unconnected parts in one step (one Undo)
* **design:** Design, Preview and Data offer to add a Form or a menu button for every table that nothing can add records to

### Assistant and helper reliability

* **assistant:** a number in a reply must come from a tool result of that turn, else the sentence is replaced. A reply that claims a change that did not happen is replaced with "Nothing was changed. Records change only after you press Approve."
* **assistant:** an unknown tool name is refused in one plain sentence and nothing runs. Tool results are framed to the model as data, not instructions
* **assistant:** a change that waits for your approval always needs the click in the desktop app, whatever the settings say
* **helper:** mechanical mistakes of small models (wrong-case ids, a reference to a missing table, an empty choice list, numbers the model invented) are repaired in code before they cost a retry (pro build)
* **helper:** an ask never removes a table, field or page it did not name, and a rename keeps the table (pro build)
* **studio:** the review's Done, Not done and It also changed lines are worked out from what changed in the design, not from the helper's own summary
* **docs:** docs/AI_BOUNDARY.md maps every place a model is called, what it gets, what it may return and what it can never reach

### Smaller and faster

* **build:** the Studio sidecar is about 73 KiB gzip smaller and the runtime sidecar about 73 KiB gzip smaller, by bundling one copy of three duplicated packages
* **studio:** the example apps load as separate JSON files, so the web bundle is about 13 KiB gzip smaller
* **helper:** an ask that names no table or field skips the tables step, only the pages an ask concerns are asked again, and an accepted page reply is kept for a repeat of the same ask (pro build)
* **assistant:** with less than 8 GB of free memory the default tools model is `qwen2.5:3b`

### Developer tooling

* **ci:** `npm run phase:gate` runs the checks one step at a time with a resumable summary, and `npm run phase:cleanup` removes finished worktrees (dry run by default)
* **ci:** flaky tests are classified by rerunning them alone and kept in a quarantine list, and the gate never raises a size limit by itself
* **docs:** docs/LESSONS.md lists the rules the project learned, each with its evidence and what enforces it

## 1.1.1 (2026-10-09)

The assistant now copes much better with small local models, backups stop more safely, update checks stay off until you point the app at your own releases repo, the built-in checks pass in a new git repo made from the kit, and the quickstart and docs are clearer.

This release includes every change listed under 1.1.0 below, which was not published on its own.

### Bug Fixes

* **checks:** `npm run check` and the pre-commit hook no longer flag the third-party author emails in the generated `THIRD_PARTY_NOTICES.md` after you commit the unzipped kit to git
* **docs:** the README notes that `npm run desktop:dev` also saves the window position under `%APPDATA%\<identifier>`

## 1.1.0 (2026-10-09)

The assistant now copes much better with small local models, backups stop more safely, update checks stay off until you point the app at your own releases repo, and the quickstart and docs are clearer.

### Features

* **assistant:** tool calls from small local models that wrap their arguments in a second call, echo the tool schema, or paste the whole tool list are now recovered instead of failing. Any write recovered this way still waits for the user's confirmation, even with `ASSISTANT_CONFIRM_WRITES=0`, and JSON quoted inside a normal reply is never run

### Bug Fixes

* **backup:** the backup worker is stopped only after it has finished loading. Some Node 24 builds can crash the whole app when a worker is stopped while it is still starting, for example when an upload is cancelled or the app closes right after a backup or restore begins
* **updates:** an app that still has the kit's placeholder releases repo never sends an update check and shows "Updates are not set up for this build." instead. `npm run desktop:build` prints a warning while the app still uses the kit's template name, identifier or releases repo, as a reminder to run `npm run init-app` before shipping
* **dev:** `npm run dev` now proxies to the same API port as the server, including an `APP_PORT` set in the shell, `.env` or `.env.local`
* **deps:** `proxy-addr` is updated for GHSA-jqcg-44mw-7w3h, so `npm audit --omit=dev` reports no issues

### Documentation

* README: the quickstart is split into single steps with a non-interactive `init-app` example, a tip to unzip into a short folder (Windows path limits), what `desktop:dev` writes, and the one-time Playwright browser install
* THIRD_PARTY_NOTICES.md and docs/RELEASING.md: installers built from the kit include the Node.js runtime, so ship its license with them
* docs/LICENSING.md and docs/ARCHITECTURE.md: clearer notes on copied activation records and on keeping the data folder private on Windows

## 1.0.1 (2026-10-06)

The quickstart now works on a fresh unzip, and renamed apps get the right "a" or "an" in their copy.

### Bug Fixes

* **desktop:** `npm run desktop:dev` no longer fails on a fresh checkout with "resource path binaries\...-server-<triple>.exe doesn't exist". It creates stand-ins for the sidecar and bundled resources when they are missing (a dev run uses `node server.js`), and never touches existing files
* **scripts:** `npm run init-app` fixes the indefinite article for the new name, so "a Starter App Pro feature" becomes "an Acme Notes Pro feature"

## 1.0.0 (2026-10-06)

First release of the starter this project grew from.

### Features

* **desktop:** Tauri v2 shell with a Node single-executable Express sidecar: per-launch secret, loopback-only binding, host-header guard (421), strict CSP and a Windows Job Object so the sidecar exits with the app
* **storage:** built-in `node:sqlite` with migrations, an automatic `.bak` before each migration, daily backups with one-click restore, and export/import (JSON, CSV and Markdown in a ZIP)
* **privacy:** opt-in network policy (`403 network_opt_in_required` until a feature is switched on), network activity log and audit log
* **ai:** local Ollama through `/api/chat`, RAM-based model recommendation, slow-hardware hint, optional bring-your-own-key OpenAI-compatible cloud provider with endpoint-bound consent and server-enforced per-category consent, and an approval flow for every change the helper proposes
* **licensing:** optional and pro: store license keys (one online verify, then offline), a local trial and capability gating (`requirePro`, `useEntitlements`); off while no store is configured
* **release:** release-please, Windows x64 and ARM64 installers with smoke tests, publishing to a releases repo with `SHA256SUMS.txt`, a side-by-side Dev channel, CI gate, PR bot, and Playwright end-to-end and accessibility tests, all driven by `config/release.json`
* **example:** the Items module, showing a full slice from migration to page, export and tests
* **scripts:** `npm run init-app` renames the app, identifier, package, data folder, repos and support contact in one command

### Documentation

* README, architecture and threat model, adding a module, AI boundary and consent, licensing, releasing, pipeline, Dev channel, and FAQ / troubleshooting
* Windows is the only tested platform. Mac and Linux are untested.
