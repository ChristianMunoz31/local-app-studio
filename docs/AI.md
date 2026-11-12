# Assistant and models

How the built-in assistant (named **Assistant** in the UI) talks to a model, what it is allowed to do, and what leaves the computer. Everything here is read from `server/ai/`, `server/agents/`, `server/aiSettingsRoutes.js` and the Settings UI.

## One boundary

All model calls go through `server/ai/index.js`. No other file imports a provider, and `server/__tests__/aiBoundary.test.js` enforces it. That one door is where the rules below are applied: which provider is allowed, which data categories may leave, how errors are shown and how long a call may wait.

## The boundary

The model is kept apart from what it can reach. Full map in [AI_BOUNDARY.md](AI_BOUNDARY.md).

- The helper returns JSON only. Code parses, strips forbidden keys, repairs, validates against the spec validator and the catalog, and never lets the reply set the app block, a path, a command or a URL. On an ask, code keeps the tables and fields you did not ask to remove. Code also removes a number, a date or a record value the model wrote into a page as words.
- The Assistant calls only a fixed list of tools, by name. An unknown name is refused in a plain sentence and logged. No delete tool exists. JSON in a reply that names a tool the app does not have is replaced by a plain sentence, even when it is quoted from a record or asked for as an example.
- Every Assistant reply passes a fixed chain of guards in code: a tool call written as text is refused, a number after a refused read is replaced, a number found in no tool result of the turn is replaced, a claim of a change nothing made is replaced, and tool names are swapped for plain words ([AI_BOUNDARY.md](AI_BOUNDARY.md), section 4).
- A save is parked behind a single-use token and runs only after you press Approve; in the desktop app this is always on.
- Tool results and records are given to the model as data, not instructions, and the code gates do not depend on what the model says.
- A link the model writes in an Assistant reply is shown as plain text, the link words then the real host in brackets; it is not clickable.
## Local model with Ollama (the default)

Assistant runs on [Ollama](https://ollama.com/download), a free program the user installs on their own computer. The server talks to it on `http://127.0.0.1:11434` (the default host).

- **Chat** uses Ollama's native `POST /api/chat`. The reply streams as newline-delimited JSON, so the first-token timeout works the same everywhere. Messages and tool calls are kept in OpenAI shape inside the app and converted for Ollama in `server/ai/providers/ollama.js`.
- **Fixed paths only.** The server only ever requests `/api/version`, `/api/tags`, `/api/show`, `/api/chat` and `/api/pull`. User input never becomes part of a path, and redirects are refused.
- **Capabilities.** `/api/show` tells the app whether a model supports tools and how many parameters it has.
- **Context and memory.** `num_ctx` is 8192 (capped at the model's own limit) and `keep_alive` is 10 minutes by default.
- **A model on another computer.** A non-loopback Ollama host needs the `aiLan` opt-in in Settings > Network. Without it the server answers `403 network_opt_in_required` and sends nothing.

### Which model

Assistant uses two roles: a **tool model** for answers that read or change the user's data, and a **chat model** for quick replies. If the user has not chosen models in Settings > AI, the app picks them from what is installed:

- Tool model: the largest installed model that supports tools, up to 14 billion parameters.
- Chat model: the smallest installed text model of at least 2.5 billion parameters that is smaller than the tool model. If there is none, it reuses the tool model.

On first run, the setup screen recommends a model by the computer's total memory (`server/ai/recommend.js`):

| Computer memory | Suggested model | Download size |
| --- | --- | --- |
| Under 6 GB | `llama3.2:1b` | about 1.3 GB |
| 6 GB to under 10 GB | `llama3.2:3b` | about 2.0 GB |
| 10 GB to under 14.5 GB | `llama3.2:3b`, plus optional `qwen2.5:7b` | about 2.0 GB, optional 4.7 GB |
| 14.5 GB or more | `qwen2.5:7b` for the user's data, plus `llama3.2:3b` for fast chat | about 4.7 GB and 2.0 GB |

Free memory also counts (phase 27, D16): on a computer in the last row with under 8 GB free right now, the setup card recommends `qwen2.5:3b` for the user's data instead of `qwen2.5:7b` and says why, and the automatic tools model is an installed `qwen2.5:3b` when it is smaller than the pick. With 8 GB or more free, or an unknown amount, `qwen2.5:7b` stays. `APP_AI_FREE_RAM_GB` pins the amount (tests do). A model chosen in Settings > AI or by `APP_AI_TOOL_MODEL` is never changed.

If no installed model supports tools, Settings > AI says so and suggests `qwen2.5:7b`. The recommendations are defaults you can change in `server/ai/recommend.js`. To find out which models are good enough on the hardware you target, run `npm run eval:ai` (see `pro/docs/EVALS.md` (pro, not in the public source)).

### The model download

The setup screen has a **Download model** button. It calls `POST /api/settings/ai/pull`, which asks the local Ollama to download the model from the Ollama library. It is the one documented exception to the network rules, because the app itself only talks to a loopback Ollama. It runs only on a user click, only for the models listed in `PULLABLE_MODELS`, and the user can cancel (Ollama resumes where it left off). Never add an automatic or background download.

### Slow hardware

On a computer without a graphics card, the first answer can take a minute or two while the model loads. Later answers are faster.

- The wait for the first token defaults to 300 seconds, and one call may take up to 5 minutes in total. A call that waits too long ends with a timeout error.
- Model calls run one at a time. A queue holds up to 8 more. A full queue answers `429 ai_busy`.
- Smaller models are quicker. The 1B and 3B Llama models in the table above exist for this reason.
- **Cloud hint.** If AI is working locally but the computer is small (the "under 6 GB" tier) or slow (the median first-token time over recent calls is above 60 seconds, or two calls timed out), Settings may quietly mention that a cloud provider is an option. It shows at most once every 14 days. It only suggests: nothing is turned on and nothing is sent.

The timeouts, queue size, context size and other limits are environment variables (`APP_AI_FIRST_TOKEN_TIMEOUT_MS`, `APP_AI_TOTAL_TIMEOUT_MIN`, `APP_AI_CONCURRENCY`, `APP_AI_QUEUE_MAX`, `OLLAMA_NUM_CTX`, `OLLAMA_KEEP_ALIVE` and more, listed in `.env.example`). They apply in browser mode (`npm start`). The desktop app starts its server with a minimal environment, so they do not reach an installed app. Models and hosts are chosen in Settings > AI instead.

### When Ollama is not there

If the model cannot run, AI routes answer `503` with `error: 'ai_not_configured'` (no model installed, or AI turned off) or `error: 'ollama_unavailable'` (Ollama did not answer), a `reason` the UI uses, and a fixed message. The UI shows the matching step: **Get Ollama** (opens https://ollama.com/download), **Check again**, or "Ollama is installed but not running. Open the Ollama app, then Check again." The server never echoes provider error text to the client.

`APP_AI=0` turns every AI route off (browser mode).

## Bring your own cloud provider (optional)

Assistant can use any provider that speaks the OpenAI Chat Completions API. The server sends requests to `<base URL>/chat/completions`. It is off by default and the app never uses it unless the user turns it on.

What the user sets in Settings > AI:

- **Base URL.** A public `https://` address, optionally with a path, no credentials, no query string. Local names (`localhost`, `.local`, `.lan`, `.internal`, single-label names) and private, loopback or link-local IP addresses are refused when saved, and again when connecting (a name that resolves to a private address is refused, which blocks DNS tricks). Redirects are refused.
- **Model name** and the token parameter the provider expects (`max_tokens` or `max_completion_tokens`).
- **API key.** Saved encrypted on the computer (see `server/secrets/`), sent only to the provider's host, and never included in exports.

### Two gates, both on the server

1. **Network opt-in.** The `cloudAi` feature in `server/netPolicy.js` must be on.
2. **Explicit consent.** Cloud AI only turns on through one dialog (`POST /api/settings/ai/cloud/enable`). It lists what leaves the computer (what the user asks, the recent conversation, data from the kinds they allow, their display name if set) and what stays (the other kinds, the API key). The user must tick two boxes: that their data goes to that provider and the provider's privacy policy applies, and that they pay the provider directly. Ticking both turns on `cloudAi` and records the consent.

Consent is stored with the host, the exact normalized base URL and the consent text version. If the base URL changes (a different host, or the same host with another path), or the consent text changes, the old consent no longer counts, cloud AI goes back to off, and the key, model and address are kept. Setting the provider to cloud without a current consent answers `409 cloud_consent_required`. If the cloud setup is broken, Assistant falls back to local, never the other way around.

The consent dialog is the only place cloud AI can be switched on. The generic state route and the importer refuse every `ai.cloud*` key, so an imported file cannot flip it.

### Per-category data control

The user also chooses which kinds of data a cloud provider may see. In Studio the one category is `features` (the names, descriptions and settings of your saved features; shared by default), declared by the Studio module descriptor (`server/modules/studio.data.js`) and mirrored in `src/constants/cloudAi.js`. A module you add contributes its own categories the same way.

This is enforced in the server, not in the UI:

- Every model call passes a `scope` (the categories it uses). `enforceCloudScope()` is the single choke point for cloud calls. If the scope is missing or names a category the user withheld, it throws before anything is sent.
- Every page and every Assistant tool maps to a category, or to a list when its data spans several (a tool whose result carries two kinds of data maps to both, for example `['alpha', 'beta']`). Under cloud a list is allowed only when every category in it is shared; otherwise the tool returns a "not shared" placeholder naming the withheld ones and never runs, and the page's advice makes no model call, and the Assistant drops the page hint. A page or tool with no mapping, or an empty or unknown list, is refused under cloud.
- Earlier turns that used withheld data are dropped from the history sent to the cloud, and only the user's own earlier messages are kept. Today's callers send only user messages from earlier turns (`cloudHistoryUserRows` and `applyPagePolicy`), which do check them.
- Local Ollama (and an `aiLan` host) is trusted: all categories work.
- In a built app each spec table is its own category. For a table the user withheld, its rows never reach a cloud model, but the app's table labels, field labels and select options still do: the generic Assistant tools' `table` enum and `describe_data` carry the schema so the model can name a table at all. Do not put anything you consider private in a table or field label or a select option.

Add a category for each kind of data in your own modules that a user might want to keep local (see [ADDING_A_MODULE.md](ADDING_A_MODULE.md)).

#### Per-field categories (not built)

Design, if a tool ever needs to return fields of different categories in one result:

- A separate `TOOL_FIELD_CATEGORIES = { tool: { topLevelKey: categoryId } }` map, so `TOOL_CATEGORIES` keeps its shape.
- `toolDecision` allows the tool when its base list is consented. Denied field categories go in `withheld` and allowed ones in `categories`.
- `enforceCloudScope` parses the tool row, deletes the denied top-level keys and adds `not_shared_fields: [...]`. An unparseable row becomes the generic placeholder.
- `callWithheld` and `flushTurn` treat a denied field category as withheld (fail closed). The agent loop does not change.

Why it is not built: no kit tool needs it (row data is nested in arrays), the kit splits data into separate tools instead, and the fail closed history taint would drop cloud history after every such call under the default consent. Until then, split the tool or map it to a list.

### What is logged

Each model call writes an audit row: the feature, page, provider, model, status, and for cloud calls the host and the category names that were shared or withheld. Free-text context is redacted for known key, token and password patterns and size-capped. Settings > Privacy & activity shows the audit log and a network activity list (feature, host and result only).

## AI summarizes, code calculates

The rule the kit is built around: **every number is computed in code and handed to the model as a finished result. The model only words it.** Never ask a model to do math.

- `listFeatureSummaries()` in `server/studio/features/store.js` counts in code how many apps use each feature; the `list_features` tool returns that result, and the Assistant system prompt tells the model to quote tool numbers and never add, count or compare numbers itself.
- When the helper builds a page from your prompt, at most 6 features and their 100-character descriptions go into the model prompt; the model never counts anything.
- Keep a test that shows the model was not asked to calculate, whenever you add a feature that shows numbers.
- Where the helper places parts (phase 22): the model may give a part on a free Grid a cell (`col`, `span`, `row`, `rowSpan`), but never `rows`; code sets the Grid to 12 columns and `rows` to the last row used, fixes every block the model got wrong (a cell past the edge is clipped, one that overlaps another or has no cell moves to the next free 3 by 1 spot, a cell outside a free Grid is dropped) and logs the count of each fix as `describe.grid_repairs` (unchanged). The `describe.total` line holds `calls`, `rounds`, `steps`, `fallbacks`, `skipped` (why each step was not asked, phase 27), `repairs` (the code repairs of the model's blocks, counted per kind in `describe.code_repairs`) and `grid` (the grid fix count). An ask keeps placement: for an edit the pipeline matches the new parts to the old ones by kind, source and label, and every part the ask does not name as moved keeps its cell and its id; a part the ask names ("move the chart to the bottom") takes the model's cell when it is free, a new part gets the model's cell or the next free one, a free Grid the model hands back as flow stays free unless the ask says stack, and "stack these instead" makes it flow. A page that holds a free Grid is asked again, with its current layout in the prompt, only when the ask has a place clause or adds a part; a page over the layout size cap is left as it is. The merge (`pro/server/studio/describe/placement.js`) runs before the repairs (`gridRepair.js`). Known limit (tracked, low): the Current layout line writes a feature block as its expanded parts with no feature marker, so a relaid-out page that holds a feature block comes back as loose parts, because the model schema is byte capped and cannot carry the marker.

## Approval flow for actions

Assistant can read data with tools freely, but it can only change data after the user clicks Approve.

1. The model asks to run a write tool (Studio ships none; a built app's runtime has `save_record`).
2. `precheckWrite()` validates the arguments with the same rules as the normal API, so the user is never asked to approve something that cannot work.
3. The server parks the call behind a single-use 128-bit token and streams a `confirm.required` event. The UI shows a card with a one-line description (`describeWrite()`), with Approve and Decline.
4. The user's click calls `POST /api/assistant/actions/:token` with `{ approve: true | false }`. Only an approval runs the tool.

The token is held in memory, expires after 10 minutes, and is bound to the conversation it came from. A stale or wrong token answers `404 action_not_found`. Writes per request are capped (`ASSISTANT_WRITE_CAP`, default 3), and a capped approval answers `409 write_cap_reached`. Confirmation is on by default (`ASSISTANT_CONFIRM_WRITES`). Never run a write tool straight from the model loop, and never turn the default off in a shipped build.

The Assistant tool loop has its own limits in `.env.example` (`ASSISTANT_MAX_ROUNDS`, `ASSISTANT_TOOL_TIMEOUT_MS` and more). Model output is passed through a stream sanitizer before it reaches the UI.

## Building without the cloud provider

A build can leave the cloud provider out completely. Build with `APP_CLOUD_AI=off` (unset or `on` is the default build; any other value fails the build) for both the web UI (`npm run build`) and the sidecar (`node scripts/desktop/buildSidecar.js --cloud-ai off`, or the same variable). `npm run desktop:build` passes the variable to both.

What changes, through two seams in `scripts/desktop/cloudBuild.js`:

- **Server.** `server/ai/providers/openaiCompat.js` (in a pro build the twin `pro/server/ai/providers/openaiCompat.js`) is swapped for `openaiCompat.disabled.js`, so the transport and `pro/server/ai/llmClient.js` never enter the sidecar bundle. The bundle gets `__APP_CLOUD_AI__` from `server/buildFeatures.js`, so the shell environment cannot switch a built sidecar. A source checkout reads `APP_CLOUD_AI` at run time (unset or `on` is on, anything else is off).
- **Web UI.** `src/components/settings/cloudUi.js` (in a pro build the twin `pro/src/components/settings/cloudUi.js`) is swapped for `cloudUi.disabled.js`, so the cloud settings screens, the consent dialog and the category list never enter the UI bundle. Settings > AI shows the local path only, Settings > Network shows "Not in this build" for the cloud feature, and Verify yourself says "This build contains no cloud provider."

What the server answers in such a build:

- `GET /api/app/info` has `cloudAi: 'absent'` (`'present'` otherwise), and `GET /api/settings/ai` has `cloud.build: 'absent'` with the provider reported as `ollama`.
- `GET /api/settings/network` lists the cloud feature with `available: false` and `enabled: false`, whatever is stored or set in `APP_NETWORK_OPTIN`.
- Every cloud write answers `403 { error: 'feature_unavailable', code: 'feature_unavailable', feature: 'cloudAi', message: 'This build contains no cloud provider.' }`: `PUT /api/settings/ai/cloud`, `PUT /api/settings/ai/cloud-categories`, `POST /api/settings/ai/cloud/enable`, `POST /api/settings/ai/cloud-hint`, `PUT /api/settings/ai/provider` with `openai_compat`, and `PUT /api/settings/network` turning the cloud feature on. The refusal comes before body validation. Turning it off, `POST /api/settings/ai/cloud/disable` and `PUT /api/settings/ai/provider` with `ollama` still work.
- Leftover cloud settings from an earlier build that had the provider (the stored opt-in, provider choice and consent record) are ignored and never deleted on their own; the turn-off routes (`POST /api/settings/ai/cloud/disable`, `PUT /api/settings/network` with `cloudAi: false`) still reset the opt-in, the provider and the consent, and may write an audit row. A saved cloud key is never read or deleted. The `AI_CLOUD_API_KEY` secret answers `404 unknown_secret` on every `/api/secrets` route and is not listed.

Where `APP_CLOUD_AI` is read: the UI build (`npm run build`, `npm run dev`) and the sidecar build read it from the shell environment only, not from `.env`. An unbundled `npm start` server reads `process.env` at run time, and `loadEnv.js` copies `.env` into `process.env` first, so there `.env` or the shell both work (desktop mode skips `.env`). `npm run desktop:dev` cannot simulate an off server, because the shell starts the server with a cleared environment. To try an off server locally, run `APP_CLOUD_AI=off` with `npm start` and a temporary `APP_DATA_DIR`.

Still working: the Ollama on another machine opt-in (`aiLan`), the audit log, the network activity log, and the model download the user starts with a click.

Prove it before you publish: `npm run check:cloud-marker -- --require-absent` scans the sidecar bundle, the executables and the built UI for the markers `cloud-provider-marker:openai-compat:v1` (the transport), the OpenAI-compatible wire path and `cloud-ui-marker:v1` (the cloud block). CI builds both ways on every pull request (`sidecar budget` and `cloud-off build` steps). Never import the provider or the cloud UI around the seams: the cloud-off build fails if anything does.

## Error contracts

| Situation | Response |
| --- | --- |
| Model cannot run | `503 { error: 'ai_not_configured' or 'ollama_unavailable', reason, message }` |
| Queue full or wait timed out | `429 { error: 'ai_busy' }` |
| A gated network feature is off | `403 { error: 'network_opt_in_required', feature, message }` |
| Cloud provider chosen without consent | `409 cloud_consent_required` |
| Another run in the same conversation | `409 conversation_busy` |
| Pro feature without Pro | `403 { error: 'pro_required', feature, message }` |
| Cloud call on a build with no cloud provider | `403 { error: 'feature_unavailable', code: 'feature_unavailable', feature: 'cloudAi', message }` |

These are sent before any streaming starts.
