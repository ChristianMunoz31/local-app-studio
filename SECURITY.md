# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub private vulnerability reporting: on the repository page, open the Security tab and choose "Report a vulnerability". That opens a private thread with the maintainer.

Include what you did, what you expected, what happened, the version, and whether it needs a particular setting or an Ollama model. Do not include your own data. A synthetic example is better.

## Supported versions

Only the latest release is supported. A fix goes into the next release, not into older ones.

## In scope

- The local server (`server.js` and `server/`): the host guard, the per-launch secret in desktop mode, rate limits, the error envelope, logging.
- The AI boundary (`server/ai/` and the Assistant): anything that lets model output reach a file path, a command, a network host, a setting or a database write, or lets a write skip the confirmation step. See [docs/AI_BOUNDARY.md](docs/AI_BOUNDARY.md).
- The data folder: `app.db`, backups and restore, saved API keys (`secrets.key`), the audit log, and the folder's permissions.
- The desktop shell (`src-tauri/`): what the window may load, the sidecar handshake, the content security policy.
- Export and import: the ZIP writer and reader, the document parser (it runs in a child process with no environment and no data folder access).
- The runtime of built apps (`packages/runtime/` and the server routes that ship inside every built app).

## Out of scope

- What a model says. A wrong, odd or rude answer is not a vulnerability. A model's words reaching something they should not reach is: report that.
- A third-party Ollama install, its models, and its own network exposure.
- Attacks that need the attacker to already control the user's PC or user account, or to change files in the data folder by hand.
- Unsigned installers showing a Windows SmartScreen warning. This is known.
- macOS and Linux. Only Windows is tested.

## The local-only network posture

This is what the code is built to guarantee, so a report that shows otherwise is a security bug.

- No telemetry and no accounts. There is no outbound call without a named feature in `server/netPolicy.js`. The features are `cloudAi`, `aiLan`, `updates` and `license`, each off by default. A feature that is switched off answers `403` with `network_opt_in_required` and sends nothing.
- Model calls go to a loopback Ollama (`127.0.0.1:11434` by default). A non-loopback Ollama needs the `aiLan` opt-in. Only fixed Ollama paths are ever requested, with redirects refused.
- The one documented exception is the model download. It runs only when the user clicks it and only talks to a loopback Ollama.
- The public build contains no cloud provider and no store licensing code, so nothing in that build calls a cloud model or a license store. The `cloudAi` feature answers `403 feature_unavailable` there.
- Desktop mode binds to loopback only, uses a per-launch secret handshake, refuses an unexpected Host header (`421`) and sets a strict CSP. `APP_PASSWORD` and `AUTH_SECRET` are ignored in desktop mode.
- Assistant writes wait for the user's approval (a single-use token). Confirmation is always on in desktop mode.
- Model output goes through a stream sanitizer, provider error text is never sent to the client, and logs keep only short redacted scalar fields, never secrets or request bodies.
- Reading and writing the database goes through allowlisted table and column names. No SQL is built from request input.

## What to expect

The maintainer will confirm a report as soon as practical, say whether it is in scope, and tell you when a fix is released. Please keep the details private until then.
