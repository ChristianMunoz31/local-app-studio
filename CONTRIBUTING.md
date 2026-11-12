# Contributing

Thanks for helping. Read [docs/PRODUCT.md](docs/PRODUCT.md) first: it holds the principles the code and tests defend. If a change conflicts with it, raise that in the issue before writing code. Other guides: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ADDING_A_MODULE.md](docs/ADDING_A_MODULE.md), [docs/AI.md](docs/AI.md), [docs/LESSONS.md](docs/LESSONS.md) and [docs/FAQ.md](docs/FAQ.md). Agents should also read [CLAUDE.md](CLAUDE.md).

Contributors work in this public repository. The maintainer carries accepted changes into the private home of the code by hand, so a merged pull request here is not a push from you to anywhere else.

Contributions require signing the Contributor License Agreement: <CLA_LINK>

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems as described in [SECURITY.md](SECURITY.md), not in an issue.

## Some things are not in this repository

The pro half of the code (the helper pipeline, Make installer, licensing for built apps, the cloud provider and the release automation) is not here. A public checkout builds with the public stubs, so those parts are off ([README.md](README.md), "What the public build does not include"). Commands that need it, such as `npm run desktop:build`, `npm run eval:ai`, `npm run template:package` and `npm run check:store-config`, print that the tool is not in this build. You do not need them to contribute. Do not add code that imports from `pro/`.

## Setup

Requires Node 24 or newer (the server uses the built-in `node:sqlite`). Only Windows is tested.

```powershell
npm ci
npm start      # API on http://127.0.0.1:4321
npm run dev    # Vite UI on http://localhost:5174 (second terminal; proxies /api to the API)
```

`npm ci` also runs the `prepare` script, which installs the git pre-commit hook (see "Checks and the pre-commit hook"). Configuration is in `.env` (copy `.env.example`). `npm run build` followed by `npm start` serves `dist/` as one process.

## Before you open a pull request

```powershell
npm run gate           # the CI verify job locally, one step at a time, with a summary table (on a PC with little free memory a flaky e2e can fail it: rerun, or use npm run gate -- --quick)
npm test               # Vitest, no Ollama needed
npm run lint
npm run check:public   # builds the public half and proves no pro code is in it
```

`npm run gate -- --quick` runs only the cheap steps on what changed. Tests are required: a change to source in `src/` or `server/` needs a test that fails without it. Do not weaken or delete a test to make a change pass.

## Branches and commits

- Branch prefixes: `feat/`, `fix/`, `chore/`, `docs/`.
- Conventional commits with a scope: `feat(features): add category filter`. The pull request title follows the same format.
- Explain the root cause before fixing a bug. Do not add features beyond the task.
- No em dashes anywhere, in code, copy, docs, commit messages or pull request text. `npm run check:em-dash` checks user-facing source.

## Product rules checklist

Every change must respect these (the pull request template repeats them). Details are in [docs/PRODUCT.md](docs/PRODUCT.md).

- [ ] AI summarizes, code calculates: numbers are computed in SQL or JS and only results go to the model, with a test proving the model is not asked to do math.
- [ ] No outbound call without a `server/netPolicy.js` feature that is off by default. The one exception is the user-clicked model download (`POST /api/settings/ai/pull`), which only talks to a loopback Ollama. Never add an automatic or background pull.
- [ ] All model calls go through `server/ai/index.js`. No provider imports outside `server/ai/`.
- [ ] No personal data in the repo, fixtures, prompts or tests. Fixtures are synthetic.
- [ ] A schema change is a new migration (never an edit to a shipped one) and the migration safety test passes.
- [ ] Export, import, backups and privacy controls are never gated or weakened.
- [ ] No em dashes in copy.

## Errors and their words

Every error body is the one envelope built by `server/errors.js` (`sendError`, `sendErrorFrom`, `limiterHandler`, `sseError`). Never write `res.status(4xx|5xx).json(` in a route: `server/__tests__/errorEnvelopeBypass.test.js` fails on it. A new error code needs two rows, and both are tests:

- the sentence and the next action in `src/errors/copy.core.js` (or `src/errors/copy.studio.js` for Studio only);
- a row in the "Error codes" table in [docs/DESIGN.md](docs/DESIGN.md).

## Development workflow

### Sandbox

Run a throwaway app with demo data, without touching your real data or your dev servers:

```powershell
npm run sandbox                       # fresh demo data, free port, Ctrl+C to stop
npm run sandbox -- --keep             # reuse the sandbox data folder between runs
npm run sandbox -- --port 4400        # choose the port
npm run sandbox -- --name checkout    # separate data folder per name
npm run sandbox -- --reset            # remove all sandbox data (same as npm run sandbox:reset)
```

The sandbox data folder is always under the OS temp folder, the port is never 4321 or 5174, and no network opt-ins are on. Demo data comes from `scripts/seedDemo.js` (fictional and deterministic).

### Tests

`npm test` runs Vitest with three projects: `frontend` (jsdom: `src` `.jsx` and `.tsx` tests plus the `.js` and `.ts` ones listed in `SRC_DOM_TESTS`), `pure` (node: the other `src` `.js` and `.ts` tests, no DOM) and `backend` (node, `server/__tests__/`). Use `npm run test:watch` while developing and `npx vitest run --project backend` to run one project. `npm run test:e2e` runs Playwright (needs `dist/` from `npm run build`; run `npx playwright install chromium` once first). The `visual` project is skipped on Windows because its baselines are Linux only.

- Backend tests use the real temp SQLite helper `server/__tests__/helpers/testDb.js`, not DB mocks.
- Never depend on a real Ollama. Use `server/__tests__/helpers/fakeOllama.js`.
- The network guard (`server/__tests__/setup/networkGuard.js`) blocks every non-loopback connection and any loopback connection to ports 11434, 4321 and 5174. A blocked call fails with `ENETBLOCKED`. Mock `fetch`.

### Migrations

Migrations are forward-only SQL files in `server/db/migrations/` named `NNN_name.sql`. Never edit a shipped migration: add a new numbered file. `server/db/migrations.lock.json` records a SHA-256 of every shipped migration (content with `\r\n` normalized to `\n`), and `server/__tests__/migrationSafety.test.js` fails if a migration is missing from the lock or a locked file changed. To add one:

1. Create `server/db/migrations/NNN_your_change.sql` (next number).
2. Compute its hash and add one line to `migrations.lock.json`, keeping the list in order:

   ```powershell
   node -e "const c=require('crypto'),fs=require('fs');console.log(c.createHash('sha256').update(fs.readFileSync('server/db/migrations/NNN_your_change.sql','utf8').replace(/\r\n/g,'\n')).digest('hex'))"
   ```

3. Add a new table to `server/db/tables.js` and, parents first, to `IMPORT_ORDER` if it should be exported and imported. Run `npm test`.

### Checks and the pre-commit hook

```powershell
npm run check:em-dash    # no em dashes in user-facing JSX (comments and tests are ignored)
npm run check:personal   # emails, phones, card numbers, home paths, public IPs
npm run check:keys       # no PEM private keys in tracked or staged text files
npm run check:bundle     # gzip size of dist/ against scripts/checks/bundle-budget.json (run npm run build first)
```

`npm ci` runs `scripts/installHooks.js`, which sets the repo-local `core.hooksPath` to `.githooks` (it does nothing outside a git checkout and never changes global config). The hook runs ESLint on staged `.js` and `.jsx` files, then the em dash and personal-data checks on staged content. Bypass it only in an emergency with `git commit --no-verify`. Intentional exceptions to the personal-data check go in `scripts/checks/personal-data.allow.json`.

### Desktop app

The desktop app is a Tauri v2 shell in `src-tauri/` around the same server and UI. Prerequisites are in [README.md](README.md). The process model is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the shell protocol in [src-tauri/README.md](src-tauri/README.md).

```powershell
npm run desktop:dev       # builds dist/ if missing, then runs the shell with `node server.js`
npm run desktop:sidecar   # only the sidecar and src-tauri/resources/ (needs dist/ first)
```

`desktop:dev` always uses a fresh temp data folder through `APP_DESKTOP_DATA_DIR`, so it never touches real data. Set that variable per shell only. Rust tests: `cd src-tauri; cargo test`, after `npm run build` and `npm run desktop:sidecar`.
