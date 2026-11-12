# Architecture decisions

Decisions for Local App Studio on top of the Tauri Local-AI Starter Kit (scaffold ancestor `6017cc9`). Each ADR states the decision, why, and what it obliges. Related contracts: [APP_SPEC.md](APP_SPEC.md), [CATALOG.md](CATALOG.md), [OWNERSHIP.md](OWNERSHIP.md). Kit rules in [CLAUDE.md](../CLAUDE.md) and [PRODUCT.md](PRODUCT.md) still apply everywhere.

Status values: Accepted, Pending.

## ADR-001: One codebase, two modes

**Status:** Accepted (2026-11-02).

**Decision.** Studio (the product) and every built app (the runtime) are one source tree. The mode is `studio` or `runtime`.

- **Resolution.** `resolveAppMode(env, { root })` in `server/appMode.js` (pure, used by the server, `vite.config.js` and the sidecar bundler): `APP_MODE` if set (`studio` or `runtime`, anything else throws), else `runtime` when `config/app-spec.json` exists, else `studio`. `APP_MODE` is the dev override; `npm test` runs as `studio` unless a test sets it.
- **Where the spec is baked: `config/app-spec.json`.** Not `src-tauri/resources/`: that folder is build output (the sidecar build copies `dist/` and migrations there, `init-app` skips it), while `config/` already holds the owner config files and is read at build time by both Vite and esbuild. The Studio repo never contains `config/app-spec.json`; the build pipeline writes it into the extracted runtime template (ADR-005).
- **How the spec reaches code.** Frontend: a Vite virtual module `virtual:app-spec` (default export: the parsed JSON, or `null` in studio). Server and backup worker: an esbuild define `__APP_SPEC_JSON__` (added to `bundleDefine()` in `scripts/desktop/workerBundle.js`, so both bundles get it), read by `server/spec/source.js` (created by phase 2). Unbundled dev (`node server.js`) reads `config/app-spec.json` from disk. `APP_SPEC_PATH` (a file path) is honored only when the bundle's baked mode is `studio`: it is how Studio starts a preview child (below). A runtime bundle ignores it.
- **Baked mode.** Vite defines `__APP_MODE__`; `bundleDefine()` adds `__APP_MODE__` for the sidecar. `src/appMode.js` and `server/appMode.js` export `APP_MODE`/`getAppMode()`. A bundle baked as `studio` may be switched to `runtime` by `APP_MODE=runtime` (the preview child); a `runtime` bundle refuses `APP_MODE=studio` at startup (exit 1), because the Studio code is not in it.
- **Compiling Studio out.** Same seam pattern as the kit's cloud-off build (`scripts/desktop/cloudBuild.js`): `scripts/desktop/modeBuild.js` exports `studioUiPlugin(mode)` (Vite, `enforce: 'pre'`) and `studioServerPlugin(mode)` (esbuild; used by the sidecar and the backup worker builds). In `runtime` mode they swap each Studio seam file for its `.disabled` stub and fail the build if anything under `src/studio/` or `server/studio/` (or the ui-builder editor entry `src/vendor/ui-builder/components/ui/ui-builder/index.tsx`) is still loaded. Seams: `src/modules/studio.jsx`, `src/modules/studio.assistant.js`, `server/modules/studio.js`, `server/modules/studio.data.js` (see OWNERSHIP.md). Studio pages are lazy routes declared only in `src/modules/studio.jsx`, so with the stub no Studio chunk is emitted. In unbundled dev the server checks `getAppMode()` and skips the Studio module's `register`.
- **Preview runs the real runtime.** Studio's Preview spawns a child server in runtime mode (dev: `node server.js`; packaged: the same sidecar exe with `--role preview`) with `APP_MODE=runtime`, `APP_SPEC_PATH`, a scratch `APP_DATA_DIR` under `%LOCALAPPDATA%\Local App Studio\preview\<slug>\`, `APP_DESKTOP=1` and a parent-generated secret on stdin (the same handshake the Tauri shell uses). Studio proxies `/api/preview/*` to the child's `/api/*` with the child's cookie; the browser only talks to its own origin (`connect-src 'self'`). The preview UI is the runtime renderer (`SpecApp` from `packages/runtime/src/runtime/`) mounted inside Studio with `apiBase = '/api/preview'`. Why a child and not in-process: `TABLES`, `IMPORT_ORDER`, `FOREIGN_KEYS` and `DATA_TABLES` are frozen at import and read by query, codec, export, import, backup snapshot and restore; a child gets them from the spec at startup with zero kit changes and the exact code path of a built app. Cost: one extra Node process (about 60 MB) while Preview is open. A spec change restarts the child; an incompatible change also wipes the scratch data folder.

**Consequences.** One renderer and one catalog for designer, preview and built app. Studio adds no per-mode branches in kit files beyond the seams created in phase 1. `config/app-spec.json` is the only difference between a Studio checkout and a runtime template.

## ADR-002: Vendored ui-builder

**Status:** Accepted (maintainer decision, 2026-11-02).

**Decision.** The ui-builder core (olliethedev/ui-builder, MIT) is copied into `src/vendor/ui-builder/`, mirroring upstream `components/`, `lib/` and `hooks/` paths, not installed from its shadcn registry. TypeScript is allowed there and in `packages/runtime/src/spec/` and `src/catalog/`; kit code stays JavaScript.

- **What is vendored.** `components/ui/ui-builder/` (editor, `layer-renderer.tsx`, `types.ts`), `lib/ui-builder/` (zustand stores, registry definitions, schema utilities), `components/ui/auto-form/`, the shadcn primitives the editor imports from `components/ui/`, and the hooks they need. Not vendored: tiptap (rich text), charts, carousel, the Next.js docs and demo app, the registry build scripts.
- **Alias.** `tsconfig.json` `paths` and the Vite alias map `@/` to `src/`. Every vendored `@/components/...`, `@/lib/...` and `@/hooks/...` import was rewritten once to `@/vendor/ui-builder/components/...` (and `lib`, `hooks`), so the vendored tree never collides with kit folders.
- **next-themes** (the only Next import, in `index.tsx` and `internal/components/nav.tsx`) is replaced by the kit's `ThemeContext` (`src/contexts/ThemeContext.jsx`).
- **Lint.** ESLint covers the vendored tree with its own override block (TypeScript parser, vendored code exempt from the no-`any` rule, must lint clean). New code the team writes outside `src/vendor/` has no `any`.
- **Attribution.** The MIT license text and copyright line are in `THIRD_PARTY_NOTICES.md`.
- **Re-sync procedure.** (1) Record the upstream commit in `src/vendor/ui-builder/README.md` (commit, date, file list, every local patch with a one-line reason). (2) Copy the same file list from the new upstream commit into a temp folder. (3) Apply the import rewrite (`@/components|lib|hooks/` to `@/vendor/ui-builder/components|lib|hooks/`) and the next-themes swap by hand or with a throwaway script (no sync script is kept in the repo; the rewrite is three prefix replacements). (4) Diff against the tree, re-apply the listed local patches, run the gates. Never hand-edit vendored files without adding the patch to that README.

**Gotchas carried over from upstream.** zod 4 internals (`._zod.def.type`, no `instanceof`); clear the zundo history after programmatic loads (`useLayerStore.temporal.getState().clear()`).

## ADR-003: Styling (Tailwind 4 or Tailwind 3)

**Status:** Accepted (2026-11-02, phase 1 spike, commit `065d411`).

Options considered (BRIEF 4.5): (a) move the whole app to Tailwind 4, loading the kit's `tailwind.config.cjs` through `@config` and adding shadcn's CSS variables; (b) back-port the vendored components to Tailwind 3.

**Decision: (a).** The whole app runs on Tailwind 4 (`tailwindcss` and `@tailwindcss/postcss` 4.3, `autoprefixer` removed). Details:

- `src/index.css` starts with `@import 'tailwindcss' source(none)`, `@config '../tailwind.config.cjs'`, `@source '../index.html'` and `@source './'` (covers `src/vendor`). `tailwind.config.cjs` lost only `content` and `darkMode` (a config `content` is re-honored by `@config` and re-scans everything); every kit token and the `slate-slateNNN` alpha colors are unchanged.
- The shadcn variables (`--background`, `--foreground`, `--primary`, `--muted`, `--popover`, `--border`, `--input`, `--ring`, `--destructive` and the rest) are defined on `:root` (dark) and `:root.light`, mapped onto the kit palette, and registered with `@theme inline`. `--radius` is 0.375rem, the kit's `rounded-md`.
- `dark:` is `@custom-variant dark (&:where(:root:not(.light), :root:not(.light) *))`, because the kit's dark theme is the default root and light is the `.light` class.
- Animations come from `tw-animate-css` plus `accordion-down` and `accordion-up`.
- Base-layer compatibility rules restore Tailwind 3 defaults the kit relied on: border color gray-200, placeholder gray-400, pointer cursor on buttons, `option` padding, `::file-selector-button` letter spacing. `*:focus-visible` sits in `@layer base` so `focus-visible:outline-hidden` still wins as it did in Tailwind 3. `red-600` and `red-700` are pinned to their Tailwind 3 values (the oklch reds shift visibly).
- `src/vendor/ui-builder/components/ui/ui-builder/internal/utils/tailwind-classes.ts` (every Tailwind class as a string, used by the designer's class picker) is excluded with `@source not`. It alone added about 110 KiB of CSS.

**Class-level fixes in kit files (all the kit needed):** `outline-none` to `outline-hidden` in 11 components and `formStyles.js`; `CommandPalette.jsx` input drops a plain `outline-none` (in Tailwind 3 it lost to `*:focus-visible`, so the ring showed; behavior kept); `BurgerMenu.jsx` `bg-gradient-to-br` to `bg-linear-to-br/srgb` (Tailwind 4 interpolates in oklab); `ItemForm.jsx` drops a `mt-4` that Tailwind 3's `space-y` rule overrode; `AssistantPanel.jsx` `py-4` to `pb-4 pt-7` (Tailwind 3's sibling rule gave the first visible child 12px after an sr-only paragraph); `PrivacyActivitySection.jsx` uses a `PILL_CENTER` constant (the `self-start`/`self-center` order flipped in Tailwind 4).

**Evidence.**

1. Class diff. 5,464 unique string tokens from 287 kit `js`/`jsx` files (vendor excluded) compiled with Tailwind 3 before and Tailwind 4 after, declarations normalized (oklch and color-mix, calc and var forms, media syntax, logical properties). 444 tokens produce rules: 354 identical, 51 differ only in selector form (`sm:`/`md:` query syntax, `group-`, `peer-`, `divide-`), 39 differ in declarations. Of the 39, the red shades, gradient interpolation and `outline-none` renames were fixed; the rest are equivalent representations (outline split into style and width, filter and `font-variant-numeric` var chains, transitions gaining `outline-color`, sr-only `clip` to `clip-path`, `w-2/3` rounding, `container`, `space-y`/`divide-y` selector rewrite).
2. Static scan. An esbuild plus acorn scan of all kit JSX for `space-y` containers whose children carry their own margin or start with an sr-only child found two sites (`ItemForm`, `AssistantPanel`), both fixed. A `@utility` override of `space-y-*` does not work (both rules are emitted), so the sites were fixed by hand.
3. Computed styles. Every property of 4,258 elements across 14 theme and scene pairs compared before and after: only representation noise left.
4. Screenshots. Local Playwright against a built `dist`, seeded temp data folder, fake Ollama, fixed clock, dark and light: Home, Items, the Add item dialog, Settings (full page, `#ai`, `#data-storage`, `#license`), the Assistant panel, the command palette, the mobile nav drawer, mobile Home, a keyboard focus ring, onboarding (welcome and Assistant setup). 28 shots differ by 0 pixels (channel delta over 8), except two light Settings sections with one 1-pixel difference each (max delta 12). Not rendered, covered by the class diff only: the cloud consent dialogs, license activation and confirm dialogs, the backup restore confirm. The kit's Docker visual baseline project (`npm run test:visual`) was not run (no Docker on this PC); its baselines must be refreshed on a Docker machine before the next release.
5. Gates on the spike commit: `npm test` 5999 passed, 2 skipped; lint clean; `npm run check` ok; build ok. CSS 34.58 KiB gzip (kit alone 27.13, vendored editor classes 7.45) against the old 31.9 budget, which `docs/BUDGETS.md` raises.

**Consequences.**

- One Tailwind for kit, vendored editor and catalog parts; shadcn classes and kit tokens resolve to the same palette in both themes.
- Deliberate Tailwind 4 differences kept: `hover:` is wrapped in `@media (hover: hover)` (touch devices lose hover styles), `space-y` and `divide-y` use margins and borders on all but the last child (1px row height shifts possible), `transition-colors` also animates `outline-color`.
- The designer's free class picker only has CSS for classes some source already uses. Acceptable in v1: the model never emits classes (BRIEF 4.9) and parts style through `variant`, `size` and `tone` enums. If the advanced className toggle ships, load a lazy designer-only stylesheet that includes `tailwind-classes.ts` rather than adding it to the main CSS.
- Kit merges: Tailwind class changes in future kit versions need the same `outline-none` and `space-y` review; note it in the kit upstream procedure.

## ADR-004: AppSpec compiles to kit migrations

**Status:** Accepted (2026-11-02).

**Decision.** A deterministic compiler (`server/spec/compile.js`, pure JS, no zod, no I/O) turns a validated AppSpec into everything the kit's data layer expects. Same spec in, byte-identical output out (spec order, LF endings, no timestamps); golden-file tests prove it.

**Outputs of `compileSpec(spec)`:**

| Output | Shape |
| --- | --- |
| `tables` | `TABLES` entries: `{ primaryKey: 'id', autoNow: ['created_at', 'updated_at'], columns }`, column types `text` (text, longtext, select), `integer`, `real`, `boolean`, `date`, `timestamptz` (datetime and the two runtime timestamps), `uuid` (id and reference) |
| `importOrder` | spec table ids, parents before children (the schema forbids reference loops) |
| `foreignKeys` | one per reference field; `onDelete` `'set null'` for optional, `'restrict'` for required references |
| `dataTables` | one `DATA_TABLES` def per spec table, `group` = the app name |
| `validators` | per table, the field rules the generic data API checks before any write (type, required, options, max length) |
| `categories` | one cloud category per spec table (id = table id, default not shared) |
| `createSql` | the full schema, used for a first build and for preview scratch databases |

**SQL rules.** Every table is `STRICT` with `"id" TEXT PRIMARY KEY NOT NULL`, `"created_at" TEXT NOT NULL`, `"updated_at" TEXT NOT NULL`. Identifiers are always double-quoted. Required means `NOT NULL`. Select: `CHECK ("f" IS NULL OR "f" IN ('a', 'b'))` (quotes in options doubled). Boolean: `INTEGER` with `CHECK ("f" IN (0, 1))`. Date: `CHECK ("f" IS NULL OR "f" = date("f"))`. Datetime: `CHECK ("f" IS NULL OR "f" = strftime('%Y-%m-%dT%H:%M:%fZ', "f"))`. Text and longtext: `CHECK (length("f") <= 500)` or `20000`. Reference: `TEXT REFERENCES "t" ("id") ON DELETE SET NULL | RESTRICT` plus an index. Defaults become SQL literals. These CHECKs keep the file safe when the user edits it in an external SQLite tool (the "accessible database").

**Two migration tracks.** The kit's single contiguous track cannot hold both kit migrations (which grow with the template) and per-app spec migrations (which grow with each app): the numbers would collide on the first rebuild from a newer template. So:

- **Core track** (unchanged): `server/db/migrations/NNN_name.sql`, `schema_version`, `migrations.lock.json`. Same files in Studio and every built app, including Studio's `003_studio.sql` (its `apps` and `builds` tables exist empty in built apps; they are not in a built app's `TABLES`, so they are never exported or shown).
- **App track** (new, phase 2): `server/db/migrations/app/NNN_app.sql`, contiguous from `001`, version table `app_schema_version (version, name, sha256, applied_at)`, lock `server/db/migrations/app/migrations.lock.json`, pre-migration copy `app.db.pre-app-v<N>.bak`. Runs after the core track in `openDb`. The folder is a subfolder of the existing migrations resource, so the sidecar copy, the Rust shell's `APP_MIGRATIONS_DIR` and `init-app`'s migration exclusion all cover it unchanged. The core loader ignores subfolders. `APP_SPEC_MIGRATIONS_DIR` overrides the folder for the preview child only. The runner refuses to start when an applied migration's recorded sha256 differs from the file.
- The Studio repo has no `server/db/migrations/app/` files. The build pipeline writes them into the template from the app's migration history.

**Evolution of a built app.** Studio keeps, per app, the last built spec and the list of app-track migrations already shipped (Studio's `apps` table, phase 3). `planMigration(builtSpec | null, nextSpec)` returns `{ ok: true, file: { name, sql } | null }` or `{ ok: false, issues: SpecIssue[] }`. `null` builtSpec gives `001_app.sql` = `createSql`.

| Edit | Result |
| --- | --- |
| Labels, pages, layouts, sources, nav, theme, app description, version | No migration |
| New table | `CREATE TABLE` |
| New optional field (any type, including select and reference) | `ALTER TABLE ADD COLUMN` (nullable, CHECK and FK allowed) |
| New required field with a default | `ADD COLUMN ... NOT NULL DEFAULT x` |
| New select option; required to optional; changed default; text to longtext; integer to real | Table rebuild (data kept) |
| Remove a table or a field; rename an id; change any other type; optional to required; remove a select option; change a reference target; new required field without a default | Refused: `destructive_change` issue naming the edit. v1 workaround: keep the field and hide it from pages, or build as a new app (new identifier). Explicit data migrations are v1.x |

**Table rebuilds** follow SQLite's documented procedure: the app-track runner turns `PRAGMA foreign_keys` off outside the transaction for a migration whose first line is `-- app-migration: rebuild`, then `BEGIN IMMEDIATE`, create `"t__new"`, copy, drop, rename, recreate indexes, `PRAGMA foreign_key_check` must return no rows, `COMMIT`, foreign keys on again. The pre-migration `.bak` is taken first, like the kit.

**Generic data API.** Only spec tables (the compiled list), never kit tables: `GET/POST /api/data/:table`, `GET/PATCH/DELETE /api/data/:table/:id`, `GET /api/data/:table/stats` (counts and totals computed in SQL). Writes go through `validators` and `server/db/query.js`; `updated_at` is set by the route on PATCH (the codec's `autoNow` only fills on insert). Success `{ data: T }`; errors `{ error: code, message, field? }` (`invalid_record`, `not_found`, `record_in_use` for a restricted delete).

## ADR-005: Build pipeline and the `build` network feature

**Status:** Accepted (2026-11-02). Implemented in phase 4.

**Network feature.** New `NETWORK_FEATURES` entry `build` (label "App builds", off by default), contributed by the Studio module descriptor (`networkFeatures`, see OWNERSHIP.md) so built apps never list it. Hosts: `registry.npmjs.org`, `crates.io`, `index.crates.io`, `static.crates.io`, `github.com` (cargo git dependencies and the Tauri bundler's one-time NSIS tools download, which redirects to GitHub's release asset host `objects.githubusercontent.com`; list it too). WebView2 is fetched by the installer on the end user's PC, not here. A child process that downloads counts as outbound: the build route uses `requireNetwork('build')` and the service calls `assertNetworkEnabled('build')` before every spawn. Each build writes one network activity entry per host group (npm, crates, GitHub) through `server/networkAudit.js`.

**Pipeline** (`pro/server/studio/build/`, a pro module with a public stub at `server/studio/build/service.js`, SSE log, each step `{ step, status, line }`): toolchain check, extract the runtime template to `%LOCALAPPDATA%\Local App Studio\builds\<slug>\` (cleaned first), write `config/app-spec.json` and the app-track migrations plus lock, `npm run init-app -- --name ... --identifier ... --repo placeholder/<slug> --releases-repo placeholder/<slug>-releases --support <owner value> --yes`, `npm ci`, `npm run desktop:build`, copy the installer to `%USERPROFILE%\Documents\Local App Studio\<slug>\`, record the build (status, duration, installer path, sha256) in `builds`.

**Rules.**

- **One build at a time**: an in-process lock plus a `running` row in `builds`; at startup any `running` row becomes `interrupted`. A second request gets `409 build_busy`.
- **Cancel kills the tree**: `taskkill /PID <pid> /T /F` (the sidecar's Job Object also ends everything when Studio exits). Status `cancelled`; the build folder is left for inspection and cleaned on the next build.
- **Shared `CARGO_TARGET_DIR`** at `%LOCALAPPDATA%\Local App Studio\cargo-target`, so dependencies compile once. The installer is then under `<CARGO_TARGET_DIR>\release\bundle\nsis\`, not `src-tauri\target\`.
- **Toolchain discovery without PATH.** The Tauri shell gives the sidecar a fixed `PATH` of `System32` only (`src-tauri/src/sidecar.rs`), so `node`, `npm` and `cargo` are found by known locations, never by PATH: `%ProgramFiles%\nodejs\node.exe` and nvm or Volta folders under the user profile; `%USERPROFILE%\.cargo\bin\cargo.exe`; MSVC through `vswhere.exe`; WebView2 through its registry key. npm runs as `node <nodeDir>\node_modules\npm\bin\npm-cli.js` with `shell: false`. Node 24 or newer is required on the user's PC (the SEA's embedded Node cannot run npm).
- **Child environment**: built from scratch like the shell does (no `APP_*` from Studio, no tokens): `SystemRoot`, `TEMP`, `TMP`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, a PATH of the discovered tool folders plus `System32`, `CARGO_TARGET_DIR`, `npm_config_registry=https://registry.npmjs.org/`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, `APP_CLOUD_AI=off` unless the owner decides otherwise (open question).
- **Timing copy**: the first build on a PC takes 5 to 15 minutes; the UI says so.

## ADR-006: How the server consumes the AppSpec schema

**Status:** Accepted (2026-11-02).

**Options weighed.** (a) Server imports `packages/runtime/src/spec/schema.ts` directly; (b) a build step emitting JS; (c) a mirrored `server/spec/schema.js` plus a parity test.

**Decision: (a).** `server/spec/index.js` is a one-line re-export: `export * from '@local-app-studio/runtime/spec/schema.ts';`. Node 24 strips types natively (on by default since 23.6), Vitest and esbuild handle `.ts` natively, so there is no build step and no second copy to drift. The same applies to the pure catalog files the Studio server needs (`src/catalog/definitions.ts`, `modelSchema.ts`, `validateLayout.ts`, see CATALOG.md).

**Syntax rules for every `.ts` file the server imports** (stated at the top of `schema.ts`): erasable TypeScript only (no `enum`, `namespace`, parameter properties, `import =`), no JSX, no `@/` alias, bare imports only for packages, relative imports with the `.ts` extension, type-only imports as `import type`. `tsconfig.json` needs `allowImportingTsExtensions: true` (it already has `noEmit`); `erasableSyntaxOnly: true` and the ESLint rule `@typescript-eslint/consistent-type-imports` are recommended for `packages/runtime/src/spec/` and `src/catalog/`.

**Sidecar budget.** zod enters the sidecar only through Studio server code (Describe, Apps, Preview), which the runtime swap seam removes. The runtime server never imports `server/spec/index.js`: the compiler and the generic data API work on an already validated spec with plain JS validators, so built apps carry no zod in their sidecar. `studioServerPlugin('runtime')` also fails the build if `zod` or `packages/runtime/src/spec/schema.ts` is loaded, which makes this enforceable. The Studio sidecar does carry zod (estimate 50 to 70 KiB minified). Sibling products sit at about 97 percent of the kit's `bundleKb` 3497, so phase 1 measures `npm run check:sidecar` before and after the first server import of the schema and records both numbers in `docs/BUDGETS.md`; if Studio exceeds the limit, the budget is raised for Studio only with that rationale, and runtime sizes are recorded separately.

**Risks.** Node may print an experimental warning for type stripping on some 24.x releases (cosmetic; silence nothing, document it). A `.ts` file that breaks the syntax rules fails only at server start in dev: a backend test imports `server/spec/index.js` under plain Node semantics (spawned `node -e "import('./server/spec/index.js')"`) so the rule is checked in `npm test`.

## ADR-007: Features replace the Items example, expanded at write time

**Status:** Accepted (2026-11-02, phase 6). Concept doc: [FEATURES.md](FEATURES.md).

**Context.** The kit's example module, Items, has no meaning in Local App Studio, yet it ships in every built app (`/api/items`, the items export, core migration 002; a LOW finding in the phase 4 notes). Users and the local model also need a way to reuse a group of parts across pages and apps.

**Decision.**

1. **Features are Studio data, specs stay self-contained.** A custom feature (label, model-facing description, parameters, a layout fragment over catalog parts and other features, bindings from parameters to fragment slots) is stored in the Studio table `studio_features`. A page may name one as a layer `{ "type": "Feature", "props": { "featureId", "params" } }`, but every write path (Describe proposal, PUT and import of an app, Design insertion) **expands** it into plain catalog parts first. A stored or built spec never contains a `Feature` layer (`checkLayout` rejects it as `unknown_part`). The expanded subtree root keeps an optional `feature` marker `{ id, version, params }` so Design can show it as one block and offer "Update to latest".
2. **One pure expander.** `src/catalog/features/` (erasable TypeScript, ADR-006 rules, no zod at runtime beyond the spec schema) holds the types, limits, slot discovery, expansion, cycle and depth checks, and the sample spec used to validate and preview a feature. Studio server, Describe and the Design tab call the same functions.
3. **The runtime knows nothing about features.** `SpecRenderer` renders `type`, `props` and `children` only; the marker is inert data. `scripts/desktop/modeBuild.js` forbids `src/catalog/features/` in a runtime build, and the Studio-only Assistant tool `list_features` lives behind a new server seam `server/modules/studio.tools.js`.
4. **Substitution is typed and slot-bound.** Parameters have one of five types (`text`, `table`, `source`, `page`, `field`). A binding may only write a string into a slot the catalog declares for that part (`binds`, the `table` of an action object, a part's text children or a plain string prop), at a path that already exists in the fragment, never through `__proto__`, `constructor` or `prototype`. Class names, styles and function props are never slots, the fragment is validated with the same forbidden-prop rules as any layout, and the expanded page is validated again in full.
5. **The table is `studio_features`, not `features`.** Core migrations run in Studio and in built apps against one `app.db`. A spec table named `features` (likely for a roadmap app) would collide with a core table of that name. The `studio_` prefix is already reserved for spec table ids, so no new reserved word is needed and no existing app breaks.
6. **Items is removed everywhere.** Core migration `004_features.sql` creates `studio_features` and drops `items` (the pre-migration `.bak` keeps old rows). Migration `002_items.sql` stays byte-identical (immutable). `items` stays a reserved table id, route segment and category id.

**Consequences.**

- Built apps get core schema v4: an empty `studio_features` table beside the empty `apps` and `builds` (same status as ADR-004 already accepts; the core-track question in OVERVIEW.md stays open and now covers v4).
- A feature changed in the library never changes an app by itself; apps change only when the user clicks "Update to latest" in Design and saves.
- A feature that an app or another feature uses cannot be deleted (409 with the list).
- The Assistant in Studio loses its write tool; confirmation-gated writes stay covered by the runtime Assistant tests.
- Model prompts grow by a bounded block: at most 6 features, 100 characters of description each; helper prompt budgets are kept with the helper (pro, not in the public source).

## ADR-008: How Describe sees a 34-part catalog

**Status:** Accepted (2026-11-03, phase 8), decided by the maintainer from a spike.

**Context.** Phase 8 adds 15 parts (19 to 34), more than the helper's page step could offer at its size caps. Helper prompt budgets and measurements are kept with the helper (pro, not in the public source).

**Options.** (a) Raise the caps to the full size. (b) Two tiers: the outline step names up to 6 optional parts per page; the page step offers `CORE_PARTS` plus those (plus the part types already on a regenerated page).

**Decision: (b) two tiers, with larger caps on the page schema and the page prompt.** Offering only the parts the outline asked for keeps the choice small for a small model and keeps cost bounded as the catalog grows.

**In detail.**

- Constants and the prompt text format: the size caps and the pipeline mechanics of the two tiers are kept with the helper (pro, not in the public source). Every test pins the caps through exported constants.
- Outline schema: the page item gains optional `parts` (not required, so old replies stay valid). The outline prompt gains one line naming each optional part.
- The page step offers the named parts plus the optional types in the prior layout of a regenerated page; it never drops core parts or features.
- A part that was not offered but validates is accepted: offering is about size, not safety. `checkLayout` stays the authority, so there is no new issue code and no extra repair round.
- Menu proposal: the outline schema gains optional `menu` (`position`, `style`) only in create mode or for an edit of an app that already has `menu`, plus one prompt line. It is applied when both values are enum members and dropped otherwise (never a repair). `assemble()` carries `base.menu` through, so an edit never loses it. The model's `style` key is kept as parsed for this one block: `stripForbiddenKeys` removes `style` from layouts, and only enum members are copied out of the block.

**Consequences.** Describe pages use optional parts only when the outline asks; FilterBar and SearchBox reach a page by default. The outline schema and its prompt grow. Helper prompt budgets are kept with the helper (pro, not in the public source).

## ADR-009: Describe may set a layer width

**Status:** Accepted (2026-11-03, phase 9), decided by the maintainer before measuring (offer the width only if both ADR-008 caps hold at the measured worst case; never raise a cap for it).

**Context.** Phase 9 adds the optional layer `sizing` block (`{ width, grow }`, APP_SPEC.md "Layer sizing") so parts can sit side by side. The owner asked for parts placed left and right of each other. Design sets widths by hand; the question was whether the Describe page step may also propose them. ADR-008 left some schema and prompt headroom at the worst case.

**Decision.** The page step offers one optional `width` per layer entry, through one enum in `$defs.w` (the seven `LAYER_WIDTHS`), never required, and no `grow` anywhere. Every `l2`, `l3` and `l4` entry and the Feature entry carry `"width":{"$ref":"#/$defs/w"}`; the Page root, the Tab entry (`t3`) and the Column entry (`c3`) do not (`UNSIZED_TYPES`: their parent sets their width). The prompt gains one sentence (the wording is kept with the helper, pro). `assignLayerIds` turns a width that is a member of `LAYER_WIDTHS`, other than `full`, on a type outside `UNSIZED_TYPES`, into `sizing: { width, grow: false }`; anything else (full, an unknown value, a number, a width on the Page, a Tab or a Column, a `grow` from the model) is dropped, never a repair issue. `pipeline.js` is unchanged: `stripForbiddenKeys` keeps `width`, `expandLayout` carries a Feature node's sizing to its block, and `validateAppSpec` checks the result. An unchanged page keeps its prior layout with its sizing.

**Measurements.** Both worst cases fit with nothing dropped, so the width is offered and no cap changes. The byte figures are kept with the helper (pro, not in the public source).

**Consequences.**

- INFO: the worst-case prompt headroom shrinks. The next growth of the page prompt (a longer part line, a new optional part) must shorten something or revisit the cap; the helper's pinned size test fails first.
- A model that ignores the width writes the same proposal as before (pinned in `describeWidth.test.js`).
- A spec with `sizing` is refused by a phase 8 build (strict schema, no `specVersion` bump, APP_SPEC.md).

## ADR-010: Menu slots and Describe

**Status:** Accepted (2026-11-03, phase 10 Part A). The decision rule was set before measuring: PageHeader's wider children stay in the model only if both ADR-008 caps hold at the measured worst case; caps are never raised.

**Context.** Part A adds menu slots (`menu.start`, `menu.end`) and lets PageHeader and NavLinks hold parts (APP_SPEC.md, CATALOG.md). Describe builds its page schema and prompt from the catalog, so each change had to be weighed against the remaining schema and prompt headroom.

**Decision.**

- Describe does not fill menu slots. Slot parts need page ids and table fields that exist only after the outline reply, and the prompt has no room for the text. Describe sets where the menu sits and how it looks; parts go on the menu in Design. The outline schema keeps `position` and `style` only.
- An edit keeps the slots. In `pipeline.js`, `withSlots(look, current)` puts the `start` and `end` of the current menu back on the look the model proposed, so a re-proposed look never drops them. Slots in a model reply are ignored (the menu is reduced to its two enum members first).
- NavLinks stays a leaf for the model: `MODEL_LEAVES` in `modelSchema.ts` gives it no children entry and `Children: none` in the prompt. Offering its children would have raised the worst-case schema.
- PageHeader children for the model change from Button only to Button, Link and QuickAdd. Allowed children are not in the schema, so only the prompt line changes.

**Measurements.** Both caps hold at the worst case and nothing is dropped, so no `MODEL_CHILDREN_RULE` fallback was needed. The byte figures are kept with the helper (pro, not in the public source).

**Consequences.**

- INFO: worst-case prompt headroom shrinks a little more. The helper's pinned size test fails first on any growth.
- No migration: PageHeader already had children, and a spec without slots is unchanged.
- A model that ignores Link and QuickAdd writes the same proposal as before.


## ADR-011: Preview data kept through app-track migrations

**Status:** Accepted (2026-11-03, phase 10 Part B).

**Context.** Preview runs a runtime child on a scratch `app.db` under `previewRoot()/<appId>`. Until phase 10, `prepareScratch` deleted the scratch data whenever the spec's tables changed in any way, even one added field, and the person was not told. The phase 10 audit showed this as rows that "disappear" after a save.

**Decision.**

- The scratch folder keeps a migration chain made by `planMigration`, the same path a built app updates through. A change it accepts (a new table or field) is applied to the existing `app.db` and the rows stay. A change it refuses (a removed table or field, a field made required, an unsupported type change) clears the data, and the banner says why.
- State is committed only after the child is ready: `applied-spec.json` and the chain are promoted then, and a deferred migration is recorded in `pending-spec.json` so a start that applied it but never got ready is promoted on the next start instead of being dropped.
- The preview child exits with code 4 only when an app-track migration itself fails (not the backup step), and only as the preview child (`APP_PREVIEW_CHILD=1`). The manager clears the data and starts once more only on that code. The main server and built apps keep their exit codes.
- A busy or locked scratch database fails the start (it can be retried) and is never read as migrated; nothing is deleted in that case.
- `PreviewStatus.data` reports `{ kept, reason }`. `POST /api/studio/preview/reset` with `{ appId, confirm: 'reset' }` deletes only the resettable entries inside that app's scratch folder, behind a confirm dialog. The proxy allowlist stays `['/data']`. No SQL comes from input.

**Consequences.**

- Preview data now survives restarts and additive table changes within the Studio data on this PC; it is still separate from built apps' data.
- The preview code depends on `planMigration` (already in the studio sidecar through the build plan), so the size cost is small (BUDGETS.md, phase 10).
- LOW tracked: `pending-spec.json` is matched to the pending migration by version only, not by the SQL file hash; no path reaches a mismatch today.

## ADR-012: Parts placed freely on a grid

**Status:** Accepted (2026-11-06, phase 21). Design: the phase 21 design note (maintainer's private notes).

**Context.** The owner asked for a grid system for positioning parts: a page area where a part sits at a column and row of the person's choice, spans as many cells as they like, and is moved and resized on the canvas. Until now a page was a flow: parts stack, and a row of widths (ADR-009) was as far as freedom went. The Grid part (1 to 4 columns) flowed its children in order. The result had to keep working in a built app, on a phone, with a keyboard and a screen reader, in Export and Import, with the helper untouched (its prompt and schema size caps unchanged and pinned) and CSS under 36 KiB gzip (30.89 before).

**Decision.**

1. **The shape (additive, optional, tolerant; the ADR-009 pattern).** The Grid part gains `placement` (`flow` default, `free`) and `rows` (a stored whole number 1 to 60, free only); a free Grid has `columns: 12` (flow keeps 1 to 4). Each child of a free Grid may carry `grid: { col 1..12, span 1..12, row 1..60, rowSpan 1..12 }`, a strict sibling of `sizing`, with `col + span <= 13` and `row + rowSpan <= 61`. The last row a part covers is therefore at most 60, `rows` is the largest such row end (1 when empty), and the row tables stop at 60. Cells left empty are fine. `specVersion` stays 1; a phase 20 build refuses a spec with the new keys (strict schemas).
2. **One pure reader.** `packages/runtime/src/spec/gridPlacement.ts`, erasable TypeScript with no imports (ADR-006): `readGrid`, `GRID_DEFAULTS` (a new part is 3 columns by 1 row), `cellsOf`, `overlaps`, `nextFreeCell` (reading order), `rowsFor`, `clampPlace`, `movePlace` and `resizePlace` (null on overlap), `stepPlace`, `readingOrder`, `isFreeGridLayer`. The schema, the validator, the renderer and Design all read blocks through it.
3. **The helper is not offered the new props.** `PartDefinition` gains an optional `designProps`, the superset a stored layer may carry; the layout validator parses `designProps ?? props`, and the model schema and prompt keep being built from `props`, which for Grid is unchanged byte for byte. So the page schema and prompt measurements do not move and the helper keeps producing flow layouts. Whether the helper may place parts is an owner question for later (ADR-009 took that step for widths after measuring).
4. **Two validator codes** in the catalog layout check: `grid_not_allowed` (a `grid` block on a layer whose parent is not a free Grid; the walk's root is judged only when it is a Page or a menu slot layer, because Design checks single parts with no parent at hand) and `grid_overlap` (a child of a free Grid whose cells overlap an earlier sibling's). Each message is the copy row's sentence plus its action, and Design shows the same constant when it refuses a drop, a move or a resize. The rows are in `src/errors/copy.core.js` and the DESIGN.md Error codes table as client only rows (they travel inside `invalid_spec` issues, never as an envelope code); the error-count pin moves from 179 to 181. Grid's cross-prop rules (12 columns exactly when free, `rows` only when free, `rows` at least the last row its parts reach) are `invalid_props`; out-of-range blocks are zod's own codes.
5. **Rendering.** `gridClasses.ts` holds literal tables of every `md:col-start-N`, `md:col-span-N`, `md:row-start-N` (1 to 60) and `md:row-span-N` (96 classes). Tailwind 4 takes any whole number for these utilities, so no theme extension or arbitrary value is needed; the estimate is about 0.8 KiB gzip. A free Grid is one column below `md` and 12 columns from `md`; rows are implicit and sized by content with a small minimum from the theme spacing (`minmax(calc(var(--spacing)*10),auto)`), the same on the canvas and in built apps. No pixels in the spec. `rows` is stored for readers and the canvas and is not turned into CSS: implicit `auto` rows equal explicit ones, and a 60-entry rows table would cost CSS for nothing.
6. **Reading order is DOM order.** The renderer and the canvas sort a free Grid's children by row, then column, and the editor keeps the stored array in that order, so a phone stacks the parts in reading order and a screen reader reads them in the same order. CSS `order` classes were rejected: assistive technology ignores them.
7. **One invariant keeper.** `syncGrids` (`src/studio/lib/gridLayout.ts`) drops a block from a part that left a free Grid, gives the next free cell to a part that arrived without one, keeps the children sorted and keeps `rows` in step. Every grid editor calls it, and the Design editor's `apply` calls it on every other result, so Move to..., Undo, the menu bar transfer and the feature paths need no grid code of their own.
8. **Drop model.** One dnd-kit droppable per free Grid, with the cell under the pointer computed from the browser's resolved track sizes, instead of one droppable per cell: up to 732 droppables per Grid would be measured on every drag start and scroll, rows are content-sized, and free versus taken depends on the dragged part's size anyway. A drop on taken cells is refused with the validator's words.
9. **Keyboard.** On a placed part, Alt+Arrow moves one cell and Alt+Shift+Arrow resizes one cell, announced as "Moved to column 4, row 2.", "Now 6 columns wide." or "Now 2 rows tall.". Phase 9 avoided Alt+Arrow because Alt+ArrowLeft is the browser's Back; here the handler calls `preventDefault` on keydown for every handled key, including at an edge and on a refusal, and an e2e step proves the page does not leave Design. Resize handles on the right and bottom edges are a new component (`GridResizeHandle.tsx`), separators with values, stepping by the arrow keys; `ResizeHandle.tsx` keeps its pair semantics.
10. **Switching back to flow** deletes the blocks, `placement` and `rows` after a confirm ("Their places are forgotten."), because flow has nowhere to keep them; `columns` becomes the most parts any one row held, at most 4. Switching to free gives each child the next free cell in order at `12 / columns` wide, so the layout looks the same at once.

**Consequences.**

- The runtime template changes: two new files (`gridPlacement.ts`, `gridClasses.ts`) and `schema.ts`, `Grid.def.ts`, `Grid.tsx`, `SpecRenderer.jsx`, `types.ts`, `validateLayout.ts`, `features/expand.ts` and `copy.core.js` differ from cbb8b51 for this reason; the template parity lists say so.
- A page the helper regenerates comes back as flow, like widths today; a page it leaves unchanged keeps its blocks. Phase 22: the helper now emits the grid block (`placement` and a per-child `grid`) and a page it regenerates keeps its places, with no cap moved (the phase 22 design note, kept in the maintainer's private notes; helper prompt budgets are kept with the helper, pro).
- Old specs read, validate, normalize and render exactly as before; the spec fuzz test and the fixtures keep passing.
- Built apps carry the class tables in their CSS and nothing in their sidecar (the runtime server never reads layouts).
- LOW tracked: on the canvas a placed part's block stretches over its rows while the part inside keeps its height; in a built app the part itself stretches (visible only on parts with a background).

## ADR-013: Automations in the spec: auto number and rules on a status change

**Status:** Accepted (2026-11-11, phase 28).

**Context.** People number invoices by hand and set dates by hand when a status changes. Both are deterministic writes that code can do inside the save, with no model. Records also need a way in (CSV) and a way out with the design (export with records).

**Decision.**

1. **Two additive optional keys** (the ADR-009 and ADR-012 pattern): `autoNumber` on one text or integer field per table, `rules` on a table. `specVersion` stays 1; a phase 27 build refuses a spec carrying them (its schemas are strict). No migration, no column, no `planMigration` step.
2. **Pure readers** in erasable TypeScript with no imports (`packages/runtime/src/spec/autoNumber.ts`, `rules.ts`, ADR-006), tolerant on read; the runtime server never imports `schema.ts`. `schema.ts` and the readers share one rule check (`ruleProblems`), so they cannot drift.
3. **The counter.** The runtime assigns the number inside the insert transaction from `app_state` key `autonumber.<table>.<field>` (`{ last }`): one state read and one column scan per transaction, then in memory, `max(start, last + 1, highest stored + 1)`. A client or model value is refused (API) or stripped (Assistant create). `PUT /api/state` refuses `autonumber.*` keys. A ZIP import sets the counter to the highest of the state before the import, the archive's state and the highest stored value. Numbers are never reused after a delete.
4. **Rules** run in code on POST and PATCH in the same transaction: one pass, no chains, never on another record. A rule never overwrites a value the person changed in this write (on PATCH a key counts as theirs only when it differs from the stored value, because a form sends the whole row; on POST only when it is not empty). Rule writes pass the same `validateRecord` and `checkReferences` as the person's, and the response names them in `applied`.
5. **The helper is not offered either key:** the model keeps the pre-phase tables schema (`ModelTableSchema`, byte-pinned by a golden), and `describeRoute.js` strips the keys before a helper run and restores the ones that still fit after it. Prompt and schema bytes do not move.
6. **CSV import** (`POST /api/data/:table/import`) runs every row through the same writer as the API, 500 rows per transaction, dry run first (rolled back, same code path), links by id or by title (trimmed, case-insensitive), rules only when the person ticks Apply automations. Export CSV guards formula-looking cells, including cells that start with quotes before a formula start, so the importer's unguard is an exact inverse.
7. **Export with records** is the kit export ZIP of the app's Preview data plus `app.json`; records come back through the kit importer (built-app Settings > Import, `npm run import`). There is no Studio ZIP import, and records never travel in an installer (OQ-17-2).
8. Three client-only validator codes (`auto_number_not_allowed`, `rule_field_missing`, `rule_not_allowed`) and two import codes (`import_csv_invalid`, `import_mapping_invalid`); error-count pin 181 to 186.

**Consequences.** No migration, no column, no prompt or schema byte, no dependency, no budget raise. A backup restore brings back the counter with the rows (same file); ZIP and CSV imports keep the next number above the highest stored value. Restoring an older backup hands out again the numbers given after it, because the app cannot know about records that left it (USER_GUIDE). The helper cannot write automations yet; people add them on the Data step.
