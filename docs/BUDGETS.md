# Size budgets

The live ledger: the current limits, the base measurements, the rules and how to measure. Every per-phase table and the reasons each limit was set are in [budgets/HISTORY.md](budgets/HISTORY.md), which is history and is not updated. Limits live in `scripts/checks/bundle-budget.json` (web UI, `npm run check:bundle` after `npm run build`) and `scripts/checks/sidecar-budget.json` (server, `npm run check:sidecar` after `node scripts/desktop/buildSidecar.js --minify --bundle-only`). All sizes are gzip KiB unless noted.

## The live table

Base: `main` at 0c4d6b0, the phase 26 gate at da60e58 (source: `docs/phase27/DESIGN-phase27.md`, section 1). The 2 percent line is the headroom at which the ledger prints "Needs a decision" (`scripts/ci/gateLedger.js`).

| Budget | Limit | Pro build (base) | Public build (base) | 2 percent line | Pro after phase 27 |
| --- | ---: | ---: | ---: | ---: | ---: |
| web total JS gzip KiB | 530 | 529.22 | 526.41 | 519.40 | 516.49 |
| studio sidecar raw KiB | 3807 | 3804.07 | 3646.36 | 3730.86 | 3355.71 |
| studio sidecar gzip KiB | 1153 | 1156.71 (OVER) | 1100.86 | 1129.94 | 1083.66 |
| runtime sidecar raw KiB | 3497 | 3431.34 | 3387.42 | 3427.06 | 2983.05 |
| runtime sidecar gzip KiB | 1053 | 1035.47 | 1021.03 | 1031.94 | 962.36 |

The base columns are the measurements at the base. The "after phase 27" column is the pro build after the changes below (the public web total after phase 27 is 513.69).

Phase 27 (headroom without a raise). `check:sidecar` prints the top 30 input files from the esbuild metafile (`.sidecar-build/metafile.json`; the gzip column is apportioned by raw share). Studio sidecar 3804.05 raw and 1156.69 gzip KiB became 3355.71 and 1083.66; runtime sidecar 3431.34 and 1035.47 became 2983.05 and 962.36 (limits unchanged). Cause and cut: npm nests mime-db 1.54.0 four times; `scripts/desktop/dedupePackages.js` bundles one copy per name and version of mime-db, mime-types and content-type. Pro web total 529.22 became 516.49 KiB gzip and public 526.41 became 513.69: the sixteen example chunks became `public/examples` JSON. Open cut candidates if a limit tightens again: iconv-lite CJK tables (about 100 KiB gzip, would drop request charsets) and the Studio Assistant markdown renderer (44.2 KiB web).

Phase 27 measured changes: see docs/phase27/STATUS-phase27.md

Limits that were not re-measured at the base. Their last recorded values are in [budgets/HISTORY.md](budgets/HISTORY.md), "Phase 23: measured at the gate" (initial JS 130.29, CSS 31.74, pro build).

| Budget | Limit | Where it is pinned |
| --- | ---: | --- |
| web initial JS gzip KiB (entry plus static imports) | 146 | `scripts/checks/bundle-budget.json`, `server/__tests__/ciPipeline.test.js` |
| web largest chunk gzip KiB | 150 | the same two |
| web CSS gzip KiB | 36 | the same two |
| SEA executable `win32-arm64`, KiB | 83712 | `scripts/checks/sidecar-budget.json` (`exeKb`) |

### Describe model size

Helper prompt budgets are kept with the helper (pro, not in the public source).

## Rules

- **The gate never raises a budget.** A "Needs a decision" line is printed and the gate goes on; a raise is a person's commit with a rationale in this file and in both pins (below). `server/__tests__/gateNoSelfRaise.test.js` checks that no write call in `scripts/ci/*.js` names a limit file, a pin, a test or a workflow; that the state and ledger paths are under `.gate/`; that only `gateRepair.js` edits source (through `eslint --fix`, one commit with its fixed subject, no push); that the two budget scripts write only their `--json` file and the step summary; and that the CI `verify` job has `contents: read` and no `git commit` or `git push`.
- **Needs a decision.** When a budget's headroom is under 2 percent the gate summary prints "Needs a decision: raise with a rationale in BUDGETS.md" with the budget id and its two pins. The standing recommendation is to cut, not to raise; the headroom comes from bytes leaving.
- **Cut, do not split, when the total is the problem.** `totalJsGzipKb` is the gzip sum of every JS chunk, lazy or not (`scripts/checks/bundleBudget.js`, `total(js)`), so a code split restores nothing in the total. A split only helps `initialJsGzipKb`.
- **Pins.** Web limits: `scripts/checks/bundle-budget.json` and `server/__tests__/ciPipeline.test.js`. Sidecar limits: `scripts/checks/sidecar-budget.json`, `server/__tests__/ciPipeline.test.js` and `server/__tests__/sidecarBudget.test.js`. A raise changes the limit file and every pin in the same commit (a sidecar raise that missed `sidecarBudget.test.js` is recorded in budgets/HISTORY.md, phase 10). ADR-006 allows a sidecar raise with a rationale in this file.
- **Per-mode sidecar limits.** `sidecar-budget.json` holds `studio` and `runtime` limits (the exe limit is shared). `npm run check:sidecar` takes `--mode studio|runtime`, else `APP_MODE`, else studio. `buildSidecar.js` writes `.sidecar-build/bundle-meta.json` with the mode it baked in, and the check fails when that differs from the requested mode (without the file it prints a note and checks anyway). The `sidecar budget` step of `ci.yml` checks both modes.
- **Web limits are shared by both modes** (`bundle-budget.json` has one set). The runtime web UI has no total JS budget; its initial JS is held to the same 146. Studio builds emit no runtime chunk (`src/modules/runtime.jsx` is dropped when Vite bakes `__APP_MODE__` as `studio`).
- **Runtime pages never load the editor.** `packages/runtime/src/runtime/SpecRenderer.jsx` maps a layer to its catalog component through `src/catalog/components.ts` (no zod, no `@/vendor`); `packages/runtime/src/runtime/__tests__/noEditor.test.js` and `modeBuild.test.js` guard it.
- **zod import form.** Every zod import is `import * as z from 'zod'`. `import { z } from 'zod'` keeps the whole `z` namespace object, including `z.locales` (264 KiB of translations), out of tree shaking, and an ESLint `no-restricted-imports` rule (`eslint.config.js`) rejects the named `z` import outside type-only imports.
- **The editor is kept out of the initial chunks.** `vite.config.js` has a rolldown group `shared` (modules shared by two or more chunks, which the entry imports because kit pages use them). Its test skips `src/vendor`, `src/catalog`, `src/studio`, `packages/runtime/src/runtime` and `packages/runtime/src/spec`, so those modules stay in the lazy chunks of the routes that import them. `server/__tests__/modules/chunking.test.js` builds the app with the real config and fails if any of those folders, zod, zustand, react-hook-form, dnd-kit, sonner, react-resizable-panels or radix land in the entry chunk or a chunk it imports statically. A second trap, guarded by the same test: the designer must not import the vendored `registry/form-field-overrides.tsx`, whose `import * as` of lucide-react keeps every icon in the bundle (225 KiB minified) and pulls react-router into the entry (initial JS was 308 KiB). `src/studio/designerRegistry.tsx` writes its own two small field overrides instead. The `editor-libs` rolldown group holds `@dnd-kit` only since phase 7 (`chunking.test.js` guards the group facts; their history is in budgets/HISTORY.md, "Merged (phase 2 + 3)").
- **Example weight.** The eight examples are `public/examples/<id>.spec.json` and `<id>.records.json` (sixteen files), fetched when a person clicks "Use this example" and excluded from the runtime template (`pro/scripts/packageTemplate.mjs`); `src/studio/examples/__tests__/examples.test.tsx` fails above 14336 bytes of gzip for the sum of each spec plus its records (11913 at phase 20).
- **A UI phase states its byte plan in the brief** and the gate's measured delta in STATUS (docs/LESSONS.md, rule B1 of the budget group).

## What each budget counts

- **Web initial JS**: the entry chunk plus its static imports (the first paint). The editor must never reach it.
- **Web total JS**: every JS chunk of the Studio build, lazy or not. Runtime-only code (`src/modules/runtime.jsx`) is not in a Studio build.
- **Web largest chunk** and **web CSS**: the biggest single JS chunk and the CSS gzip. Tailwind scans `pro/src/` through an explicit `@source` in `src/index.css`.
- **Studio sidecar** (raw and gzip of the minified `server.cjs` bundle; `--minify --bundle-only`): the Studio server (`server/studio/**`, the Describe route and pipeline, preview manager and proxy), zod's `toJSONSchema` (the page-step schema is built per page at run time), the runtime server the Preview child runs from the same exe (compiler, data API, Assistant tools), the 19 pure part definitions, the error envelope with the 169-row copy table, structured logs, process guards and diagnostics (56.95 KB raw and 19.13 KB gzip at phase 15), and the pro helper pipeline in a pro build. History: budgets/HISTORY.md, phases 3, 8, 15.
- **Runtime sidecar**: the runtime server only. Built apps carry `copy.core.js`, never the Studio copy rows. A cloud-off or public build is smaller (the public build column above).
- **Dev sidecar source maps** are not in any budget: `buildSidecar.js --sourcemap` (what `desktop:build:dev` passes) is about 4.5 times the shipped bundle, and the shipped installer is built without it.

## The ledger and the "needs a decision" rule

Every full `npm run gate` (and every CI verify run) appends one line to `.gate/ledger.jsonl` (ignored by git; an artifact in CI) with the measured numbers: test counts, step durations, the bundle and sidecar sizes and each budget's headroom. The gate summary prints each budget's headroom and the change since the last full run. When a budget's headroom is under 2 percent the summary prints "Needs a decision: raise with a rationale in BUDGETS.md" and names the two pins (`server/__tests__/ciPipeline.test.js` and `server/__tests__/sidecarBudget.test.js` for the sidecars, `scripts/checks/bundle-budget.json` and `server/__tests__/ciPipeline.test.js` for the web limits). The gate never edits a limit or a pin; a raise is a person's commit with a rationale here, as for every phase in the history (`server/__tests__/gateNoSelfRaise.test.js`). The full rules are in [PIPELINE.md](PIPELINE.md), "The ledger and the needs a decision rule".

## Limits

Where a person, a file or a model can hit a size, each refusal names its limit in plain words. Measured with the break tests: a page of 10000 rows with stats answers in under 2 s, and a 50 MB upload gets 413 or a closed connection, never a 5xx.

| Limit | Value | Where it is enforced | Message |
| --- | --- | --- | --- |
| Design (spec) size | 512 KB (524288 characters of JSON) | `LIMITS.specChars`, `packages/runtime/src/spec/schema.ts` | "An app design may be at most 512 KB." |
| Request body, Studio and data routes | 2 MB | `express.json` limit, `server.js` | "That request is larger than the 2 MB this app accepts at once." |
| Spec JSON depth and values | 80 levels, 150000 values | `SPEC_SHAPE`, `server/studio/specCheck.js` | "Values may nest at most 80 levels deep." and "This app has too many values." |
| Tables per app | 30 | `LIMITS.tables` | "An app may have at most 30 tables." |
| Fields per table | 60 | `LIMITS.fieldsPerTable` | "A table may have at most 60 fields." |
| Pages per app | 30 | `LIMITS.pages` | "An app may have at most 30 pages." |
| Sources per page | 8 | `LIMITS.sourcesPerPage` | "A page may have at most 8 sources." |
| Menu items | 20 | `LIMITS.nav` | "The menu may have at most 20 items." |
| Parts per page | 300 | `LIMITS.layersPerPage` | "A page may hold at most 300 parts." |
| Part nesting | 16 levels | `LIMITS.layerDepth` | "Parts may nest at most 16 levels deep." |
| Apps | 200 | `MAX_APPS`, `specCheck.js` | "You can keep up to 200 apps. Delete one first." |
| Saved features | 100 | `FEATURE_LIMITS.library`, `src/catalog/features/limits.ts` | "You can keep up to 100 features. Delete one first." |
| Describe description | 2000 characters | `INSTRUCTION_MAX`, `server/studio/describeRoute.js` | "Describe the app in 1 to 2000 characters." |
| Describe model reply | reply size and repair limits are kept with the helper (pro) | the helper pipeline (pro) | repair, then a per-page fallback |
| Model reply read per call, per line, JSON body | 512 KiB, 1 MiB, 5 MiB | `server/ai/bodyCap.js` | plain model-server error |
| Model wait | first token 300 s, total 5 min | `server/ai/registry.js` | timeout message |
| Model queue | 8 waiters, 300 s | `server/ai/queue.js` | 429 `ai_busy` |
| Data list page | default 50, max 200, offset max 100000 | `packages/runtime/server/params.js` | "limit must be from 1 to 200." |
| Filters | 8 per request, 50 values in `in`, 20000 characters | `params.js` | "Use at most 8 filters." |
| Search text, sorts | 200 characters, 3 | `params.js` | named per field |
| Chart groups | 12 plus other | `packages/runtime/server/stats.js` | none (extra groups fold into other) |
| Record id or reference | 200 characters | `routes.js`, `validate.js` | 404, or "must be the id of a record." |
| Import upload | 16 MB | `IMPORT_MAX_BODY`, `server/importRoutes.js` | "This file is too large to restore here. The limit is 16 MB." |
| Import archive | 64 MB inflated, 64 MB per entry, 500 entries, 200000 rows per table | `server/import/importExport.js` | `import_too_large` |
| Design file picked in the browser | 600 KB | `src/studio/components/ImportSpecButton.tsx` | "That file is too large. An app design file can be up to 600 KB." |
| Preview proxy response | 8 MiB, idle 30 s, request 30 s | `server/studio/preview/proxy.js` | 502 or 504, plain |

Stats (`GET /api/data/:table/stats`) load the numeric columns of every matching row into memory, because `server/db/query.js` has no aggregates. That is fine for local tables up to the import cap of 200000 rows.

## Concurrency

Saving is not last write wins. Every save carries the revision it started from. If another window saved first, the server answers 409 `revision_conflict` ("This app changed in another window. Reload it and try again.") and writes nothing. Two saves of the same revision at once: exactly one wins and the revision goes up by 1. The losing window keeps its unsaved edits on screen, writes nothing and says "This app changed in another window, so your change was not saved. Your edits are still here. Reload this page to get the latest version, then make the change again." A reload loads the latest saved version and drops the unsaved edits. Saving while Preview starts or runs restarts Preview at the new revision. A build records the revision it started with; a save during a build is allowed; a build request with an old revision gets the same 409. Saving after the app was deleted elsewhere answers 404 "That app does not exist. It may have been deleted."

## Em dash check scope

`npm run check:em-dash` (`scripts/checks/noEmDash.js`) now covers every tracked text file the repo owns, not only `src/**/*.jsx`: code (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`) and text (`.json`, `.md`, `.yml`, `.css`, `.html`, `.sql`, `.sh`, `.toml`, `.rs`, `.nsh`). It reports em dashes and en dashes, as literal characters anywhere (comments included) and as entities or escapes outside comments. It skips `src/vendor/`, `package-lock.json`, `LICENSE` and `NOTICE` files, `THIRD_PARTY_NOTICES.md`, the check's own source and the tests that spell the characters out.

## Re-measuring

```powershell
npm run build; npm run check:bundle
node scripts/desktop/buildSidecar.js --minify --bundle-only; npm run check:sidecar
$env:APP_MODE = 'runtime'; node scripts/desktop/buildSidecar.js --minify --bundle-only; npm run check:sidecar -- --mode runtime   # runtime sidecar, then clear APP_MODE
$env:APP_MODE = 'runtime'; npx vite build --outDir $env:TEMP\dist-runtime --emptyOutDir   # runtime UI sizes, then clear APP_MODE
```

For a runtime web build, `config/app-spec.json` is set temporarily to `packages/runtime/src/spec/fixtures/crew-roster.json` (never committed), or use the command above. The public build is `npm run check:public`.

## Where the per-phase sections went

Every per-phase table and rationale is in [budgets/HISTORY.md](budgets/HISTORY.md), in phase order, under the headings they had here: "Phase 1: Web UI before and after" with its rationale for the raised limits, "Phase 2: Runtime", "Studio (phases 1 to 3)", "Merged (phase 2 + 3)", the phase 5, 6, 7, 8, 9, 10, 11, 15, 20 and 23 sections, "Test suite times" (phase 11) and short pointers where the "Describe model size" sections were (their detail is kept with the helper, pro).
