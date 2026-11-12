# CLAUDE.md

Instructions for coding agents working in this repository.

Local App Studio is a local-first desktop app starter: a Tauri v2 shell around a Node (Express) server and a React/Vite UI, with a built-in assistant named Assistant. Storage is one SQLite file (`app.db`, `node:sqlite` `DatabaseSync`, WAL) in the user's data folder. The model runs on a local Ollama; a bring-your-own-key cloud provider is optional. Licensing (store license keys plus an automatic 14-day local trial) is optional and ships with placeholder config. The kit's example module is **Features** (the Studio feature library), which you copy to build your own.

A checkout without `pro/` is the public build.

Read `docs/PRODUCT.md` before planning any work. It lists the principles below in full. More detail: `docs/ARCHITECTURE.md` (process model, security, data folder), `docs/ADDING_A_MODULE.md` (the Features example in full), `docs/AI.md` (models, cloud provider, consent, approvals), `docs/DEV_CHANNEL.md` (the Dev build). Hard rules:

- AI summarizes, code calculates: compute every number in SQL or JS and pass only results to the model. Never ask a model to do math.
- Never paywall the user's data. Export, import, backups and privacy controls stay free.
- Data must never be lost: migrations take a `.bak` first, daily local backups with restore stay on by default.
- Local-first: no telemetry, no accounts, no outbound call without a `server/netPolicy.js` feature.
- Platform status: only Windows is tested. macOS and Linux builds are untested; do not claim support for them.

## Commands

Requires Node 24 or newer (`engines` in `package.json`; the server uses `node:sqlite`).

```powershell
npm ci
npm start                 # API on 127.0.0.1:4321 (APP_HOST / APP_PORT)
npm run dev               # Vite on :5174 (strictPort), proxies /api to 127.0.0.1:<APP_PORT> (default 4321; .env beats shell, as for the server)
npm run build; npm start  # single process, serves dist/
npm test                  # vitest: three projects, "frontend" (jsdom), "pure" (node, src tests without a DOM) and "backend" (node)
npm run lint
npm run gate              # the CI verify job locally, one step at a time, with a summary table
npm run gate -- --quick   # only the cheap steps on what changed (what the pre-push hook runs)
npm run gate -- --repair  # first run eslint --fix on changed files and commit "chore(gate): mechanical fixes" if the diff is mechanical (never in CI; the pre-push hook passes it)
npm run test:e2e          # Playwright (needs dist/ from npm run build)
npm run import -- [--dry-run] [--json] <zip>   # CLI importer for an export ZIP
npm run eval:ai           # real-model Assistant eval (pro: the runner and pro/docs/EVALS.md are not in the public repo); needs Ollama, not part of npm test
npm run check             # em dash, personal-data, private-key and workflow checks and the pro marker source check (also check:em-dash, check:personal, check:keys, check:workflows, check:pro-marker -- --require-present --source)
npm run check:workflows   # structural validator for the workflow files (the public repo has its own set, docs/PIPELINE.md "Two workflow sets"; rules WF-1 to WF-9); part of npm run check
npm run doctor            # this PC's tools, ports, data folder and helper, each Found / Missing / Problem with the next step (-- --json, -- --strict)
npm run debug:e2e -- <spec>   # one e2e spec headed with trace, video and APP_DEBUG=1 (-- --project <name>, -g <title>); docs/DEBUGGING.md
npm run check:store-config   # prints which stores in pro/config/store.json are configured
npm run check:bundle      # bundle size limit (run npm run build first)
npm run check:sidecar     # sidecar bundle/exe size limit per app mode (node scripts/desktop/buildSidecar.js --minify --bundle-only first; -- --mode studio|runtime, else APP_MODE)
npm run check:cloud-marker -- --require-absent|--require-present   # is the cloud provider in the sidecar and UI builds (docs/AI.md)
npm run check:pro-marker -- --require-absent|--require-present [--source]   # is the pro code in the web and sidecar builds (docs/ARCHITECTURE.md, "The pro seam"); --source checks the tree: every seam has a stub, a twin and a marker
npm run check:public      # builds the public half (APP_PRO_DIR=none: vite build, studio and runtime sidecar bundles) and proves no pro code is in it; leaves a public build in dist/
npm run sandbox           # throwaway server on a free port with demo data (-- --keep --port N --name slug); sandbox:reset wipes it. The fake helper answers the Prompt step with canned designs (loans, tasks, else a crew roster) and does a change it can read (add a field or table, a page for one record, remove a page, notes, a green look) or leaves the design as it is; -- --plain-ai gives one fixed line, -- --no-ai no helper
npm run seed:demo         # demo data CLI, temp dirs only: node scripts/seedDemo.js --data-dir <dir>
npm run preview:branch -- <branch|#N> [--dry-run]   # branch or PR in a temp worktree plus sandbox; preview:clean removes them
npm run fake:ollama       # fake Ollama for manual runs (canned Describe designs; -- --plain for one fixed line)
npm run desktop:dev       # tauri dev against `node server.js` and a temp data dir (never real data)
npm run desktop:sidecar   # esbuild + Node SEA -> src-tauri/binaries/ and src-tauri/resources/ (needs dist/)
npm run desktop:build     # build, sidecar, then tauri build (host target only)
npm run desktop:build:dev # "Local App Studio Dev" side-by-side test build (own identifier, data folder, update source)
npm run desktop:icons     # regenerate src-tauri/icons from src-tauri/icons/source.svg
```

Run long-lived processes (`npm start`, `npm run dev`) in the background and do not sleep-poll.

## Architecture map

- `server.js` - Express app. Order matters: host guard (421), CORS, rate limits, auth gate, secrets primer, routes, static UI, error handler. Exports `app` for supertest.
- `server/config.js`, `hostGuard.js`, `paths.js`, `runtime.js`, `channel.js`, `channelGuards.js` - host, port and origin resolvers, data folder, packaging seams, Dev channel isolation.
- `server/errors.js` - the one error envelope (`sendError`, `sendErrorFrom`, `limiterHandler`, `sseError`); the words and next actions are in `src/errors/` (`copy.core.js`, `copy.studio.js`, `surfaceCopy.js`), the client translator is `src/studio/lib/errorWords.ts`. `server/__tests__/errorEnvelopeBypass.test.js` fails on a route that builds its own error body. Built apps use `src/catalog/errorText.ts` and `packages/runtime/src/runtime/PageBoundary.jsx`.
- `server/log.js` - structured JSON logs (ring of 500, `<data folder>/logs/server.jsonl` rolling at 2 MB, 3 kept), `X-Request-Id`, stage timings, debug mode (`APP_DEBUG=1`); `server/processGuards.js` - uncaught exception and rejection handling (exit 5 only when unsafe).
- `server/diagnostics/` - doctor, port holders, the report ZIP and the Settings > Diagnostics routes; `npm run doctor` is `scripts/doctor.js`.
- `scripts/ci/gate*.js` - the gate's classification, quarantine (`.gate/flaky.json`), repair and ledger (`.gate/ledger.jsonl`); `scripts/ci/workflowCheck.js` - the workflow validator in `npm run check`; `scripts/ci/slowestReporter.js` - the ten slowest unit tests; `scripts/debugE2e.js` - `npm run debug:e2e`. Details in `docs/PIPELINE.md` and `docs/DEBUGGING.md`.
- `scripts/phase/gate.js` - the resumable two-build phase gate (`npm run phase:gate`); `scripts/phase/cleanup.js` - worktree cleanup, dry run by default (`npm run phase:cleanup`). Also in `scripts/phase/`: `ports.js` (port registry), `wait.js` (heavy-step lock), `state.js` (resume block), `merge.js`, `record.js`, `new.js`, `preview.js`, `common.js` (shared helpers), and `pro/scripts/phase/eval.js` (memory-safe real-model eval loop). Details in `docs/PIPELINE.md`, "Every phase script".
- `scripts/lib/fakeDescribeAnswers.js` - the canned Describe answers the sandbox's fake helper gives (shared with `e2e/support/describeFake.js`).
- `server/db/` - `index.js` (handle, `withTransaction`), `migrate.js` plus `migrations/NNN_name.sql` (forward-only, pre-migration `.bak`), `migrations.lock.json`, `query.js`, `tables.js` (the `TABLES` allowlist and `IMPORT_ORDER`), `codec.js`, `errors.js`.
- `server/dataAccess.js` - the shared app-state and conversation data API used by routes and the Assistant.
- `server/buildFeatures.js` - which optional features this build contains (`APP_CLOUD_AI`, baked in by the sidecar bundler). `isCloudAiInBuild()`, `featureUnavailableBody()`.
- `server/netPolicy.js` - outbound opt-ins. Features: `cloudAi`, `aiLan`, `updates`, `license`. State in `app_state` key `network.optIn`; env default `APP_NETWORK_OPTIN`. `server/networkCall.js` and `server/networkAudit.js` feed the network activity log.
- `server/ai/` - the only AI boundary. `index.js` is the public API (`getAiClient`, `requireAi`, `sendAiError`, sanitizers). Also `registry.js`, `settings.js`, `privacy.js` (cloud data categories), `consent.js`, `cloudGuard.js`, `queue.js`, `providers/ollama.js` and `providers/openaiCompat.js`.
- `server/aiSettingsRoutes.js` - Settings > AI API, first-run Ollama setup and the user-clicked model download (`POST /api/settings/ai/pull`).
- `server/agents/` - Assistant agent loop, `assistantTools.js` (tool specs and executor), `pendingActions.js` (write confirmation tokens), `toolCalls.js`, `runLock.js`, `prompts.js`.
- `server/assistant/` and `server/assistantAdvisorRoutes.js` - per-page advice (`pages.js` is the page allowlist, mirrored in `src/constants/assistantPages.js`).
- `server/license/` and `server/licenseRoutes.js` - optional store licensing, see `docs/LICENSING.md`. The store, activation, trial and entitlement code is pro (`pro/server/license/`, `pro/server/pro.js`, `pro/config/store.json`); `server/license/index.js` and `server/pro.js` are the public stubs (licensing off: Pro is on, nothing to activate; a pro build swaps in the twins `pro/server/license/index.js` and `pro/server/pro.js`), and `buildInfo.js`, `channelSeam.js`, `constants.js` and `messages.js` stay open. With a store configured, `initLicense` starts a 14-day trial on first launch (no record and no activation); `POST /api/license/trial` is gone (`410 trial_route_removed`) and `POST /api/license/trial/notice` records dismissed one-time notices. `server/pro.js` is the one Pro gating seam (`PRO_FEATURES`, `requirePro`, `assertPro`, `isProEnabled`); a pro build swaps in `pro/server/pro.js`, which has the same names.
- `server/backup/` - automatic daily local backups and restore. `server/exportRoutes.js` and `server/export/` build the export ZIP (JSON, CSV, Markdown, `manifest.json`); `server/importRoutes.js` and `server/import/importExport.js` import it.
- `server/ingest/` - the document parser (PDF, DOCX, text to page text with positions), run in a child process, see `docs/INGEST.md`. `server/ingestRoutes.js` is `POST /api/ingest/parse`. `server/entry.js` (dispatcher) and `server/role.js` pick the process role for the sidecar bundle and the parser child (`--role parser`).
- `server/secrets/` - encrypted saved API keys (`secrets.key` is created in the data folder). `server/audit.js` - audit log.
- `server/desktop/` - sidecar-only code active when `APP_DESKTOP=1`: stdin handshake, auth gate, CSP.
- `src-tauri/` - Tauri v2 shell, no product code. See `src-tauri/README.md`.
- `scripts/desktop/` builds the sidecar (the installer build itself, `build.js`, is pro: `pro/scripts/desktop/build.js` behind a public stub, run through `scripts/lib/proRun.js`); `scripts/release/` keeps the release config and the placeholder check, the release automation (`publishPublic.js`, `smokeSidecar.js`, `smokeInstaller.js`) and `scripts/packageTemplate.mjs` are pro under `pro/scripts/`; `scripts/checks/` is the hygiene checks (`storeConfig.js` is pro); `scripts/license/writeBuildInfo.js` writes the build date. The build service is `pro/server/studio/build/`, behind the public stubs `server/studio/build/service.js` and `toolchain.js`, and `buildRoutes.js` mounts `requireInBuild('installer')` first on every route.
- `pro/` and `scripts/lib/proDir.js` - the pro seam (docs/ARCHITECTURE.md, "The pro seam"): the source-available modules (helper, Make installer, licensing, cloud provider; FSL-1.1-MIT, `pro/README.md`) each sit at the same path under `pro/` behind a public stub at the original path. `PRO_SEAMS` lists them, `resolveProDir` is the one reader of `APP_PRO_DIR`, `scripts/lib/proSeam.js` has the Vite and esbuild plugins, `proHook.js` the Node hook for unbundled runs and `proRun.js` runs a pro CLI. `src/proParts.js` and `requireInBuild` in `server/buildFeatures.js` say which parts a build has; `scripts/checks/proMarker.js` proves it. A new pro module that open code imports needs a stub, a `PRO_SEAMS` entry and a `PRO_MARKER` at the end of the twin.
- `packages/runtime/` - `@local-app-studio/runtime` (MIT, npm workspace): `src/runtime`, `src/spec`, `src/theme`, `src/catalog/parts` and `server` (the runtime routes), imported as `@local-app-studio/runtime/<path under src/>` and `@local-app-studio/runtime/server/<file>` (aliases in `scripts/lib/runtimeAlias.js`, docs/ARCHITECTURE.md, "The runtime package").
- `src/` - `pages/` (one per module, routed in `App.jsx`), `components/`, `hooks/`, `services/` (API clients), `utils/`, `auth/`.
- `packages/runtime/src/theme/` - the theme engine (themes, resolver, allowed variables, runtime apply), see `docs/THEMES.md`. `src/studio/theme/` has `ThemeScope`, the picker and Change look; `src/studio/showcase/` the Features page tiles, drawer and previews; `src/studio/design/` the drag and drop Design canvas (`@dnd-kit`) with the pure tree helpers in `src/studio/lib/layoutTree.ts`. `src/vendor/ui-builder/` stays in the repo, unused.
- `packages/runtime/src/runtime/` - what a built app runs; `AppMenu.jsx` is the menu bar (top or side) built from the spec's `nav` and `menu`, `SpecRenderer.jsx` draws the layout tree, `dataClient.js` calls `/api/data`. `packages/runtime/server/stats.js` and `routes.js` answer the group-by stats query (`GET /api/data/:table/stats?groupBy=`, one count, sum or average per value, extra groups folded into `other`) that Chart uses.
- `src/catalog/` - the part catalog. `pro/src/catalog/modelParts.ts` (the helper moved to `pro/`, docs/ARCHITECTURE.md 'The pro seam') has the core and optional part lists and the page size caps (`PAGE_SCHEMA_MAX_BYTES`, `PAGE_PROMPT_MAX_BYTES`, ADR-008); the parts themselves are in `packages/runtime/src/catalog/parts/` (`navItems.ts` the pages a NavLinks part or the menu may link to, `chartModel.ts` the Chart data model and `layoutClasses.ts` the literal Tailwind class tables of Columns and Row). `src/studio/showcase/search.ts` is the pure shelf search and ordering; `src/studio/lib/choiceProps.ts` lists the enum and number props a person may change in Design, with plain labels.
- Studio features by phase (sizing, menu slots, data connections, Prompt review and Feature builder, consumer fixes, examples, free grid, built app fidelity, Fix all and ways in): `docs/ARCHITECTURE.md`, "Studio feature map by phase".
- `pro/config/store.json` (licensing values, pro) and `config/release.json` (release repos) are the two owner config files.

## The example module: Features

Copy this to add a module. Every layer has one file you can duplicate and rename.

| Layer | Files |
| --- | --- |
| Migration | `server/db/migrations/004_features.sql` (plus its hash in `migrations.lock.json`); it creates `studio_features` and drops `items` |
| Table registry | `server/modules/studio.data.js` (the module descriptor: `tables`, `importOrder`, `dataTables`, cloud category and tool maps). `server/db/tables.js` keeps only the kit tables |
| Validation | `src/catalog/features/*` (pure library: `validateFeatureInput`, expansion, limits, seeds), shared by the store, the import path and the browser |
| Store | `server/studio/features/store.js` and `usage.js` (every read re-validates the stored body) |
| Routes | `server/studio/features/routes.js`: `/api/studio/features` CRUD, import and duplicate |
| Assistant tool | `server/modules/studio.tools.js`: the read tool `list_features` (Studio has no write tool) |
| Write confirmation | `server/agents/pendingActions.js`, `src/components/assistant/ConfirmActionCard.jsx` (the runtime `save_record` pattern) |
| Cloud category | `features`, declared in `studio.data.js`; `server/ai/privacy.js` and `src/constants/cloudAi.js` |
| UI | `src/studio/pages/FeaturesPage.tsx`, `src/studio/showcase/*` (tiles, drawer, previews), `src/studio/pages/FeatureBuilderPage.tsx`, `src/studio/builder/*`, `src/studio/components/Feature*.tsx`, `SaveFeatureDialog.tsx`, `src/studio/hooks/useFeatures.ts`, `src/studio/services/studioApi.ts`, `src/modules/studio.jsx` |
| Export and import | the `dataTables` entry in `studio.data.js` (read through `DATA_TABLES`), `server/export/*` (`MARKDOWN_RENDERERS` in `buildArchive.js`, empty), `server/import/importExport.js` |

The full walk-through is in `docs/ADDING_A_MODULE.md`. Checklist for a new module (`widgets`, for example):

1. Add `NNN_widgets.sql` (next number) and its sha256 (CRLF normalized to LF) to `server/db/migrations.lock.json`. Never edit a shipped migration.
2. Declare the table in your module descriptor (like `server/modules/studio.data.js`): `tables`, then, parents before children, `importOrder`, and a `dataTables` def so it is exported.
3. Add one validation function (pure, like `validateFeatureInput`), a store like `server/studio/features/store.js` and routes like `server/studio/features/routes.js`.
4. Add Assistant tools to your module's tools file (like `server/modules/studio.tools.js`), their category in the descriptor's `toolCategories` (an array when a result spans categories, for example `['alpha', 'beta']`), and, for a write tool, its name in `WRITE_TOOLS` plus a line in `describeWrite()` in `server/agents/pendingActions.js`.
5. Add the page, components, hook and service, route it in `src/App.jsx`, and add it to `src/constants/assistantPages.js` and `server/assistant/pages.js` together.
6. Add tests (migration safety, routes, tools, UI) and run `npm test`, `npm run lint`, `npm run check`.

## Security invariants (do not break)

- Never add an outbound call without a `server/netPolicy.js` feature (new id and hosts in `NETWORK_FEATURES`, `requireNetwork(id)` on the route or `assertNetworkEnabled(id)` in library code). A gated-off feature answers `403` with `code: 'network_opt_in_required'` and `feature` (the error envelope).
- The model download is the one documented exception: it only talks to a loopback Ollama and runs only on a user click. Never add an automatic or background pull.
- Never call a cloud model by default. A non-loopback Ollama needs the `aiLan` opt-in. The cloud provider needs `cloudAi`, a current consent for that exact base URL, a public https base URL, and a saved key and model. A broken cloud setup falls back to local, never the reverse.
- Cloud data categories are enforced on the server. Every model call passes a `scope`, and withheld categories never reach the transport.
- All AI goes through `server/ai/index.js`. No provider imports outside `server/ai/`, enforced by `server/__tests__/aiBoundary.test.js`.
- All database access goes through `server/db/query.js` with identifiers allowlisted in `server/db/tables.js`. No SQL built from request input.
- Assistant writes are parked behind a confirmation token (`ASSISTANT_CONFIRM_WRITES`, default on). Never execute a write tool straight from the model loop.
- Stream model output through `createStreamSanitizer()` and non-streamed output through `sanitizeModelText()`. Never echo provider error text to the client (use `classifyAiError`).
- Pro gating is by capability through `server/pro.js` only (the stub; a pro build swaps in `pro/server/pro.js`). Mount `requirePro(id)` first on a Pro route, before body validation and before `requireAi`. Never gate data, export, import, backups or privacy.
- Parsing runs in a child process with no env and no data folder access; new formats only in `server/ingest/` (`ingestBoundary.test.js` enforces it).
- Never log secrets or request bodies: log through `server/log.js`, which keeps only short scalar fields and redacts them. Responses for secrets, data and export routes are `no-store`.
- Desktop mode: loopback bind only, per-launch secret handshake, CSP headers. `APP_PASSWORD` and `AUTH_SECRET` are ignored in desktop mode.
- Dev channel isolation (`server/channelGuards.js`): a Dev server refuses a data folder that is, contains or lies inside the stable one. Keep the guards.
- Browser storage keys go through `lsKey()` (`src/utils/storageKeys.js`), prefix `app.`.
- Never commit a private key, token or personal data. Fixtures are synthetic.
- A cloud-off build (`APP_CLOUD_AI=off`) has no cloud provider in it: `scripts/desktop/cloudBuild.js` swaps `openaiCompat.js` and `src/components/settings/cloudUi.js` (public stubs at those paths; the real code is `pro/server/ai/providers/openaiCompat.js`, `pro/server/ai/llmClient.js` and `pro/src/components/settings/cloudUi.js`, `CloudAiBlock.jsx`, `CloudAiConsentDialog.jsx`, `CloudCategoryList.jsx`) for the `.disabled` stubs and refuses the pro twins, `cloudAi` answers `403 feature_unavailable`, and `check:cloud-marker -- --require-absent` proves it. Never import the provider or the cloud UI around those seams.

## Conventions

- Error contracts: every error body, and every SSE `error` payload, is the envelope `{ error: <plain sentence>, code: <snake_case>, action: <one next step>, requestId, details? }` built by `server/errors.js` (`sendError`, `sendErrorFrom`, `limiterHandler`, `sseError`). `error` is the sentence and `code` the machine code; `message` is a deprecated alias equal to `error`, kept for this phase. Code-specific extras (`issues`, `field`, `feature`, `reason`, `hint`, `retryMs`) stay top level; `details` is diagnostic only and redacted. Never write `res.status(4xx|5xx).json(` in a route: a new code gets a row (sentence and action) in `src/errors/copy.core.js`, or `copy.studio.js` for Studio only, and a row in the "Error codes" table in `docs/DESIGN.md` (both are tests). Examples: gated-off network feature `403 network_opt_in_required`; AI that cannot run `503 ai_not_configured | ollama_unavailable`; full queue `429 ai_busy`; Pro off `403 pro_required`; wrong Host `421 host_not_allowed`; unmatched `/api/*` `404 not_found`. Errors are sent before any SSE stream opens. Feature validation is `400 invalid_feature` with `issues`. Clients key on `body.code ?? body.error`.
- Feature missing from the build: `403` with `code: 'feature_unavailable'` and `feature` (`server/buildFeatures.js`).
- Migrations are immutable once shipped (`server/__tests__/migrationSafety.test.js` enforces the lock and upgrades a populated database from every older version).
- Conventional commits (`feat(scope): ...`), branches `feat/`, `fix/`, `chore/`, `docs/`.
- Copy: no em dashes anywhere (`npm run check:em-dash`). In store and release text, describe the product as a desktop app with a built-in helper, not as a hosted model or chatbot (some stores prohibit selling model access).
- Explain the root cause before fixing a bug. Do not add features beyond the task.

## Testing

- Tests live in `server/__tests__/` and `src/**/__tests__/`. Vitest has three projects (`vitest.config.js`): `frontend` (jsdom: `src` `.jsx` and `.tsx` tests plus the `.js` and `.ts` ones listed in `SRC_DOM_TESTS`), `pure` (node: the other `src` `.js` and `.ts` tests, no DOM) and `backend` (node: `server/__tests__`). A new `src` `.js` or `.ts` test that needs a DOM goes in `SRC_DOM_TESTS` or is written as `.jsx` or `.tsx`.
- Backend tests use the real temp SQLite helper `server/__tests__/helpers/testDb.js`, not DB mocks. Under Vitest the data folder comes from `APP_TEST_DATA_DIR`, so tests never touch a real one.
- Tests never need a real Ollama: use `server/__tests__/helpers/fakeOllama.js`. `npm run eval:ai` is the separate real-model check.
- Lessons learned across phases, each a rule with its evidence and the test or script that enforces it: `docs/LESSONS.md`. Read it before planning a phase, a brief or a review.
- The network guard (`server/__tests__/setup/networkGuard.js`) blocks non-loopback sockets and loopback ports 11434, 4321 and 5174. Mock `fetch`.
- License tests inject the clock and a stub `fetchImpl`. Tests never call a real store API.
- Rust: `cargo test` in `src-tauri`, after `npm run build` and `npm run desktop:sidecar`.

## Desktop environment variables

| Variable | Set by | Meaning |
| --- | --- | --- |
| `APP_DESKTOP` | shell | `1` turns on desktop mode (gate, CSP, stdin handshake, ready line) |
| `APP_DIST_DIR` | shell | Folder with the built UI (default: `dist/`) |
| `APP_MIGRATIONS_DIR` | shell | Folder with the SQL migrations (default: `server/db/migrations`) |
| `APP_DESKTOP_DATA_DIR` | developer, read by the Rust shell | Becomes `APP_DATA_DIR` for the sidecar. `desktop:dev` sets it to a temp folder. Set it per shell only. On Windows `secrets.key` relies on the folder's inherited ACL, so never point it at a shared folder |
| `APP_CHANNEL` | build scripts, CI | `dev` or `stable` (unset is `stable`). A bundle gets its channel from a build-time define |
| `APP_DISPLAY_VERSION` | build scripts, CI | Dev build display version; required for dev, refused for stable |
| `APP_SHELL_CHANNEL` | shell | Always set for the sidecar; the server exits 1 when it differs from its own channel |
| `APP_CLOUD_AI` | build scripts, CI | `on` (default) or `off`. `off` builds with no cloud provider (docs/AI.md); any other value fails the build. A bundle gets it from a build-time define |
| `APP_PRO_DIR` | developer, build scripts, CI | Unset or empty: build with `pro/` when it is present, else the public build. `none`: the public build even when `pro/` is present. Any other value: that folder (a missing folder fails the build). Read by `scripts/lib/proDir.js` only; `scripts/lib/proHook.js` writes the decision back for child processes (docs/ARCHITECTURE.md, "The pro seam") |

Server exit codes: `0` clean shutdown, `1` startup failure, `2` invalid desktop handshake, `3` startup recovery of an interrupted restore failed, `4` the Studio preview child only (`APP_PREVIEW_CHILD=1`, set by the preview manager): its app migrations could not be applied (not the backup step). The main server and built apps exit `1` for that. `5` the server stopped itself after an unexpected error left it in an unsafe state (an open transaction, a damaged database, stack overflow, out of memory, or a second uncaught error within 60 seconds; `server/processGuards.js`, `docs/DEBUGGING.md`). Any other uncaught error answers the request with `server_error` and the server keeps running.

## Windows notes

PowerShell 5.1 is the default shell on Windows: chain with `;` not `&&`, and use `$env:VAR` not `$VAR`. Use absolute paths in tool calls, because the working directory can reset between shell calls. In Git Bash, discard output with `/dev/null`, never `nul`.
