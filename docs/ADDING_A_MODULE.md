# Adding a module

The kit's example module is **Features** (the Studio feature library, [FEATURES.md](FEATURES.md)). It touches every layer, so the fastest way to add your own module is to copy Features layer by layer and rename. This page walks through Features file by file, then gives a checklist.

You can build a module by hand, or ask a coding agent: `CLAUDE.md` holds the same map and the rules, and `/ship-feature` runs the whole pipeline (see [FEATURE_WORKFLOW.md](FEATURE_WORKFLOW.md)).

The examples below use a made-up module called `widgets`.

## The Features slice, file by file

### 1. Migration: `server/db/migrations/004_features.sql`

A `CREATE TABLE studio_features (...) STRICT;` with defaults and `CHECK` constraints (id shape, name and description lengths, a JSON `body`), plus an index. Migrations are forward-only: you add a new numbered file and never edit a shipped one (`002_items.sql` stays as it shipped; `004` drops that table). Before a migration runs, the app copies the database to a `.pre-v<N>.bak` file, and a failing migration leaves the live file untouched.

Each shipped migration has a SHA-256 in `server/db/migrations.lock.json` (content with `\r\n` normalized to `\n`). `server/__tests__/migrationSafety.test.js` fails if a migration is missing from the lock or a locked file changed, and it upgrades a populated database from every older version.

### 2. Registry: the module descriptor `server/modules/studio.data.js`

Tables are declared by a module descriptor, not by editing `server/db/tables.js`. `studio.data.js` contributes `tables` (the primary key, the auto-timestamp columns and every column with its type; a table that is not listed cannot be queried), `importOrder` (parents before children), `foreignKeys`, `dataTables` (the export defs) and the cloud category and tool maps. `studio_features` is in each of them. The descriptor is empty outside Studio mode and `studio.data.disabled.js` replaces it in a built app.

### 3. Validation: `validateFeatureInput`

One place decides what a valid feature is: `validateFeatureInput` in `src/catalog/features/validate.ts` (pure, no I/O) checks ids, names, settings, the fragment, the bindings and every limit in `src/catalog/features/limits.ts`. The store, the import path and the browser all call it, so they accept the same input and give the same issues. Stored rows are validated again on every read; a damaged row reads as `ok: false` instead of breaking the list.

### 4. Store: `server/studio/features/store.js`

Plain functions over the database: `listFeatures`, `getFeature`, `createFeature`, `updateFeature` (a version bump only when the body changes, with a `baseVersion` check), `duplicateFeature`, `deleteFeature` (refused with the apps and features that use it, `server/studio/features/usage.js`), `importFeatureFile` (all or nothing, renames on a clash), `loadLibrary` and `listFeatureSummaries`. All SQL goes through `server/db/index.js`; none is built from input.

### 5. Routes: `server/studio/features/routes.js`

`GET/POST /api/studio/features`, `POST /api/studio/features/import`, `GET/PUT/DELETE /api/studio/features/:id` and `POST /api/studio/features/:id/duplicate`, registered through `registerStudioRoutes` from the module's `register(app)` in `server/modules/studio.js`. Errors are fixed bodies: `400 invalid_feature`, `400 invalid_feature_file`, `404 feature_not_found`, `409 feature_id_taken`, `409 version_conflict`, `409 feature_in_use`, `409 too_many_features`. The module's `limiters` and `noStorePaths` cover the `/api/studio` prefix.

### 6. Network policy: `server/netPolicy.js`

Features make no outbound call, so they add nothing here. If your module does (say, a price lookup), add a feature to `NETWORK_FEATURES` (id, label, description, hosts), then guard the route with `requireNetwork('<id>')` or library code with `assertNetworkEnabled('<id>')`. While the user has not turned the feature on, the route answers `403 { error: 'network_opt_in_required', feature, message }` and sends nothing. The search for `app.get('/api/settings/updates/check', requireNetwork('updates'), ...)` in `server/settingsRoutes.js` shows a working example.

### 7. Assistant tool: `server/modules/studio.tools.js`

- The module's tool specs hold `list_features`, a read tool: id, name, description, settings and how many apps use each feature. Counts come from code (`listFeatureSummaries`), the model only words them.
- `executeTool` in `server/agents/assistantTools.js` runs a tool by name through the module registry.
- Studio ships no write tool. For a write tool, copy the runtime `save_record` pattern: its name goes in `WRITE_TOOLS`, `describeWrite()` in `server/agents/pendingActions.js` gives the one-line Approve text, and `precheckWrite()` validates before the call is parked. With `ASSISTANT_CONFIRM_WRITES` on (the default) a write is parked behind a single-use token and the user approves or declines it with `POST /api/assistant/actions/:token`. Writes per request are capped (`ASSISTANT_WRITE_CAP`, default 3).

Details of the approval flow are in [AI.md](AI.md).

### 8. Cloud data categories: the descriptor and `server/ai/privacy.js`

If the user turns on a cloud provider, the server only sends the categories they allow. The module declares its category (`features`, on by default) in `cloudCategories` and maps its tools and pages in `toolCategories` and `pageCategories` (`list_features: 'features'`). A category is one id, or an array of ids when a result spans more than one kind of data; an array needs every category in it shared. A tool or page missing from these maps is refused under cloud. Local Ollama is unaffected.

Mirror any change in `src/constants/cloudAi.js` (labels and hints for Settings). `server/__tests__/cloudAiParity.test.js` checks the two stay in step.

### 9. Pro: none shipped

No Pro capability ships with the kit. `pro/server/pro.js` keeps one placeholder, `example_pro` (the public stub `server/pro.js` lists the same ids), so the gating tests and the license UI have something to exercise. To gate a capability, add an entry to `PRO_FEATURES` in both files, mount `requirePro('<id>')` first on the route (before body validation and before `requireAi`) and read `useEntitlements()` in the UI. See [LICENSING.md](LICENSING.md).

### 10. Frontend

| File | Role |
| --- | --- |
| `src/modules/studio.jsx` | The lazy routes `/features`, `/features/new` and `/features/:featureId/edit`, and the menu entry |
| `src/studio/pages/FeaturesPage.tsx` | The page: your features, built-in parts, import; **New feature** and **Edit** open the builder |
| `src/studio/pages/FeatureBuilderPage.tsx`, `src/studio/builder/` | The Feature builder (replaces the old edit dialog): a bench over the Design canvas, slot model, Slots panel, save dialog |
| `src/studio/showcase/` (`FeatureTile.tsx`, `FeatureDrawer.tsx`, `PreviewFrame.tsx`, `entries.ts`) | The tiles, the details drawer and the lazy preview, drawn by the runtime renderer over sample rows |
| `src/studio/components/FeatureValuesForm.tsx`, `SaveFeatureDialog.tsx` | The settings form and save a selection as a feature |
| `src/studio/design/` (`DesignCanvas.tsx`, `FeatureShelf.tsx`, `BlockSettings.tsx`, `DropZone.tsx`) | The Design side: the drag and drop canvas, the shelf, the settings popover and the "Add here" places. Tree edits are the pure helpers in `src/studio/lib/layoutTree.ts` |
| `src/studio/hooks/useFeatures.ts` | Data hook |
| `src/studio/services/studioApi.ts` | API client (`featuresApi`). Errors carry `status`, `code` and `issues` |
| `src/studio/lib/featureFromSelection.ts` | Turns a selection into a feature and back |
| `src/hooks/useAssistant.js` | `TOOL_LABELS`: the friendly name of each tool while it runs |

Browser storage keys go through `lsKey()` in `src/utils/storageKeys.js`.

### 11. Export and import

- **Export:** the `dataTables` entry in `studio.data.js` puts the table in the ZIP (JSON and CSV). For readable Markdown, add a renderer to `MARKDOWN_RENDERERS` in `server/export/buildArchive.js` (empty in the kit).
- **Import:** `server/import/importExport.js` imports the tables in the import order, so the `importOrder` entry is what makes the table restorable.
- A single feature also exports as a `*.feature.json` file and imports through `POST /api/studio/features/import`.
- Export, import and backups are never paywalled.

Also update `src/constants/storageMap.js` and `src/constants/tableLabels.js` so Settings names your table.

### 12. Tests

| Layer | Example tests |
| --- | --- |
| Migration | `server/__tests__/migrationSafety.test.js` (covers every migration after you update the lock) |
| Pure library | `src/catalog/features/__tests__/` (validation, expansion, slots, sample data, model block) |
| Store and routes | `server/__tests__/studio/featuresStore.test.js`, `featuresRoutes.test.js` |
| Assistant tool | `server/__tests__/studio/studioTools.test.js` |
| Cloud categories | `server/__tests__/cloudScope.test.js`, `cloudAiParity.test.js` |
| Export and import | `exportRoutes.test.js`, `importRoundTrip.test.js` |
| UI | `src/studio/pages/__tests__/FeaturesPage.test.tsx`, `src/studio/components/__tests__/`, `src/studio/hooks/__tests__/useFeatures.test.ts` |
| End to end | `e2e/flows/features.spec.js` with `e2e/pages/features.js` |

Backend tests use a real temporary SQLite database (`server/__tests__/helpers/testDb.js`), never a mock, and never need a real Ollama (`server/__tests__/helpers/fakeOllama.js`). A network guard blocks real outbound connections in tests.

## Checklist for a new module

1. **Migration.** Add `NNN_widgets.sql` with the next number. Compute its SHA-256 (CRLF normalized to LF) and add it to `server/db/migrations.lock.json`. Never edit a shipped migration.

   ```powershell
   node -e "const c=require('crypto'),fs=require('fs');console.log(c.createHash('sha256').update(fs.readFileSync('server/db/migrations/003_widgets.sql','utf8').replace(/\r\n/g,'\n')).digest('hex'))"
   ```

2. **Table registry.** Declare the table in your module descriptor (like `server/modules/studio.data.js`): `tables`, then, parents before children, `importOrder`, plus `foreignKeys` if you have them. The kit tables stay in `server/db/tables.js`.
3. **Validation and store.** Put validation in one pure function, as `validateFeatureInput` does, and the database functions in a store file like `server/studio/features/store.js`. No SQL built from input.
4. **Routes.** Add routes like `server/studio/features/routes.js` and register them from the module's `register(app)`. Use the same fixed error bodies.
5. **Network.** If a route calls the internet, add a `netPolicy` feature and guard it. Otherwise do nothing.
6. **Assistant.** Add tool specs and cases to the module's tools file (like `server/modules/studio.tools.js`). Declare each tool's category (one id, or an array when its result carries more than one kind of data) in the descriptor's `toolCategories`, and a new data category in `cloudCategories` and `src/constants/cloudAi.js` together. For a write tool, add its name to `WRITE_TOOLS` and a line to `describeWrite()`, and validate in `precheckWrite()`. Add a tool label in `src/hooks/useAssistant.js`.
7. **Numbers.** Compute every total, count and average in SQL or JavaScript and pass only results to the model. Keep a test that shows the model was not asked to do math.
8. **Frontend.** Add the page, components, hook and service. Route it from the module's routes (like `src/modules/studio.jsx`) or, for a kit page, in `src/App.jsx` and `navItems.js`, and add the page key to `src/constants/assistantPages.js` and `server/assistant/pages.js` together (and to `pageCategories`).
9. **Export and import.** Add a `dataTables` def and the table to `importOrder` in the descriptor. Add a Markdown renderer if you want one.
10. **Pro (optional).** Replace or add to the `example_pro` placeholder in `PRO_FEATURES` in `pro/server/pro.js` and in its public stub `server/pro.js`, mount `requirePro('<id>')` first on the route, and use `useEntitlements()` in the UI.
11. **Tests.** Add migration, route, tool and UI tests, then run:

    ```powershell
    npm test
    npm run lint
    npm run check
    ```

Keep the rules in [PRODUCT.md](PRODUCT.md) while you build: never paywall the user's data, never lose data, and no outbound call without a `netPolicy` feature.
