# File ownership for phases 2 and 3

Phase 2 (runtime core, branch `feat/runtime-core`) and phase 3 (Studio, branch `feat/studio`) run in parallel from the same `main` commit (the end of phase 1). They must never edit the same file. That works because phase 1 creates **registration seams**: kit files that used to be edited per module (App.jsx, navItems, assistant pages, privacy, tables, server.js) now read module descriptors, and each team owns only its own descriptor files. Decisions behind this: ADR-001 and ADR-004 in [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md).

The tables below record who owned which file at the time, with the paths as they were then. Since phase 18 these moved: `src/runtime`, `src/spec`, `src/theme` and `src/catalog/parts` are under `packages/runtime/src/`, `server/runtime` is `packages/runtime/server`, and the helper (`src/catalog/modelSchema.ts`, `server/studio/describe/pipeline.js`, `prompts.js`) is under `pro/`.

## Created in phase 1 (the seams)

Phase 1 writes these files and edits the listed kit files once. After phase 1 they are frozen for both teams.

### Mode

| File | Exports |
| --- | --- |
| `server/appMode.js` | `resolveAppMode(env = process.env, { root } = {}): 'studio' \| 'runtime'` (ADR-001 rules); `getAppMode()` (baked `__APP_MODE__` when bundled, else `resolveAppMode()`, cached; a runtime bundle throws on `APP_MODE=studio`) |
| `src/appMode.js` | `APP_MODE` (from the Vite define `__APP_MODE__`; `'studio'` under Vitest unless `APP_MODE` is set) |
| `scripts/desktop/modeBuild.js` | `resolveBuildAppMode(env, root)`, `studioUiPlugin(mode)` (Vite, also serves `virtual:app-spec`), `studioServerPlugin(mode)` (esbuild). Wired into `vite.config.js`, `buildSidecar.js` and `workerBundle.js` (`bundleDefine()` gains `__APP_MODE__` and `__APP_SPEC_JSON__`) |

Runtime-mode swaps (seam to stub): `src/modules/studio.jsx` to `studio.disabled.jsx`, `src/modules/studio.assistant.js` to `studio.assistant.disabled.js` (both Vite and esbuild, the server reads it too), `server/modules/studio.js` to `studio.disabled.js`, `server/modules/studio.data.js` to `studio.data.disabled.js`. Forbidden in runtime builds: `src/studio/**`, `server/studio/**`, the Design canvas and showcase (`src/studio/design/**`, `src/studio/showcase/**`), `@dnd-kit`, and on the server also `zod` and `src/spec/schema.ts`.

### Frontend module registry

```js
// src/modules/runtime.jsx and src/modules/studio.jsx: default export FrontendModule
/** @typedef {{
 *   id: 'runtime' | 'studio',
 *   modes: Array<'studio' | 'runtime'>,          // runtime: ['runtime'], studio: ['studio']
 *   routes: Array<{ path: string, Component: import('react').LazyExoticComponent<import('react').ComponentType> }>,
 *   navGroups: Array<{ section: string | null, id: string, items: Array<{ to: string, label: string, icon: import('react').ComponentType, end?: boolean, exclude?: string[] }> }>,
 *   replacesKitPaths: string[],                  // kit routes and nav items to drop, e.g. ['/', '/settings']
 *   settingsSections: Array<{ id: string, Component: import('react').LazyExoticComponent<import('react').ComponentType> }>,
 *   shell?: { Frame: ComponentType<{ children }>, kitSettings: string[], settingsIntro: string, settingsResetNote: string }, // owns the frame and first start (a built app); Studio has none
 * }} FrontendModule */

// src/modules/index.js
export const MODULES;                  // [runtime, studio] filtered by m.modes.includes(APP_MODE)
export const MODULE_ROUTES;            // MODULES.flatMap(m => m.routes)
export const MODULE_NAV_GROUPS;        // MODULES.flatMap(m => m.navGroups)
export const REPLACED_KIT_PATHS;       // Set of paths
export const MODULE_SETTINGS_SECTIONS; // MODULES.flatMap(m => m.settingsSections)
export const MODULE_SHELL;            // the active module's shell, or null (Studio): App.jsx uses Frame instead of AppShell, Settings shows kitSettings
```

```js
// src/modules/runtime.assistant.js and src/modules/studio.assistant.js: pure JS, NO imports
export const ASSISTANT_PAGES = { /* key: { label, suggestions } */ };   // runtime: app, data
export const FALLBACK_PAGE_KEY = 'app';   // runtime; studio exports null
```

Kit files phase 1 edits to consume them:

- `src/App.jsx`: renders `MODULE_ROUTES` first, then the kit routes whose path is not in `REPLACED_KIT_PATHS`, then the `*` redirect.
- `src/components/shell/navItems.js`: `NAV_GROUPS` = the kit `home` group (unless replaced), then `MODULE_NAV_GROUPS`, then the kit `settings` group minus replaced items.
- `src/pages/Settings.jsx`: renders `MODULE_SETTINGS_SECTIONS` after the kit sections, each in its own `Suspense`.
- `src/constants/assistantPages.js`: merges both `ASSISTANT_PAGES` files into `ASSISTANT_PAGES` (a duplicate key throws); `resolveAssistantPageKey` returns the first-segment key, else the first non-null `FALLBACK_PAGE_KEY`, else `null`. It may import the two pure files (they have no imports, so the Node parity test still loads it).

### Server module registry

```js
// server/modules/runtime.js and server/modules/studio.js: default export ServerModule
/** @typedef {{
 *   id: 'runtime' | 'studio',
 *   modes: Array<'studio' | 'runtime'>,
 *   noStorePaths: string[],                                   // runtime: ['/api/data'], studio: ['/api/studio', '/api/preview']
 *   ownBody?: Array<{ path: string, tooLarge: object }>,       // routes with their own body parser and 413 body (added in the phase 1 review; server.js skips the global parser for them)
 *   limiters: Array<{ path: string, windowMs: number, max: number }>,   // own budget, skipped by the global limiter
 *   aiPostPaths: string[],                                    // POSTs that spend the strict AI budget, e.g. '/api/studio/describe'
 *   register: (app: import('express').Express, ctx: { authEnabled: boolean }) => void,
 *   onStart?: () => void | Promise<void>,                     // after listen (e.g. mark interrupted builds)
 *   onStop?: () => void | Promise<void>,                      // in stop(), before shutdownDb (e.g. kill the preview child)
 * }} ServerModule */

// server/modules/index.js
export const SERVER_MODULES;                       // [runtime, studio]
export function activeServerModules(mode = getAppMode()): ServerModule[];
export function moduleNoStorePaths(): string[];
export function isModuleBudgetPath(req): boolean;  // (req.baseUrl + req.path), lowercased, trailing slashes dropped, prefix match
export function mountModuleLimiters(app, rateLimit): void;   // one express-rate-limit per entry, kit message body
export function mountModuleAiLimiters(app, wrap): void;      // wrap = (path) => postLimiter(strictLimiter)
export function registerServerModules(app, ctx): void;
export function startServerModules(): Promise<void>;
export function stopServerModules(): Promise<void>;
```

```js
// server/modules/runtime.data.js and server/modules/studio.data.js: default export ModuleData (pure data)
/** @typedef {{
 *   id: 'runtime' | 'studio',
 *   tables: Record<string, { primaryKey: string, autoNow: string[], columns: Record<string, ColType> }>,
 *   importOrder: string[],
 *   foreignKeys: Array<{ table: string, column: string, references: { table: string, column: 'id' }, onDelete: 'cascade' | 'set null' | 'restrict' }>,
 *   dataTables: DataTableDef[],
 *   cloudCategories: Array<{ id: string, default: boolean, noun: string, plural: boolean }>,
 *   pageCategories: Record<string, string | string[] | null>,
 *   toolCategories: Record<string, string | string[] | null>,
 *   networkFeatures: Array<{ id: string, label: string, description: string, hosts: string[] }>,
 * }} ModuleData */
// server/modules/data.js
export const MODULE_DATA;   // [runtime, studio]; each returns an empty descriptor when its mode is not active
```

A `*.data.js` file must not import anything that reaches `server/db/` (it is loaded by `tables.js`); it may import `server/appMode.js` and `server/spec/source.js` (created by phase 2) and `server/spec/compile.js` (pure). Kit files phase 1 edits to consume `MODULE_DATA` (a duplicate id throws at import, tested):

- `server/db/tables.js`: `TABLES`, `IMPORT_ORDER` (kit first, then modules), `FOREIGN_KEYS`.
- `server/dataTables.js`: `DATA_TABLES`.
- `server/ai/privacy.js`: `CLOUD_CATEGORY_IDS`, `CLOUD_CATEGORY_DEFAULTS`, `CATEGORY_NOUNS`, `PAGE_CATEGORIES`, `TOOL_CATEGORIES`.
- `server/netPolicy.js`: `NETWORK_FEATURES`.
- `server/assistant/pages.js`: `ASSISTANT_PAGE_LABELS` from the two `src/modules/*.assistant.js` files.
- `server.js`: no-store list plus `moduleNoStorePaths()`; global limiter gets `skip: isModuleBudgetPath`; `mountModuleLimiters` right after the global limiter; `mountModuleAiLimiters` next to the strict AI limiter lines; `registerServerModules` after `registerLicenseRoutes` and before the `/api` 404; `startServerModules` after listen; `stopServerModules` inside `stop()`.

### Contract stubs (owned by phase 2 after phase 1)

- `server/spec/index.js`: `export * from '../../src/spec/schema.ts';` (frozen, ADR-006).
- `server/spec/compile.js`: `compileSpec(spec)` and `planMigration(builtSpec, nextSpec)` with the ADR-004 return shapes; the stub throws `Error('not_implemented')`.
- `src/runtime/index.js`: `SpecApp({ spec, apiBase, basePath })` and `SpecPage({ spec, pageId, apiBase })`; the stub renders layouts with `LayerRenderer` only.
- `src/spec/fixtures/crew-roster.json`: the APP_SPEC.md example, valid, frozen (both teams' tests may read it).
- Spike files: `src/catalog/*` (five parts, CATALOG.md) become phase 2's; `src/studio/pages/Designer.tsx` and `src/studio/pages/PreviewSpike.tsx` become phase 3's. `docs/BUDGETS.md` gets a Runtime and a Studio section.

## The `/api/data` question

The kit has **no** `/api/data` routes: the prefix appears only in the `no-store` list in `server.js` (Studio features live under `/api/studio/features`, settings under `/api/settings`). So the generic data API uses `/api/data/:table` exactly as the brief says, and it is already `no-store`. Its own limiter is the runtime module's `limiters` entry `{ path: '/api/data', windowMs: 900000, max: 3000 }`, mounted right after the global limiter, which skips that prefix (BRIEF 4.8: the global 300 per 15 minutes blocks CRUD screens). It is mounted before the auth gate like the global one it replaces for that prefix; the desktop gate still runs first. Studio's `/api/preview` proxy gets the same budget. `:table` is checked against the compiled spec table list only, never `TABLES`, so `app_state`, `app_secrets`, `audit_log` and the reserved `items` table name are unreachable through it.

## Migration numbers

- Core track `server/db/migrations/`: `001_init.sql` and `002_items.sql` (kit). **`003_studio.sql` belongs to phase 3** (tables `apps`, `builds`), with its one line in `migrations.lock.json`. **Phase 2 adds no core migration**: runtime state goes in `app_state` or in the app track. Versions must be contiguous, so a gap on one branch would break its tests; that is why phase 2 does not reserve 004. The next core number after the merge is assigned by the parent.
- App track `server/db/migrations/app/`: generated per built app by the compiler (`001_app.sql`, `002_app.sql`, ...), written by the build pipeline into the template, never committed in the Studio repo. Separate version table (`app_schema_version`), so it can never collide with core numbers. Phase 2 owns the runner.

## Phase 2: runtime core (`feat/runtime-core`)

| Owns (create and edit freely) | |
| --- | --- |
| `server/runtime/**` | data API (`/api/data`), row validators, stats, generic Assistant tool implementations |
| `server/spec/**` except `index.js` | `source.js`, `compile.js`, `planMigration`, SQL emitters |
| `server/modules/runtime.js`, `server/modules/runtime.data.js` | |
| `server/db/migrate.js`, `server/db/index.js` | app-track runner (ADR-004) |
| `server/agents/assistantTools.js`, `pendingActions.js`, `prompts.js`, `assistantAgent.js` | generic read tools, confirmation-gated write tool |
| `server/export/**`, `server/import/**` | only if spec tables need changes |
| `src/runtime/**`, `src/catalog/**` | renderer, data browser, `SpecApp`, all parts, `modelSchema.ts`, `validateLayout.ts` |
| `src/modules/runtime.jsx`, `src/modules/runtime.assistant.js` | |
| `src/components/assistant/ConfirmActionCard.jsx` | generic write confirmation |
| Tests: `server/__tests__/runtime/**`, `server/__tests__/spec/**`, `src/runtime/**/__tests__/**`, `src/catalog/**/__tests__/**` | |
| `docs/CATALOG.md` (part details), `docs/BUDGETS.md` Runtime section | |

## Phase 3: Studio (`feat/studio`)

| Owns (create and edit freely) | |
| --- | --- |
| `server/studio/**` | apps service, Describe pipeline, preview child manager and proxy, toolchain status |
| `server/modules/studio.js`, `studio.data.js`, `studio.disabled.js`, `studio.data.disabled.js` | |
| `server/db/migrations/003_studio.sql` | plus one appended line in `migrations.lock.json` |
| `server/ai/providers/ollama.js`, `server/ai/index.js` | structured output (`format: <schema>`); not `privacy.js` |
| `server/role.js`, `server/entry.js` | the `preview` role |
| `src/studio/**` | pages, components, hooks, services, the action editor and field overrides |
| `src/modules/studio.jsx`, `studio.assistant.js` and their `.disabled` stubs | |
| `src/vendor/ui-builder/**` | patches recorded in `src/vendor/ui-builder/README.md`; phase 2 imports `LayerRenderer` read-only. Since phase 7 nothing imports it; the folder stays, unused |
| Tests: `server/__tests__/studio/**`, `src/studio/**/__tests__/**` | |
| `docs/BUDGETS.md` Studio section | |

Phase 3 imports from phase 2 only through `src/runtime/index.js`, `src/catalog/registry.tsx`, `src/catalog/definitions.ts`, `src/catalog/modelSchema.ts`, `src/catalog/validateLayout.ts`, `server/spec/index.js` and `server/spec/compile.js`, against the phase 1 stub signatures; until the merge it tests with those stubs or its own fakes.

## Shared files: rules

| File | Rule |
| --- | --- |
| `package.json` | Add lines only (dependencies, devDependencies, scripts) as listed in the phase prompt; never reorder or bump existing entries |
| `package-lock.json` | Never hand-merged: the parent regenerates it with `npm install` after merging `package.json` |
| `tsconfig.json`, `eslint.config.js`, `vite.config.js` | Frozen after phase 1. A needed change is requested from the parent, applied on `main` and merged into both branches |
| `scripts/checks/bundle-budget.json`, `sidecar-budget.json` | Not edited by either branch. Each reports measured sizes in its `docs/BUDGETS.md` section; the parent sets budgets at merge |
| `server/db/migrations.lock.json` | Phase 3 appends one line; phase 2 does not touch it |
| `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md` | Append-only, one entry per change; the parent resolves conflicts |
| `src/spec/schema.ts`, `docs/APP_SPEC.md` | Frozen; a parent-approved patch on `main` only |

## Never touched by either branch

Every phase 1 seam file above (`server/appMode.js`, `src/appMode.js`, `scripts/desktop/modeBuild.js`, `src/modules/index.js`, `server/modules/index.js`, `server/modules/data.js`, `server/spec/index.js`), the kit files that consume them (`server.js`, `src/App.jsx`, `src/components/shell/navItems.js`, `src/pages/Settings.jsx`, `src/constants/assistantPages.js`, `server/assistant/pages.js`, `server/ai/privacy.js`, `server/db/tables.js`, `server/dataTables.js`, `server/netPolicy.js`), `server/db/query.js`, `server/db/codec.js`, shipped migrations `001` and `002`, `src-tauri/**`, `scripts/desktop/**`, `scripts/init-app.mjs`, `config/**`, and the docs `ARCHITECTURE_DECISIONS.md` and `OWNERSHIP.md`. A team that finds it needs one of these stops and asks the parent.

## Phase 7: themes, showcase, Design canvas

| Owns | |
| --- | --- |
| `src/theme/**` | the theme engine: data (`themes.ts`), `resolve.ts`, `sanitize.ts`, `variables.ts` (the allowed custom properties), `applyRoot.ts` (a built app). Pure TypeScript, no React; the runtime may import it |
| `src/studio/theme/**` | `ThemeScope` (the one place Studio applies theme variables), the picker, the swatch, `ThemeDialog` (Change look) |
| `src/studio/showcase/**` | the Features page tiles, details drawer and `PreviewFrame` |
| `src/studio/design/**` | the Design canvas, shelf, drop zones and settings popover |
| `src/studio/lib/layoutTree.ts` | the pure tree helpers (insert, move, remove, replace, configure, `addTab`) |

`src/runtime/**` and the runtime module import `src/theme/**` only, never `src/studio/**` (`src/runtime/__tests__/noEditor.test.js`).

## What will be open and what stays pro

The code is split by license, and the repository is laid out for it:

- **Open core: AGPL-3.0.** The Studio, the server skeleton, the data layer, the Tauri shell, the checks, the docs and the e2e suite. The root `LICENSE` is the GNU AGPL-3.0 text.
- **Runtime slice: MIT, in `packages/runtime/`.** The app spec, the theme engine, the part catalog components, the renderer and the runtime server routes that ship inside every built app (`packages/runtime/LICENSE`, [ARCHITECTURE.md](ARCHITECTURE.md), "The runtime package").
- **Pro: FSL-1.1-MIT, in `pro/`.** The helper (prompts, pipeline, part lists, eval set), the Make installer and release automation, licensing and the Pro gate, and the cloud provider (`pro/LICENSE`, `pro/README.md` (pro, not in the public source)). Each pro module that open code imports has a public stub at its original path, so a build without `pro/` (or with `APP_PRO_DIR=none`) still works with those parts absent ([ARCHITECTURE.md](ARCHITECTURE.md), "The pro seam").

The public source is made by an export that leaves out `pro/` and starts a fresh history. One decision is open: a built app carries pro files (the licensing twins and the cloud provider) and the MIT slice imports AGPL code, so which license a built app has as a whole is not settled.
