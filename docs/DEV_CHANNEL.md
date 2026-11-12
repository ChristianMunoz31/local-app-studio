# The Dev channel (Local App Studio Dev)

A second build of your app for testing. **Local App Studio Dev** installs next to Local App Studio, runs at the same time, and shares nothing with it. Use it to try a change, or a store test purchase, on a real installed build without touching your own data or your customers' builds.

Dev builds are unsigned, like every build from the kit, and they are never attached to a `v*` release and never offered to customers.

## What is separate

| | Local App Studio | Local App Studio Dev |
| --- | --- | --- |
| Tauri identifier | `com.neuralfoundry.localappstudio` | `com.neuralfoundry.localappstudio.dev` |
| Product name | `Local App Studio` | `Local App Studio Dev` |
| Main binary | `LocalAppStudio` | `AppDev` |
| Sidecar exe | `local-app-studio-server` | `local-app-studio-dev-server` |
| Data folder (Windows) | `%APPDATA%\Local App Studio` | `%APPDATA%\Local App Studio Dev` |
| Install folder | per-user, `%LOCALAPPDATA%\Local App Studio` | per-user, `%LOCALAPPDATA%\Local App Studio Dev` |
| Log file | `%LOCALAPPDATA%\com.neuralfoundry.localappstudio\logs\server.log` | `%LOCALAPPDATA%\com.neuralfoundry.localappstudio.dev\logs\server.log` |
| Icons | `src-tauri/icons/` | `src-tauri/icons/dev/` (same art with an amber DEV badge) |
| Update check | your public releases repo | the Dev pre-releases in your source repo |

Because the identifier differs, the two apps also have their own single-instance lock, WebView2 profile and window-state file. The Dev window shows a small "Dev build" label.

## Build one

On your machine:

```powershell
npm run desktop:build:dev
```

It needs a git checkout (the Dev version is built from the release manifest, the date and the commit, and the script says "Dev builds need a git checkout" without one). The script runs `npm run build`, builds the sidecar for the dev channel, checks the channel marker, writes the generated config `src-tauri/tauri.dev.build.json` (merged from `src-tauri/tauri.dev.conf.json` plus the Dev version, and gitignored), then runs `tauri build`. Like the stable build it only builds for the machine you are on. The installer is copied to `.dev-build/` as `Local-App-Studio-Dev_<display version>_<arch>-setup.exe`, with a `SHA256SUMS-dev-windows.txt` file.

In CI, run the `dev-build.yml` workflow by hand (Actions tab, or `gh workflow run dev-build.yml -f platforms=windows -f keep=10`). It builds from the branch you pick and publishes a pre-release in your source repo named `Local App Studio Dev <display version>`, with a tag like `dev-YYYYMMDD-<sha7>`. It never runs automatically, it is never marked "latest", and it keeps only the newest `keep` pre-releases. `platforms` can be `windows`, `macos`, `linux` or `all`, but only Windows is tested, and macOS minutes cost ten times as much in a private repo.

Print the next Dev versions with `node scripts/desktop/devVersion.js --json`.

### Version names

A Dev build is named after the next release plus the build date and commit, so it sorts between releases: `<next version>-dev.<YYYYMMDD>.<sha7>` is the display version shown in the app and in the installer name. The installer's own version (the Tauri bundle version) is `<next version>-dev.<YYYYMMDD>+<N>`, where `N` counts days since 2024-01-01, so Windows gets a version number that keeps increasing.

## Install and use

Download the Dev installer, run it (SmartScreen will warn, as for any unsigned installer), and open **Local App Studio Dev** from the Start menu. End-user steps are in [INSTALL.md](INSTALL.md).

- Uninstalling or updating Dev keeps `%APPDATA%\Local App Studio Dev` and never touches Local App Studio or its data.
- To test with your own data, open Settings > Data & storage in Local App Studio Dev and use **Copy my data from Local App Studio**. It is one-way. Dev makes a safety backup of its own data first, saved keys are not copied, and Local App Studio is never changed. This feature exists only in the Dev channel.
- Dev builds accept store test purchases (Gumroad `test: true`, Lemon Squeezy `test_mode`). Stable builds refuse them. This is how you test licensing, see [LICENSING.md](LICENSING.md).
- Dev checks for newer Dev builds only, and only if the user turned on update checks.

## How the channel is detected

The channel is fixed when a build is made. Nothing the user sets later can turn a stable build into a Dev build.

- **Server.** `server/channel.js` decides it. The sidecar bundler bakes the channel into the bundle (`__APP_CHANNEL__`), and every bundle starts with a `/*! APP_CHANNEL=<channel> */` marker line, which build scripts and CI scan for. Only an unbundled source checkout (`npm start`) reads the `APP_CHANNEL` environment variable, and only the exact value `dev` selects Dev. In server code, ask `isDevChannel()` from `server/channel.js`; do not compare environment variables yourself. The UI reads it from `GET /api/app/info`.
- **Shell.** The Rust shell reads its channel at runtime from its own Tauri identifier (`src-tauri/src/channel.rs`): the Dev identifier means Dev, anything else is stable.
- **Cross-checks.** The shell always tells the sidecar its channel (`APP_SHELL_CHANNEL`) and the server exits with code 1 if it differs from its own. The ready line must carry the same channel. A Dev server also refuses a data folder that is, contains or lies inside the stable data folder, and the Dev shell refuses the same before it starts the server. Build scripts check the packaged sidecar and bundle carry the expected marker, and refuse a stable build when `APP_CHANNEL` or `APP_DISPLAY_VERSION` is set.
- **Installer guard.** The Dev installer (`src-tauri/installer/hooks.dev.nsh`) refuses an install folder that belongs to the stable app or holds its data.

Environment variables used by the build scripts and CI: `APP_CHANNEL` (`dev` or `stable`), `APP_DISPLAY_VERSION` (required for dev builds, refused for stable), and `APP_SHELL_CHANNEL` (set by the shell). Details are in [CLAUDE.md](../CLAUDE.md).

## Testing the copy feature safely

Set `APP_DESKTOP_STABLE_DATA_DIR` (in one shell only, to a throwaway folder) before starting the Dev app to point "Copy my data from Local App Studio" at that folder instead of the real one. The stable shell never forwards that variable. Never set it as a permanent user variable.

## Customizing

`src-tauri/tauri.dev.conf.json` is the overlay that changes the product name, binary name, identifier, icons, sidecar and installer hooks. `npm run desktop:icons` regenerates both icon sets (the Dev icons are the same artwork plus a DEV badge). `npm run init-app` renames both channels together (see the [README](../README.md)).
