# Releasing

Maintainer process; it needs the pro module and the private repository's release workflows, which are not in the public source.

Releasing is one action: merge the release PR. Everything after that is automatic. The source stays in your private repo (`sourceRepo`). Downloads go to a separate public releases repo (`releasesRepo`) that only ever receives the two Windows installers and `SHA256SUMS.txt`.

How it fits together:

- **release-please** (`release-please.yml`) reads your conventional commits, keeps a release PR up to date with the version bump and `CHANGELOG.md`, and tags `vX.Y.Z` when you merge it.
- **Two native Windows builds**, x64 and ARM64, each with a blocking smoke test of the server and a non-blocking smoke test of the installer.
- **A separate releases repo** with the installers and one `SHA256SUMS.txt`, so your customers can download without access to your source.
- **No paid service is needed.** The installers are not code-signed (see Code signing below) and there is no update server. The only cost is the GitHub Actions minutes your plan includes (see How long it takes).

The pipeline assumes a GitHub repo with Actions enabled. release-please and the Dev build need a real git checkout, so put your app in a repo before you try a release (an unzipped kit is not one yet).

Only Windows installers are built and tested. The workflows contain manual macOS and Linux options, but they are untested.

## One-time setup

### 1. Point the kit at your repos

`npm run init-app` fills this in for you when you pass `--repo` and `--releases-repo` (see the [README](../README.md)). To do it by hand, edit `config/release.json`, the one file that names the release target repos:

```json
{ "sourceRepo": "ChristianMunoz31/local-app-studio", "releasesRepo": "ChristianMunoz31/local-app-studio-releases" }
```

- `sourceRepo` is your private source repo. Dev pre-releases are published there.
- `releasesRepo` is the public downloads repo. Create it (empty is fine) before the first release.

Both values must look like `owner/name`; `scripts/release/releaseConfig.js` rejects anything else. The workflows read this file into a `RELEASES_REPO` environment variable, and `pro/scripts/release/publishPublic.js` publishes to it. `config/release.json` is the single source for these names. The other places that mention your repos (the `docs/INSTALL.md` download links, `.github/CODEOWNERS`) should match it.

### 2. Create the `RELEASES_TOKEN` secret

The publish job needs one repository secret, `RELEASES_TOKEN`: a fine-grained personal access token that can write releases to the releases repo and nothing else.

1. Open https://github.com/settings/personal-access-tokens/new
2. Token name: for example `releases publish`.
3. Resource owner: your GitHub user or organization.
4. Expiration: pick a date. One year, with a reminder to renew it a few weeks before, is a good choice. A fine-grained token can also have no expiration; that is less safe.
5. Repository access: **Only select repositories**, then choose your releases repo and nothing else.
6. Repository permissions: **Contents: Read and write**. Metadata (read-only) is added automatically. Leave everything else at No access.
7. Click **Generate token** and copy it.
8. Store it as a secret of the source repo. In PowerShell run the command below and paste the token when asked. The token is never shown again and never goes in the repo.

   ```powershell
   gh secret set RELEASES_TOKEN -R ChristianMunoz31/local-app-studio
   ```

If the secret is empty when a release runs, the `publish-public` job stops early with an error that points here. Nothing is published, and the other assets are still built.

### 3. Repository settings

release-please opens its PR with the built-in `GITHUB_TOKEN`. In the source repo, open Settings > Actions > General and allow GitHub Actions to create pull requests. Run `node scripts/setupLabels.js` once so the `hold` label exists (the release PR gets it automatically).

Checklist before the first release: the releases repo named in `config/release.json` exists, and the `RELEASES_TOKEN` secret is set on the source repo. Without both, every release run stops at publish.

## Cut a release

1. Open the release PR that `release-please.yml` keeps up to date (title like `chore(main): release <version>`). It carries the `hold` label, and a full CI run (`ci.yml`, `mode=full`) is started on its branch.
2. Read the `CHANGELOG.md` text in it. The public release notes are made from it, so fix a confusing line before you merge.
3. Merge it.

Release notes come from conventional commits: only `feat`, `fix`, `perf` and `docs` appear in the changelog (`release-please-config.json`). While the version is below 1.0, a `feat` bumps the minor version. The tag is plain `vX.Y.Z`. `extra-files` in the same config makes the release PR also set the version in `packages/runtime/package.json` and in its `package-lock.json` entry, so the runtime package follows the app version.

Installers built from the kit include the Node.js runtime (the desktop sidecar is a Node single-executable application, so its bundled OpenSSL, ICU and other components ship too). Ship the Node.js `LICENSE` that matches the Node version used to build the sidecar (`node --version`) with the installer: take it from that Node install folder, or from `https://github.com/nodejs/node/blob/v<version>/LICENSE`.

To ship a build with no cloud provider in it, set `APP_CLOUD_AI=off` for both the UI build and the sidecar (`npm run desktop:build` passes the variable to both), then run `npm run check:cloud-marker -- --require-absent` before you publish. It scans the sidecar bundle and executables and the built UI and fails if any cloud code is in them; see [AI.md](AI.md), "Building without the cloud provider". `npm run check:sidecar` keeps the sidecar from growing past `scripts/checks/sidecar-budget.json`.

## What happens automatically

1. release-please creates the tag `vX.Y.Z` and the release in the private repo.
2. `release.yml` runs the tests, builds the source zip and attaches it with `SHA256SUMS.txt` to the private release (private only).
3. `desktop-windows.yml` builds the Windows installers natively on two runners at the same time (x64 on `windows-latest`, ARM64 on `windows-11-arm`). Each one:
   - builds the server sidecar and runs a smoke test against it (`pro/scripts/release/smokeSidecar.js`: starts it like the app does, checks the sign-in handshake, the API and the web page, then a clean exit). A failure here stops the release before anything is published;
   - builds the NSIS installer and renames it to `Local-App-Studio-Setup-x64.exe` or `Local-App-Studio-Setup-arm64.exe`;
   - tries a silent install, launch and uninstall of that installer (`pro/scripts/release/smokeInstaller.js`). This step is non-blocking (it only warns), because a headless runner does not always give a desktop app a usable window. Test the installer by hand before you announce a release.
4. The installers and per-architecture checksums are attached to the private release.
5. `publish-public` creates `SHA256SUMS.txt` for both installers, checks them, and publishes a release with the same tag in the releases repo: the two installers, `SHA256SUMS.txt`, plain-language notes from the changelog, a SmartScreen note and checksum instructions. It marks the release latest. It refuses to upload any other file, so source code never reaches the public repo.

These links then always point to the newest release (substitute your releases repo):

- https://github.com/ChristianMunoz31/local-app-studio-releases/releases/latest/download/Local-App-Studio-Setup-x64.exe
- https://github.com/ChristianMunoz31/local-app-studio-releases/releases/latest/download/Local-App-Studio-Setup-arm64.exe

## The Dev channel

"Local App Studio Dev" is a second, unsigned build for testing. It installs next to Local App Studio and shares nothing with it. Dev builds are never attached to a `v*` release and never offered to your customers. How to build one, locally or in CI, and how it stays separate is in [DEV_CHANNEL.md](DEV_CHANNEL.md).

## How long it takes and what it costs

Wall time is about 25 to 30 minutes, because the two Windows builds and the source job run at the same time. In a private repo, Windows minutes count double.

| Job | Runner minutes | Billed |
| --- | --- | --- |
| Windows x64 | 15 to 20 | 30 to 40 |
| Windows ARM64 | 20 to 25 | 40 to 50 |
| Source zip and tests | about 6 | about 6 |
| Publish and small jobs | about 1 each | a few |

A release is roughly 80 to 100 billed minutes. These are estimates until you have a few real runs.

## Manual dry run

Use this before your first real release, or after changing a workflow. It builds both installers, runs both smoke tests, and publishes only a draft in the public repo.

```powershell
gh workflow run release.yml -R ChristianMunoz31/local-app-studio --ref main -f tag=v0.0.1-dryrun.1 -f source_ref=main -f desktop=true -f desktop_platforms=windows -f publish=draft
```

- The `tag` here is only a test name (it must look like `vX.Y.Z-suffix`, and a `-dev` tag is refused). The workflow file is read from `--ref`, the code that gets built from `source_ref`.
- `publish=draft` creates a draft release in the releases repo that only you can see. Use `publish=none` to dry-run the publish script without needing the token (it prints the plan and the notes in the log).
- Nothing is written to the private repo, and a run with `source_ref` can never publish a full release.
- Watch it with `gh run list -R ChristianMunoz31/local-app-studio -w release.yml` and `gh run watch`.

Delete the draft afterwards:

```powershell
gh release delete v0.0.1-dryrun.1 -R ChristianMunoz31/local-app-studio-releases --cleanup-tag --yes
```

Re-running a release for the same tag is safe: the files are replaced (`--clobber`) and the notes are updated.

## If something fails

- **`windows-11-arm` is unavailable.** The ARM64 runner is a GitHub public preview, so it can be missing or queue for long. The ARM64 build then fails or never starts, and `publish-public` does not run (it needs both installers). Wait and re-run the failed jobs from the Actions page. Cross-compiling ARM64 on an x64 runner is not wired up: the sidecar is a Node single executable made from a `node.exe`, so it needs the official `node-v<version>-win-arm64` binary passed with `--node-binary` and `--out-triple aarch64-pc-windows-msvc` to `scripts/desktop/buildSidecar.js`, plus `rustup target add aarch64-pc-windows-msvc` and `tauri build --target aarch64-pc-windows-msvc`. That ARM64 sidecar could not be smoke-tested on an x64 runner.
- **The sidecar smoke test fails.** Open the failed job. The message names the check (ready line, 401 gate, bootstrap, API, HTML or exit code). Nothing was published.
- **Publish fails with `RELEASES_TOKEN`.** Create or renew the token (see One-time setup) and re-run the failed `publish-public` job. An expired token shows up as an authentication error from `gh`.
- **A wrong or broken release is already public.** Delete it in the releases repo (or edit it to a draft) and re-run the `publish-public` job.

## Code signing

The kit is set up to cost $0: it uses no code-signing certificate. The installers are unsigned, so Windows SmartScreen shows "Windows protected your PC" the first time a customer runs one. Customers can click **More info**, then **Run anyway**. This is stated in the public release notes (together with how to check the download against `SHA256SUMS.txt`) and in [INSTALL.md](INSTALL.md), which you can give to your customers.

Tell your customers about the warning before they download, and decide whether it fits your audience. If you sell to people who will not click through a SmartScreen warning, add a certificate and a signing step: `desktop-windows.yml` has a marked placeholder step ("Sign installer") that runs before the checksums are computed. Signing is a paid certificate and is not set up in the kit.

Auto-update is also not enabled. The server's optional `updates` network feature (Settings > Network, off by default) only checks your public releases repo on GitHub for a newer release and shows a notice.
