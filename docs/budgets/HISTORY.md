# Budget history

This is history, not the live ledger. The current limits, the base measurements, the rules and how to measure are in [../BUDGETS.md](../BUDGETS.md). Nothing here is updated after a phase ends: every number is what was measured at the time named in its section.

The sections are the per-phase sections of `BUDGETS.md` as they stood at `main` 0c4d6b0, moved word for word and ordered by phase. Edits: the relative link to PIPELINE.md now starts with `../`; the "Describe model size" sections sit under the phase that wrote them (they were all in the phase 6 section or at the end), and the phase 8, 9 and 10 sentences that pointed at them as "the phase 6 section above" now say "the ... section below"; the headings of the phase 1, phase 2, Studio and phase 22 sections were written for this file. The "Describe model size" headings are unchanged, so a link such as "BUDGETS.md, Describe model size, phase 8" is found here under the same heading. The "Re-measuring" commands, the Limits, Concurrency and Em dash check scope sections, the chunking and zod rules and the ledger rule stayed in `BUDGETS.md` because they are rules, not history. Sizes are gzip KiB unless noted.

Measured at the end of phase 1 (the designer and preview spike, Tailwind 4, the vendored ui-builder, the spike catalog). Limits lived in `scripts/checks/bundle-budget.json` (web UI, `npm run check:bundle` after `npm run build`) and `scripts/checks/sidecar-budget.json` (server, `npm run check:sidecar` after `node scripts/desktop/buildSidecar.js --minify --bundle-only`).

## Phase 1: Web UI before and after

"Before" is the tree at the end of the Tailwind 4 move, with the vendored editor present but not routed. "After" is the end of phase 1, built in studio mode.

| Metric | Before | After (studio) | Limit before | Limit now |
| --- | ---: | ---: | ---: | ---: |
| initialJsGzipKb (entry plus static imports) | 120.6 | 121.71 | 146 | 146 (unchanged) |
| totalJsGzipKb | 217.58 | 463.63 | 448.7 | 480 |
| largestJsGzipKb | 65.94 | 141.17 | 125 | 150 |
| totalCssGzipKb | 34.58 | 34.67 | 31.9 | 36 |

Initial JS grew by 1.1 KiB against the 20 KiB allowance: the designer, the preview, the vendored editor, the catalog, zod and every editor library are in lazy chunks.

### Rationale for the limits that were raised

- **totalJsGzipKb 448.7 to 480, largestJsGzipKb 125 to 150.** These are the lazy chunks of the two Studio routes: `Designer` (101.54) and one common chunk of the editor libraries that `/designer` and `/preview` both import (141.17, built as `spikeLayoutService-*.js` after the first module in it: zustand, radix, dnd-kit, zod, the vendored `LayerRenderer` and the catalog). The preview needs that chunk because upstream's `LayerRenderer` imports editor internals (selection overlay, drag and drop). The limits leave about 16 KiB of headroom over the measured total and 9 KiB over the largest chunk. A runtime build has neither chunk (below).
- **totalCssGzipKb 31.9 to 36.** The 31.9 limit predates the vendored editor: Tailwind scans `src/vendor/**` (`@source` in `src/index.css`), which adds about 7.45 KiB. Measured CSS is 34.58 before phase 1's code and 34.67 after, so phase 1 added 0.09 KiB. The scan is not mode dependent, so a runtime build carries the same CSS (below). A phase 2 follow-up could drop the editor-only classes from runtime builds.
- **initialJsGzipKb stays at 146**, the invariant that matters: the editor must never reach first paint.

## Phase 2: Runtime

Phase 2 numbers (branch `feat/runtime-core`, 2026-11-02). Runtime UI: `config/app-spec.json` set temporarily to `packages/runtime/src/spec/fixtures/crew-roster.json`, then `npx vite build --outDir <temp>`; the file is never committed. Runtime sidecar: `APP_MODE=runtime node scripts/desktop/buildSidecar.js --minify --bundle-only`. Studio: `npm run build` and the plain sidecar build on the same tree (phase 2 code only, without phase 3).

| Metric | Runtime (phase 1) | Runtime (phase 2) | Studio (phase 2 tree) | Limit (unchanged) |
| --- | ---: | ---: | ---: | ---: |
| initialJsGzipKb | 121.00 | 128.98 | 122.24 | 146 |
| totalJsGzipKb | 218.01 | 242.56 | 474.61 | 480 |
| largestJsGzipKb | 65.94 | 65.94 (react) | 152.35 | 150 |
| totalCssGzipKb | 34.67 | 34.88 | 34.88 | 36 |
| Sidecar bundleKb (minified) | 3339.48 | 3390.84 | 3516.35 | 3497 |
| Sidecar bundleGzipKb | 1005.02 | 1020.99 | 1058.68 | 1053 |

- Runtime pages never load the editor: `packages/runtime/src/runtime/SpecRenderer.jsx` maps a layer to its catalog component through `src/catalog/components.ts` (no zod, no `@/vendor`). The largest runtime chunks are `RuntimeApp` 6.91, `context` 4.77 and `DataTablePage` 4.46; no runtime chunk contains zod. `packages/runtime/src/runtime/__tests__/noEditor.test.js` and `modeBuild.test.js` guard it.
- Runtime initial JS grew 7.98 KiB: kit components the data browser shares with Settings and the shell (Modal, ConfirmDialog, export and import controls) move into the `shared` group, plus the runtime module's nav icons.
- Studio builds emit no runtime chunk: `src/modules/runtime.jsx` is dropped when Vite bakes `__APP_MODE__` as `studio`.
- Over the limits, for the parent to decide at merge (budgets not edited here): (1) Studio `largestJsGzipKb` 152.35: the 19 catalog parts now sit in the shared editor chunk of `/designer` and `/preview` (141.95 before). A rolldown group for `src/catalog/` in `vite.config.js` would split them out (about 10 KiB). (2) Studio sidecar 3516.35 KiB and 1058.68 gzip: the Studio sidecar must carry the runtime server (the compiler, the data API, the generic Assistant tools), because the Preview child runs the same exe in runtime mode, plus the 19 pure part definitions. The runtime sidecar stays under the kit limit with 106 KiB (32 gzip) headroom.
- Stats (`GET /api/data/:table/stats`) load the numeric columns of every matching row into memory, because `server/db/query.js` has no aggregates. That is fine for local tables up to the import cap of 200000 rows.

## Studio (phases 1 to 3)

- **Web UI**: the table above. Lazy chunks: `Designer` 101.54 and the common editor chunk 141.17 (loaded only on `/designer` and `/preview`), `PreviewSpike` about 1.7.
- **Sidecar**: bundleKb 3451.77 and bundleGzipKb 1039.36, under the unchanged kit limits 3497 and 1053 (BRIEF 4.7). The SEA executable (`win32-arm64`) measured 82542.5 KiB against the unchanged 83712 limit before the zod fix below, so it is now smaller. zod 4 plus the schema and the pure catalog files cost about 112 KiB minified. A first measurement was 463 KiB: `import { z } from 'zod'` keeps the whole `z` namespace object, including `z.locales` (264 KiB of translations), out of tree shaking. Every zod import now uses `import * as z from 'zod'` (the form zod documents), and an ESLint `no-restricted-imports` rule rejects the named `z` import outside type-only imports.
- The sidecar bundle in studio mode reads `packages/runtime/src/spec/schema.ts` and the catalog's `.ts` files through esbuild with no extra step (the bundle test above builds it), and plain Node 24.15 loads the same files by type stripping with no warning (`server/__tests__/modules/specImport.test.js`).

### Phase 3 (the Studio pages, branch `feat/studio`)

Measured on `feat/studio` in studio mode, with the phase 1 limits unchanged (the parent sets limits at merge). Two checks fail by design and need the parent's decision:

| Metric | Phase 1 | Phase 3 | Limit | Status |
| --- | ---: | ---: | ---: | --- |
| initialJsGzipKb | 121.93 | 123.50 | 146 | ok (grew 1.6 of the 20 KiB allowance) |
| totalJsGzipKb | 464.16 | 493.53 | 500 | ok (limit raised by the parent after phase 3, see below) |
| largestJsGzipKb | 142.07 | 112.65 | 150 | ok |
| totalCssGzipKb | 34.69 | 34.82 | 36 | ok |
| Sidecar bundleKb | 3452.93 | 3501.08 | 3530 | ok (limit raised by the parent after phase 3, see below) |
| Sidecar bundleGzipKb | 1039.77 | 1056.07 | 1065 | ok (limit raised by the parent after phase 3, see below) |

- **Web.** All Studio pages are lazy routes. Largest lazy chunks (gzip): the catalog and editor registry chunk 112.3, `DesignTab` 107.0 (the vendored editor), `studioApi` 33.3 (zod and the AppSpec schema, so the Data designer and the import check validate in the browser before saving), `AppWorkspace` 11.4, `AppsPage` 3.6. Nothing from `src/studio`, the editor or zod is in the initial chunk (`chunking.test.js`).
- **Sidecar.** Studio server code adds about 49 KiB minified: `server/studio/**` about 33 KiB (apps service, Describe route and pipeline, preview child manager and proxy) and zod's JSON Schema converter (`z.toJSONSchema`, about 20 KiB), which the Describe pipeline needs at run time because the page-step schema is built per page from the spec's tables and sources (CATALOG.md, "Compact JSON Schema for the model"; phase 2's `modelSchema.ts` uses the same converter). Only the studio build carries it: the runtime seam swaps all of it out. Suggested Studio-only limit, per ADR-006: bundleKb 3530 and bundleGzipKb 1065, which leaves about 29 KiB minified for phase 4 (the build service); the runtime build stays under the kit limits.
- **Parent decision (2026-11-02, after phase 3).** totalJsGzipKb 480 to 500: the growth is lazy Studio chunks only, the initial chunk stays within 2 KiB of phase 1. Sidecar bundleKb 3497 to 3530 and bundleGzipKb 1053 to 1065, the Studio-only figures suggested above. Both files hold one limit for the larger (studio) build; the runtime build is still expected under the kit values 3497 and 1053. The per-mode sidecar limits were set from the merged numbers (next section).
- **Re-measure**: as above, `npm run build; npm run check:bundle` and `node scripts/desktop/buildSidecar.js --minify --bundle-only; npm run check:sidecar`.

## Merged (phase 2 + 3)

Measured on `main` after the merge of `feat/runtime-core` and `feat/studio` plus the integration changes (2026-11-02). Web: `npm run build; npm run check:bundle` for studio, and for runtime `config/app-spec.json` set temporarily to `packages/runtime/src/spec/fixtures/crew-roster.json` with `npx vite build --outDir <temp>` (the file is deleted afterwards, never committed). Sidecar: `node scripts/desktop/buildSidecar.js --minify --bundle-only` then `npm run check:sidecar`, and the same with `APP_MODE=runtime`.

| Metric | Studio | Runtime | Limit studio | Limit runtime | Previous limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| initialJsGzipKb | 123.74 | 129.25 | 146 | 146 | 146 |
| totalJsGzipKb | 498.47 | 242.84 | 520 | 520 | 500 |
| largestJsGzipKb | 111.62 | 65.94 | 150 | 150 | 150 |
| totalCssGzipKb | 35.00 | 35.00 | 36 | 36 | 36 |
| Sidecar bundleKb (minified) | 3566.16 | 3392.51 | 3627 | 3497 | 3530 |
| Sidecar bundleGzipKb | 1075.88 | 1021.49 | 1096 | 1053 | 1065 |

- **Web limits are shared by both modes** (`bundle-budget.json` has one set); a runtime build is far under all of them.
- **totalJsGzipKb 500 to 520.** The merged studio tree measured 502.77 before the review fixes and 498.47 after (date-fns left the Apps chunk): phase 3's lazy Studio chunks (493.53) plus the 19 catalog parts that phase 2 added to the lazy chunks. It is all lazy code behind the Studio routes; the initial chunk is 123.74 (limit 146, unchanged). The new limit leaves about 17 KiB of headroom, the same margin as the earlier raises. `server/__tests__/ciPipeline.test.js` pins the file at 520 so a further raise is a deliberate, documented edit.
- **largestJsGzipKb stays 150, measured 111.62.** With the preview on the catalog renderer (phase 2) the vendored editor and its libraries have one user, the designer, so they all landed in the Designer chunk (219.8 KiB gzip, over the limit; phase 2 alone measured 152.35 for the shared editor chunk). `vite.config.js` has a rolldown group `editor-libs` for the libraries only the editor needs (react-day-picker, date-fns, floating-ui, react-zoom-pan-pinch, react-hook-form, dnd-kit, react-resizable-panels, use-gesture, he-tree-react, helper-js, object-hash): the Designer chunk is 111.62 and `editor-libs` 104.2. A group for `src/catalog/` was tried first and rejected: it gained nothing (the catalog was not in the editor chunk) and pulled zod and the kit's shared event helper into a chunk the entry then imported (initial 169.88). `chunking.test.js` guards both facts.
- **Sidecar limits are per mode now.** `sidecar-budget.json` holds `studio` and `runtime` limits (the exe limit stays shared). `npm run check:sidecar` takes `--mode studio|runtime`, else `APP_MODE`, else studio. `buildSidecar.js` writes `.sidecar-build/bundle-meta.json` with the mode it baked in, and the check fails when that differs from the requested mode (without the file it prints a note and checks anyway).
- **Studio sidecar 3530 to 3627 and 1065 to 1096.** The merged studio sidecar is 3566.16 (1075.88 gzip): the Studio server code (about 49 KiB, phase 3) plus the runtime server that Preview runs as a child (compiler, generic data API, Assistant tools) and the 19 pure part definitions. The new limits are the measured size plus about 60 KiB (20 KiB gzip) of headroom for the phase 4 build service.
- **Runtime sidecar stays at the kit limits 3497 and 1053**, with 104.5 KiB (31.5 gzip) of headroom.

## Phase 5 (guided flow, branch `feat/guided-flow`)

Measured 2026-11-02 in studio mode on the phase 5 tree, against the phase 4 merge (4dd342e) built on the same machine. No limit changed.

| Metric | Phase 4 | Phase 5 guided flow | Phase 5 final (plus cards and Data tab) | Limit |
| --- | ---: | ---: | ---: | ---: |
| initialJsGzipKb | 123.75 | 123.85 | 124.22 | 146 |
| totalJsGzipKb | 504.97 | 509.84 | 511.18 | 520 |
| largestJsGzipKb | 111.62 | 111.62 | 111.62 | 150 |
| totalCssGzipKb | 35.03 | 35.03 | 35.06 | 36 |
| Studio sidecar bundleKb / gzip | 3601.38 / 1088.39 | 3601.38 / 1088.39 | 3601.64 / 1088.47 | 3627 / 1096 |
| Runtime sidecar bundleKb / gzip | 3392.73 / 1021.57 | 3392.73 / 1021.57 | 3392.73 / 1021.57 | 3497 / 1053 |

- The new code (start box, step header, plain review, helper card, inline toolchain and opt-in) sits in the lazy Studio route chunks: +4.87 KiB total, +0.10 KiB initial (shared helpers), no new CSS (existing utility classes only).
- The guided flow changed no server file. The Apps cards add two read-only fields (`description`, `hasInstaller`) to the existing apps list in `server/studio/apps.js`: +0.26 KiB on the Studio sidecar; the runtime sidecar is unchanged.
- The cards and the simpler Data tab add +1.34 KiB total JS and +0.37 KiB initial (the kit `IconButton` the field rows now use is shared with the shell), +0.03 KiB CSS.
- Total JS headroom is now about 9 KiB. A later Studio feature of that size should split a lazy chunk or raise the limit with a rationale here.

## Phase 6 (feature library, branch `feat/features`)

Measured 2026-11-03 in studio mode on the phase 6 tree, against phase 5 final. One limit changed: totalJsGzipKb 520 to 530 (approved by the orchestrator). The sidecars were not re-measured by the last batch; the Items server code that left (routes, summary, markdown export, normalize) and the features server that arrived (`server/studio/features/**`, the pure library) are expected to net out inside the existing sidecar limits.

| Metric | Phase 5 final | Phase 6 | Limit |
| --- | ---: | ---: | ---: |
| initialJsGzipKb | 124.22 | 122.53 | 146 |
| totalJsGzipKb | 511.18 | 525.90 | 530 (was 520) |
| largestJsGzipKb | 111.62 | 112.90 | 150 |
| totalCssGzipKb | 35.06 | 35.05 | 36 |

- **Initial JS fell by 1.69 KiB** (124.22 to 122.53): the command palette no longer imports the Items service and hooks, and the kit Items page left the entry graph.
- **Total JS grew by about 14 KiB, all in lazy chunks** (526.03 measured before the Describe batch). The pieces: the `DesignTab` palette, `featureFromSelection` (6.2 KiB, with the pure feature library in the one chunk that both Design and the Features page import, so nothing is duplicated), `FeaturesPage`, `SaveFeatureDialog` and `FeaturePreview` (a `React.lazy` chunk inside the Features page). Removing the Items UI saved part of it. The old limit left under 9 KiB of headroom, which this feature does not fit in, so the limit moved to 530 with the rationale "phase 6 feature library shared by Design, Describe review and the Features page". `server/__tests__/ciPipeline.test.js` pins the new value.
- **No new CSS**: only classes already used in `src/`.

### Describe model size (feature block)

Helper prompt budgets are kept with the helper (pro, not in the public source).

## Phase 7: themes, Features showcase, Design canvas

Numbers for this phase are measured and filled in by the orchestrator at merge. What changed in the build:

- **The vendored editor is no longer built.** Design is a `@dnd-kit` canvas (`src/studio/design/`) that draws parts with the same catalog components the runtime uses. Nothing imports `src/vendor/ui-builder/`, so its code, its Tailwind scan (`@source not './vendor/'` in `src/index.css`) no longer weigh on the Studio build. The `editor-libs` rolldown group in `vite.config.js` now holds only `@dnd-kit`. The folder stays in the repo, unused, so a later phase can delete it in one commit.
- **Runtime builds are unchanged in what they exclude**: `src/studio/**` (including `design` and `showcase`), `@dnd-kit` and zod stay out (`modeBuild.test.js`, `noEditor.test.js`, `chunking.test.js`). The runtime gains only `packages/runtime/src/theme/` (the theme engine, a lazy chunk applied before React mounts).

Measured 2026-11-03 at 7837cfb (the merge head) in studio mode, gzip KiB, on the same machine as phase 6. No limit changed.

| Metric | Phase 6 | Phase 7 | Limit |
| --- | ---: | ---: | ---: |
| initialJsGzipKb | 122.53 | 127.96 | 146 |
| totalJsGzipKb | 525.90 | 354.03 | 530 |
| largestJsGzipKb | 112.90 | 65.94 | 150 |
| totalCssGzipKb | 35.05 | 29.04 | 36 |
| studio sidecar bundleKb / gzip | 3622 / 1095 | 3624.69 / 1095.36 | 3627 / 1096 |
| runtime sidecar bundleKb / gzip | 3377.46 / 1016.85 | 3377.46 / 1016.85 | 3497 / 1053 |
| runtime web UI total JS / largest / CSS | not measured | 241.59 / 65.94 / 29.04 | no budget |

- **Total JS fell by about 172 KiB and the largest chunk by 47 KiB**: the vendored editor chunk is gone. The largest chunk is now the React group.
- **Initial JS rose by 5.4 KiB**: the theme engine's resolver and the Design entry points moved into the entry graph. Still 18 KiB under the limit.
- **CSS fell by 6 KiB**: the vendored folder left the Tailwind scan.
- **The studio sidecar is 2.3 KiB under its limit.** The next phase that adds server code to Studio must raise the limit with a rationale here, as ADR-006 allows.

## Phase 8: side by side layout, navigation parts, more parts, Features search

Measured 2026-11-03 on `feat/parts-nav-columns` in studio mode, gzip KiB, on the same machine as phase 7. One limit changed: the studio sidecar. The Describe model size table is in the "Describe model size, phase 8" section below.

| Metric | Phase 7 | Phase 8 | Limit |
| --- | ---: | ---: | ---: |
| initialJsGzipKb | 127.96 | 128.33 | 146 |
| totalJsGzipKb | 354.03 | 371.66 | 530 |
| largestJsGzipKb | 65.94 | 65.94 | 150 |
| totalCssGzipKb | 29.04 | 29.56 | 36 |
| studio sidecar bundleKb / gzip | 3624.69 / 1095.36 | 3643.05 / 1100.79 | 3664 / 1106 (was 3627 / 1096) |
| runtime sidecar bundleKb / gzip | 3377.46 / 1016.85 | 3381.31 / 1018.42 | 3497 / 1053 (unchanged) |

- **Web**: 15 part components, the chart model, the menu bar, the Design column slots and choice settings, and the shared search module add 17.6 KiB, all in lazy chunks. Initial JS grew 0.37 KiB. CSS grew 0.52 KiB (the column templates and a few new utilities). No chart library: Chart is plain SVG.
- **Studio sidecar 3627 / 1096 to 3664 / 1106.** The studio sidecar carries every pure part definition (Describe builds the page schema from them), the two-tier Describe outline (`parts`, `menu`, `fitParts`) and, for the Preview child, the runtime server with the new group-by stats. Together that is 18.4 KB minified (5.4 gzip) over the 2.3 KB that phase 7 left. The new limit is the measured size plus 20 KB (5 gzip), rounded up, as ADR-006 allows. `server/__tests__/ciPipeline.test.js` pins both sidecar modes.
- **Runtime sidecar unchanged at 3497 / 1053**: the group-by query, its parameters and the grouping add 3.85 KB (1.57 gzip); 115.7 KB (34.6 gzip) of headroom remain.

### Describe model size, phase 8

Two tiers (ADR-008): the page step offers the core parts plus up to 6 optional parts the outline named. Helper prompt budgets are kept with the helper (pro, not in the public source).

## Phase 9: parts side by side, sized with flex

Measured 2026-11-03 on `feat/flex-layout` in studio mode, gzip KiB, on the same machine as phase 8. No limit changed. Layer sizing adds 5.6 KiB of lazy JS, 0.02 KiB initial, 0.18 KiB CSS, and 1.7 KB (0.7 gzip) to the studio sidecar (the studio sidecar keeps 19.3 KB, 4.5 gzip of headroom). The Describe model size table is in the "Describe model size, phase 9" section below.

| Metric | Phase 8 | Phase 9 | Limit |
| --- | ---: | ---: | ---: |
| initialJsGzipKb | 128.33 | 128.35 | 146 |
| totalJsGzipKb | 371.66 | 377.26 | 530 |
| largestJsGzipKb | 65.94 | 65.94 | 150 |
| totalCssGzipKb | 29.56 | 29.74 | 36 |
| studio sidecar bundleKb / gzip | 3643.05 / 1100.79 | 3644.74 / 1101.48 | 3664 / 1106 |
| runtime sidecar bundleKb / gzip | 3381.31 / 1018.42 | 3381.96 / 1018.69 | 3497 / 1053 |

### Describe model size, phase 9

The page step may set an optional layer width (ADR-009). Caps unchanged. Helper prompt budgets are kept with the helper (pro, not in the public source).

## Phase 10: features inside navigation, data that connects to tables

Measured 2026-11-03 on `feat/nav-slots-data-binding` in studio mode, gzip KiB, on the same machine as phase 9. No limit changed. Part A (menu slots: spec, runtime, the Design menu bar) and Part B (bind on drop, connection badges, the catalog load key, Preview data kept through table changes and its reset route) add 12.35 KiB of lazy JS, 0.02 KiB initial, 0.03 KiB CSS, and 7.97 KB (2.68 gzip) to the studio sidecar and 0.52 KB (0.22 gzip) to the runtime sidecar. The Describe model size table is in the "Describe model size, phase 10 (Part A)" section below.

| Metric | Phase 9 | Phase 10 | Limit |
| --- | ---: | ---: | ---: |
| initialJsGzipKb | 128.34 | 128.36 | 146 |
| totalJsGzipKb | 377.63 | 389.98 | 530 |
| largestJsGzipKb | 65.94 | 65.94 | 150 |
| totalCssGzipKb | 29.74 | 29.77 | 36 |
| studio sidecar bundleKb / gzip | 3644.74 / 1101.48 | 3652.94 / 1104.24 | 3664 / 1106 |
| runtime sidecar bundleKb / gzip | 3381.96 / 1018.69 | 3382.48 / 1018.91 | 3497 / 1053 |

- **Studio sidecar gzip headroom is now 1.76 KB** (1106 - 1104.24; minified headroom 11.06 KB; measured at f81ed36). Watch this: the next phase that adds server code to Studio will likely need a raise with a rationale here, as ADR-006 allows, and it must change **both** pins, `server/__tests__/ciPipeline.test.js` and `server/__tests__/sidecarBudget.test.js` (phase 8 missed the second).
- **Runtime sidecar** keeps 114.5 KB (34.1 gzip) of headroom under the kit limits.
- **Web**: the headroom under the total JS limit is 140 KiB; the new code (menu slots on the canvas, `ActionSettings`, the bind helpers, the connection components, the Preview banner) is all in lazy Studio chunks.

### Describe model size, phase 10 (Part A)

PageHeader now allows more child parts (menu slots work, ADR-010), which moves one prompt phrase. Caps unchanged, nothing dropped. Helper prompt budgets are kept with the helper (pro, not in the public source).

## Phase 11: troubleshooting, break testing, CI/CD

Measured 2026-11-03 on `fix/harden-ci`, base `main` at fac769b. One limit changed: the studio sidecar gzip, 1106 to 1107.

| Metric | Phase 10 | Phase 11 | Limit |
| --- | ---: | ---: | ---: |
| studio sidecar bundleKb / gzip | 3652.94 / 1104.24 | 3656.62 / 1105.35 | 3664 / 1107 (was 3664 / 1106) |
| runtime sidecar bundleKb / gzip | 3382.48 / 1018.91 | 3383.61 / 1019.23 | 3497 / 1053 (unchanged) |

The web UI limits did not change; this table has only the two sidecars.

- **Studio sidecar gzip 1106 to 1107 (raw 3664 unchanged).** The studio sidecar was near its gzip limit after phase 8 and phase 10 left 1.76 KB. The phase 11 fixes each added a little server code or message text: the build crash finalize, the pending-spec envelope, the preview busy message, the body-size messages, the control-character and device-name rules, and the limit messages. Together they used up the gzip headroom. Raw has spare room, so only gzip was raised, by 1 KB. The new headroom is about 1.65 KB gzip. Both pins changed in the same commit as `scripts/checks/sidecar-budget.json`: `server/__tests__/ciPipeline.test.js` and `server/__tests__/sidecarBudget.test.js` (ADR-006: a raise needs a rationale here and both pins).
- **Runtime sidecar** keeps 113.4 KB (33.8 gzip) of headroom under the kit limits.
- **CI now checks both modes.** The `sidecar budget` step of `ci.yml` checks the studio bundle and then a runtime bundle built with `APP_MODE=runtime`; before, only the mode the build resolved to (studio) was checked.

### Test suite times

Machine: 10 cores, 15 GB, Windows 11, Node 24, with another orchestrator using the machine at the same time, so the times are upper bounds. Peak is the working set of the whole process tree.

| Suite | Before (fac769b) | After | Notes |
| --- | --- | --- | --- |
| Unit, `--maxWorkers=4` | 317.8 s, 344.2 s (peak 2305 MB), 319.8 s (peak 2456 MB); 491 files, 8981 tests | 221.6 s (peak 2300 MB); 511 files, 9525 tests | three projects instead of two (frontend jsdom 145 files, pure node 91, backend node 273) |
| jsdom environments created | 233 times, 251.6 s | 145 times, 185.7 s | DOM-free `src` tests moved to the `pure` node project |
| Playwright, default workers | 177.1 s (peak 7149 MB, 2 failures), 81.5 s (68 passed, peak 8712 MB) | no later run recorded | the two failures (backups restore under load, side-by-side drag) were fixed at their root cause |

Where the "before" unit time went (Vitest's own split): tests 55 to 68 percent, environment setup 22 to 29, imports 8 to 13. The pool comparison is in [PIPELINE.md](../PIPELINE.md), "Vitest projects and pool". The under 100 s goal was missed: the suite is about 880 worker-seconds of work, and what remains is real jsdom render work.

Slow unit files fixed (seconds, before to after; the `backupRestore` figure in brackets is the loaded baseline):

| File | Before | After |
| --- | ---: | ---: |
| backupRestore | 26.3 (110.7) | 5.5 |
| backupRoutes | 10.7 | 5.8 |
| backupCreate | 7.6 | 2.0 |
| backupHardening | 17.2 | 2.3 |
| backupWorkerClient | 22.4 | 4.8 |
| packageKit | 22.3 | 10.8 |
| specRendererParity | 24.4 | 2.6 |
| stableCopy | 3.3 | 1.0 |

The causes were setup cost, not product behavior, and no assertion was removed: a worker thread per backup step (tests now use the main-thread path through the existing seam; the real worker is still covered by `backupWorkerClient`, `backupEventLoop`, `backupWorkerBundle` and two new real-worker tests), a real 10 s drain wait replaced by the injected clock, a fake worker that never emitted exit, `setTimeout(0)` settles that cost 15 ms ticks replaced by `setImmediate`, and a git fixture repo built per test replaced by one copied template.

The ten slowest Playwright tests of the first run (seconds): dataProof two tables 29.6, dataProof Preview banner 28.1, guidedFlow 24.8, appMenu Page links 18.4, dataProof Stop and Start 18.3, chart 17.9, columns one drag 17.7, features custom feature 17.5, appMenu No menu bar 17.5, columns Add here 17.0.

## Phase 15: self-governing gate, one error model, debug tooling

Measured 2026-11-04 on `feat/self-governing` (base `main` 8c71642, with `main` a24754b merged). One limit changed: the studio sidecar, 3664 / 1107 to 3807 / 1153.

| Metric | Phase 13 | Phase 15 | Limit |
| --- | ---: | ---: | ---: |
| web total JS gzip | 417.99 | 432.98 | 530 (unchanged) |
| web initial JS gzip | 128.58 | 128.89 | 146 (unchanged) |
| web CSS gzip | 30.19 | 30.27 | 36 (unchanged) |
| studio sidecar bundleKb / gzip | 3657.07 / 1105.44 | 3714.02 / 1124.57 | 3807 / 1153 (was 3664 / 1107) |
| runtime sidecar bundleKb / gzip | 3383.72 / 1019.22 | 3416.73 / 1030.01 | 3497 / 1053 (unchanged) |

- **Studio sidecar 3664 / 1107 to 3807 / 1153.** Phase 13 left 6.9 KB raw and 1.56 KB gzip. Phase 15 adds server code that every Studio request runs through: the error envelope module and the 169-row copy table (`server/errors.js`, `src/errors/copy.core.js`, `copy.studio.js`), structured logs with the request id, ring and rolling file (`server/log.js`), the process guards (`server/processGuards.js`), stage timings, the redaction additions and the Diagnostics routes, doctor and report (`server/diagnostics/`). Together that is 56.95 KB raw and 19.13 KB gzip. The new limit is the measured size times 1.025, rounded up, which is under the 3 percent cap the brief set. Headroom is 92.98 KB raw (2.4 percent) and 28.43 KB gzip (2.5 percent), above the gate's 2 percent "Needs a decision" line. Both pins changed in the same commit as `scripts/checks/sidecar-budget.json`: `server/__tests__/ciPipeline.test.js` and `server/__tests__/sidecarBudget.test.js` (ADR-006).
- **Runtime sidecar** grew by 33.01 KB raw (10.79 gzip) for the envelope, logs and guards (built apps carry only `copy.core.js`, never the Studio rows). Headroom is 80.27 KB raw (2.3 percent) and 22.99 KB gzip (2.2 percent), so no raise. The next runtime growth of about 2 KB gzip will cross the 2 percent line and the gate will print "Needs a decision".
- **Web UI**: the Diagnostics section, the boundaries and the translator are lazy chunks; the initial chunk grew 0.31 KB gzip.
- **Dev sidecar source maps**: `node scripts/desktop/buildSidecar.js --minify --sourcemap --bundle-only` (what `desktop:build:dev` passes) gives 16877.93 KB raw / 4455.47 KB gzip with inline maps, about 4.5 times the shipped bundle. The shipped installer is built without `--sourcemap`; maps do not fit any budget and are dev only.

## Phase 20: example apps

The eight examples in `src/studio/examples/` are lazy JSON chunks (a spec and its sample records each), loaded only when Use this example is pressed; the Apps page chunk carries only their metadata. Measured as the gzip of each spec plus its records, the sum is 11913 bytes (crew-board 1247, appointments 1400, reading-list 1441, expense-log 1494, job-tracker 1520, invoices-and-clients 1550, inventory 1626, membership-attendance 1635). `src/studio/examples/__tests__/examples.test.tsx` fails above 14336 bytes. No limit is raised.

## Phase 22: Describe model size

### Describe model size, phase 22

The helper may place parts on a free grid. No cap moved. Helper prompt budgets are kept with the helper (pro, not in the public source).

## Phase 23: measured at the gate

Measured 2026-11-06 at 1c071fc (the final gate) on `feat/phase23-produced-fidelity` (gzip KiB unless noted). No limit changed. Details per gate in `docs/phase23/STATUS-phase23.md`.

| Metric | Pro build | Public build (`APP_PRO_DIR=none`) | Limit |
| --- | ---: | ---: | ---: |
| web total JS gzip | 523.45 | 520.63 | 530 |
| web initial JS gzip | 130.29 | 130.24 | 146 |
| web CSS gzip | 31.74 | 31.74 | 36 |
| runtime web total / initial JS gzip | 257.88 / 129.01 | 255.01 / 129.01 | no budget / 146 |
| studio sidecar bundleKb / gzip | 3757.13 / 1140.33 | 3633.66 / 1096.41 | 3807 / 1153 |
| runtime sidecar bundleKb / gzip | 3419.18 / 1031.01 | 3375.25 / 1016.54 | 3497 / 1053 |

- Headroom on the pro build: web total 6.55 KiB, studio sidecar 49.87 KB raw and 12.67 KB gzip (1.1 percent, under the gate's 2 percent "Needs a decision" line), runtime sidecar 77.82 KB raw and 21.99 KB gzip (2.1 percent).

After the final review fixes (40185f1, web only): pro studio web total 523.90 KiB, public 521.07 KiB (limit 530). Sidecars unchanged from 1c071fc. Headroom is thin: the pro studio sidecar gzip has about 1.1 percent left (1140.33 of 1153), under the 2 percent line, so the next phase that adds Studio server code needs a limit decision with a rationale or a size cut first (candidate: the unused kit shell in the runtime initial chunk).
