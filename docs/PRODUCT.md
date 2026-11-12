# Product principles

These are the principles the kit is built on. They are rules the code already follows and the tests defend, so keep them when you turn the example module into your own product. Change one on purpose, in writing, never by accident.

## 1. Local-first

- The app runs on the user's computer. Data lives in one SQLite file in the user's data folder, in open formats (SQLite, JSON, CSV, Markdown). No account, no telemetry.
- The model runs on the user's computer too (Ollama on loopback). Nothing is sent anywhere unless the user opts in.
- First run just works: a new user can open the app with no setup, no network and no model, and see friendly empty states instead of an error.

## 2. Never paywall the user's own data

Export, import, backups, restore and privacy controls are always free. A license can unlock a capability (the kit ships none; `example_pro` is a placeholder), never access to what the user already stored. No license state blocks a data read, an export or a restore.

## 3. AI summarizes, code calculates

Every number is computed in code (SQL or JavaScript) and handed to the model as a finished result. The model only words what it was given. Never ask a model to do math, and keep a test that shows the model was not asked to. See `listFeatureSummaries` in `server/studio/features/store.js` and `list_features` in `server/modules/studio.tools.js` for the pattern.

## 4. Data must never be lost

- A migration takes a `.bak` copy of the database first, and a failed migration rolls back and leaves the live file untouched.
- Shipped migrations are immutable. A schema change is a new numbered file.
- Automatic daily local backups, with one-click restore. The user can switch automatic backups off, and the app reminds them.
- Export gives the user a ZIP (JSON, CSV and Markdown) they can read without the app.

## 5. The network is opt-in per feature, and logged

- Every outbound call belongs to a named feature in `server/netPolicy.js` that is off by default: `cloudAi`, `aiLan`, `updates` and `license`.
- A gated-off feature answers `403 network_opt_in_required` and sends nothing.
- The user can see every outbound call in Settings (network activity log: the feature, the host and the result, nothing else) and every model call in the audit log. The audit log stores redacted, size-capped text (known key, token and password formats are removed), keeps at most 90 days and 5000 rows, and for a cloud call records the host and the names of the data categories that were shared or withheld.
- The one documented exception is the user-clicked model download, which only talks to a loopback Ollama.

## Using this when you build

Before you plan a change, check it against the five principles above. If a feature needs an account, a hosted service, a new outbound host or a paywalled data path, stop and decide that deliberately. The agent instructions in [CLAUDE.md](../CLAUDE.md) and the checklist in [CONTRIBUTING.md](../CONTRIBUTING.md) repeat these rules in the form code reviewers use.
