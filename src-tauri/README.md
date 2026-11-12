# Local App Studio desktop shell (Tauri v2)

A thin native shell. It starts the Local App Studio server as a sidecar, shows a local splash page while it boots, then points the window at `http://127.0.0.1:<port>`. All product code stays in `server/` and `src/`. The big picture and the threat model are in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md), the Dev build is in [docs/DEV_CHANNEL.md](../docs/DEV_CHANNEL.md), and end-user install steps are in [docs/INSTALL.md](../docs/INSTALL.md).

**Platform status:** only Windows is tested. The macOS and Linux paths and build notes below describe what the code does, but those builds are untested.

## Layout

- `src/` Rust: `lib.rs` (app wiring, window, supervision, single-instance and window-state plugins), `sidecar.rs` (env, spawn, ready line, Job Object, shutdown), `secret.rs` (secret and HMAC bootstrap token), `nav.rs` (navigation policy), `downloads.rs` (where exports are saved), `menu.rs` (File, Edit, Help), `exit_dialog.rs` (exit-code dialog copy).
- `splash/` the only frontend bundled in the shell: `index.html` ("Starting Local App Studio...") and `error.html` (shows the log path).
- `capabilities/default.json` empty permissions, `local: true`, no `remote` entry: the server UI gets no IPC.
- `installer/hooks.nsh` NSIS hooks: tells the user the data in `%APPDATA%\Local App Studio` is kept on update and uninstall.
- `installer/hooks.dev.nsh` the Local App Studio Dev version: refuses an install folder that belongs to Local App Studio or holds Local App Studio data, and names `%APPDATA%\Local App Studio Dev`.
- `tauri.dev.conf.json` the Local App Studio Dev overlay (see below). `tauri.dev.build.json` is generated from it for each Dev build and gitignored.
- `icons/` generated from `icons/source.svg`; `icons/dev/` is the same artwork with a DEV badge.
- `binaries/` and `resources/` are build output (gitignored), produced by `npm run desktop:sidecar`.

## Commands (repo root)

```powershell
npm run desktop:sidecar   # esbuild + Node SEA -> src-tauri/binaries/local-app-studio-server-<triple>[.exe], plus resources/dist and resources/migrations
npm run desktop:dev       # tauri dev, runs `node server.js`, temp data dir
npm run desktop:build     # npm run build -> sidecar -> tauri build (NSIS in src-tauri/target/release/bundle/nsis/)
npm run desktop:icons     # tauri icon src-tauri/icons/source.svg
```

`cargo test` and `cargo clippy` (run in `src-tauri`) need the sidecar and `resources/` to exist, because `tauri-build` checks for them even for `cargo check`. Run `npm run build` and `npm run desktop:sidecar` first. CI (`desktop-check.yml`) uses empty stand-ins instead.

### Sidecar build flags

`node scripts/desktop/buildSidecar.js [flags]` (`npm run desktop:sidecar` passes `--minify`):

- `--minify` minify the esbuild bundle.
- `--bundle-only` stop after the esbuild bundle (`.sidecar-build/server.cjs`); no SEA, no copy.
- `--no-copy` build the SEA exe in `.sidecar-build/` but do not copy anything into `src-tauri/`.
- `--target <triple>` must equal the host triple, otherwise it fails with an explanation.
- `--node-binary <path>` inject the SEA blob into another `node` binary instead of the running one. CI uses this for the macOS x64 half of a universal build.
- `--out-triple <name>` name the copied file `local-app-studio-server-<name>` instead of using the host triple (for example `x86_64-apple-darwin`).
- `--channel <stable|dev>` (default: env `APP_CHANNEL`, else stable). A dev build is copied as `local-app-studio-dev-server-<triple>[.exe]` and needs `--display-version`. Every copied executable is scanned for its `/*! APP_CHANNEL=<channel> */` marker before the script ends.

`desktop:build` and the sidecar only support the host target triple: the sidecar embeds a local `node` binary. For another target, build natively on that platform. `release.yml` runs one runner per OS. Passing `-- --target <other>` to `desktop:build` fails with an explanation.

### Local App Studio Dev

`tauri.dev.conf.json` is a config overlay for the side-by-side test build (`npm run desktop:build:dev`, which merges it with the Dev bundle version into `tauri.dev.build.json` and runs `tauri build --config`). It changes `productName` (`Local App Studio Dev`), `mainBinaryName` (`AppDev`), `identifier` (`com.neuralfoundry.localappstudio.dev`), the icons (`icons/dev/*`) and the NSIS hooks (`installer/hooks.dev.nsh`). `tauri.conf.json` stays the stable config, so `cargo` builds, `desktop-check.yml` and `desktop:build` are stable.

- **Channel.** The shell reads its channel at runtime from `app.config().identifier` (`src/channel.rs`): `com.neuralfoundry.localappstudio.dev` is Dev, anything else is stable. Dev changes the window title and Help > About (`Local App Studio Dev`, with the display version from `APP_DISPLAY_VERSION` at build time via `option_env!`; stable always shows the package version) and the default data folder name (`Local App Studio Dev` on Windows and macOS, `local-app-studio-dev` on Linux). The server's channel comes from the bundle, not from the shell.
- **Separate state.** The identifier gives Dev its own single-instance lock, WebView2 profile, window-state file and log folder, so Local App Studio and Local App Studio Dev run at the same time without sharing anything.
- **Log paths (Dev).** `server.log` is in `%LOCALAPPDATA%\com.neuralfoundry.localappstudio.dev\logs` (Windows), `~/Library/Logs/com.neuralfoundry.localappstudio.dev` (macOS) or `~/.local/share/com.neuralfoundry.localappstudio.dev/logs` (Linux).
- **Sidecar binary.** Dev launches `local-app-studio-dev-server` (overlay `externalBin`), stable launches `local-app-studio-server`, so both can install into one folder (Linux packages) without sharing a file. `resolve_launch` picks the name from the channel.
- **Isolation checks.** `build_sidecar_env` always sets `APP_SHELL_CHANNEL` (`stable` or `dev`) and the server refuses to start on a mismatch. The ready line must carry the same `channel` (a missing or different one stops the server and shows the error page). The Dev shell also refuses a `APP_DESKTOP_DATA_DIR` (or reported data folder) that equals, contains or lies inside the default stable data folder or `APP_DESKTOP_STABLE_DATA_DIR`, compared by real location, before it starts the server.
- **Installer guard.** `installer/hooks.dev.nsh` normalizes the install folder (full path, no trailing backslash) and refuses a folder that equals, lies inside or contains `%APPDATA%\Local App Studio`, `%LOCALAPPDATA%\Local App Studio`, `%APPDATA%\Local App Studio Dev` or the install folder Local App Studio recorded (`HKCU\Software\Local App Studio\Local App Studio` and the `InstallLocation` of `Uninstall\Local App Studio`).
- **Copy source override.** In the Dev shell only, a non-empty `APP_DESKTOP_STABLE_DATA_DIR` is passed to the sidecar as `APP_STABLE_DATA_DIR` (and a line is logged). The stable shell never forwards it, and a raw `APP_STABLE_DATA_DIR` in the user's shell is always dropped. Set it per shell only, to a throwaway folder, when testing "Copy my data from Local App Studio".
- **Icons.** `npm run desktop:icons` regenerates `icons/*` from `icons/source.svg` and `icons/dev/*` from a generated `icons/dev/source.svg` (the same artwork plus a DEV badge drawn with shapes, no text). Both folders keep only the icon files the bundle uses.

Always run the app with `APP_DESKTOP_DATA_DIR` pointing at a temp dir while developing (`desktop:dev` does this). Without it the server uses the real Local App Studio data folder. Set it per shell only, never as a persistent user variable: release builds honour it too (so an installed build can be tested safely) and log a line to `server.log` when it is active. The Tauri identifier is `com.neuralfoundry.localappstudio` on purpose so the Tauri app-data folder never coincides with the Local App Studio data folder.

## Sidecar protocol

1. The shell runs `local-app-studio-server` (next to the app executable) with an empty environment plus only: `SystemRoot`, `TEMP`, `TMP`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `HOME`, `XDG_DATA_HOME` (each if set), `PATH` (`%SystemRoot%\System32` on Windows, `/usr/bin:/bin` elsewhere; never the developer's `PATH`), `APP_DESKTOP=1`, `APP_HOST=127.0.0.1`, `APP_PORT=0`, `APP_NO_DOTENV=1`, `APP_SHELL_CHANNEL`, `APP_DIST_DIR`, `APP_MIGRATIONS_DIR`, and `APP_DATA_DIR` only when the shell itself has `APP_DESKTOP_DATA_DIR`.
2. It writes 32 random bytes as 64 lowercase hex plus a newline to the child's stdin and keeps stdin open. Closing stdin (app exit) is the graceful shutdown signal; the shell waits 5 s, then kills. On Windows the child is also in a Job Object with kill-on-close, so a crash of the app never leaves a server behind.
3. The child prints `APP_READY {"port":N,"dataDir":"...","version":"...","channel":"stable|dev"}`; the shell refuses a line whose channel is not its own. The shell waits up to 60 s, then navigates to `http://127.0.0.1:N/desktop/bootstrap?token=<hex(HMAC-SHA256(secret, "desktop-bootstrap-v1"))>`; the server sets an HttpOnly cookie and redirects to `/`. If the child exits or the wait times out, the window shows `splash/error.html`. If the server stops later, the window also shows the error page.
   - **Exit codes.** The shell captures the exit code and the last 40 stderr lines and shows a native dialog (`exit_dialog.rs`, `tauri-plugin-dialog`; the dialog is opened from Rust, so no IPC permission is granted). Exit code `3` (`EXIT_RESTORE_RECOVERY`, startup recovery of an interrupted backup restore failed) shows "Local App Studio could not finish restoring" naming the folders parsed from the server's message (fallback: `<data dir>/restore-aside` and `<data dir>/backups`) with the buttons Open data folder, Copy details (full server message plus the log path, via `tauri-plugin-clipboard-manager`) and Quit. Open and Copy re-show the dialog; Quit or closing it exits the app. Any other exit (before ready or later) shows "Local App Studio stopped unexpectedly" with the exit code, the log path and Open log folder / Quit (the server's stderr is not copied into these details; it is in the log). No dialog is shown when the app is already quitting (a Quit during the splash, window close, logoff or shutdown), when the server ends with code 0, or with Windows status `0xC000013A` (`STATUS_CONTROL_C_EXIT`, a session end); the shell then only logs a `[shell]` line (and shows the error page unless it is quitting). Open data folder tries the folder parsed from the server's message, then the shell's own data folder, then the log folder (each must be an absolute, non-UNC, existing directory; falling back is logged). The parsed message is only trusted when it is the final message in the stderr tail, the aside file sits in `restore-aside` under the data folder, and the data folder equals the shell's own when it is known. The shell never deletes or moves a file. To see the code 3 dialog safely, point `APP_DESKTOP_DATA_DIR` (this shell only, a temp dir) at a folder holding only a `restore-journal.json` (for example `{"phase":"swapping","safetyId":"x"}`) and run the debug exe from `src-tauri/target/debug` with `APP_DEV_NODE` and `APP_DEV_ENTRY` set; the server finds neither the old nor the new database and exits 3.
4. stdout and stderr are written to `server.log` in the app log dir, truncated at each launch:
   - Windows: `%LOCALAPPDATA%\com.neuralfoundry.localappstudio\logs\server.log`
   - macOS: `~/Library/Logs/com.neuralfoundry.localappstudio/server.log`
   - Linux: `~/.local/share/com.neuralfoundry.localappstudio/logs/server.log`

Debug builds only: with `APP_DEV_NODE` and `APP_DEV_ENTRY` set, the shell runs `node server.js` from the repo instead of the sidecar (`npm run desktop:dev` sets both).

## Security model

- **No IPC for the server UI.** The window loads remote (loopback) content. The capability file has no `remote` entry, so that page cannot call Tauri commands. The shell's own CSP only covers the splash pages.
- **Per-launch gate.** The server (`server/desktop/auth.js`) refuses every request without the `app_desktop` cookie. The cookie is only issued for one use of the bootstrap token, which is derived from a secret that exists only in the shell and the server process (passed over stdin, never over HTTP, never logged). Another local program that finds the port gets `401`. `APP_PASSWORD` and `AUTH_SECRET` are ignored in desktop mode.
- **Server hardening.** Loopback bind only, a CSP plus `X-Frame-Options`, `Referrer-Policy` and `nosniff` on every response (`server/desktop/csp.js`), cross-site and foreign-origin writes refused.
- **Minimal environment.** The sidecar only sees the allowlist above, so `NODE_OPTIONS`, `OLLAMA_HOST`, tokens and `APP_DATA_DIR` from the user's shell are dropped.
- **Navigation policy** (`nav.rs`). Only the splash pages and `http://127.0.0.1:<port>` load in the window. Web links and `mailto:` open in the default app. Other loopback ports and hosts, `file:`, `data:`, `javascript:` and the rest are dropped. New windows are never opened.
- **Downloads** (`downloads.rs`). Only downloads that start from the Local App Studio origin are allowed. The file name is cleaned, the file goes to the Downloads folder without overwriting (`name (1).zip`), and the folder is then revealed.
- **Single instance.** A second launch focuses the existing window.
- **Unsigned builds.** The installers are not code-signed, so Windows SmartScreen warns on first run. See the Code signing section of docs/RELEASING.md before you sell to people who will not click through that warning.

## Swapping the icon

`icons/source.svg` is a placeholder (the favicon). The easiest swap is `npm run init-app -- --icon path/to/icon.png` (a square PNG, ideally 1024 px), which embeds your PNG and regenerates the icons. You can also replace `icons/source.svg` with your own square artwork (ideally a 1024 px SVG) and run `npm run desktop:icons`. That script already deletes the mobile and store extras (`android/`, `ios/`, `Square*.png`, `StoreLogo.png`, `64x64.png`), so there is nothing to clean up by hand; the bundle only uses `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` and `icon.png`.

## Updater (not enabled)

Auto-update is off. Enabling `tauri-plugin-updater` needs a signing key pair (`tauri signer generate`, private key kept out of the repo and CI logs), a hosting place for `latest.json` and the installers (which has a cost), and a code-signing setup. Until you do that, the server's `updates` network feature (GitHub release check, notice only) is the only update mechanism.
