# FAQ and troubleshooting

## Basics

**Which platforms does the kit support?**
Only Windows is tested (the release pipeline builds and smoke-tests both x64 and ARM64 installers). Mac and Linux are untested: the code and workflows contain macOS and Linux options, but nobody has verified them. Do not promise those platforms to your customers until you have tested them yourself.

**Does the app need an account or an internet connection?**
No. There is no account and no telemetry. Everything runs on the user's computer. The app only goes online for features the user turns on in Settings > Network: a cloud model provider, an Ollama server on another machine, the update check, and license activation. The one other case is the model download, which the user clicks and which a local Ollama performs. See [PRODUCT.md](PRODUCT.md).

**Where does the app keep its data?**
In `%APPDATA%\Local App Studio` on Windows (`app.db`, `backups/` and a few small files). The folder is kept when the app is updated, reinstalled or uninstalled. See [ARCHITECTURE.md](ARCHITECTURE.md#data-folder).

**Where is the log?**
`%LOCALAPPDATA%\com.neuralfoundry.localappstudio\logs\server.log`. It holds the server's stdout and stderr, is replaced at each launch, and does not hold the user's own content. If the app fails to start, the error page shows this path.

**Can I sell an app built with the kit?**
Yes. See "What does the license allow" at the end of this page, then [LICENSING.md](LICENSING.md) for charging for Pro features and [RELEASING.md](RELEASING.md) for shipping.

## Setup problems

**`npm run desktop:dev` or `desktop:build` says `cargo` or `rustc` is not found.**
Install Rust from https://rustup.rs (the stable toolchain), then open a new PowerShell window so the new PATH is picked up. Check with `rustc -V`.

**The build fails with `link.exe` not found, or errors about the MSVC toolchain.**
Tauri on Windows needs the Microsoft C++ Build Tools. Install "Build Tools for Visual Studio" and tick the "Desktop development with C++" workload. On a Windows ARM64 PC also add the ARM64 build tools component, and use an ARM64 Rust toolchain (`rustc -vV` should show a host of `aarch64-pc-windows-msvc`). The Tauri prerequisites page has the current steps: https://v2.tauri.app/start/prerequisites/.

**The window is blank or the app says WebView2 is missing.**
The shell shows its UI in Microsoft Edge WebView2. Windows 11 includes it. If it is missing, install the Evergreen WebView2 Runtime from Microsoft. The installers you build use Tauri's `downloadBootstrapper` mode, so they download WebView2 on the customer's PC if it is missing (this needs an internet connection once). If the app window opens but shows an error page, the page names the `server.log` path: read it.

**The server fails with a message about `node:sqlite`, or `npm ci` complains about the Node version.**
The kit stores data with Node's built-in `node:sqlite`, which needs Node 24 or newer (`engines` in `package.json`). Run `node --version`. If it is older, install a current Node and run `npm ci` again. The desktop sidecar embeds the Node you build with, so the Node on your build machine decides which Node your customers run.

**`init-app` refuses to run.**
It refuses on a git working tree with uncommitted changes. Commit or stash your work, or pass `--force`. Run it with `--dry-run` first to see every change without writing anything. It works on an unzipped kit with no git repo. Running it again with the same values changes nothing. Renaming again is supported, but a single-word or very short current name needs `--force` and a careful read of `git diff`, because your current names are replaced as plain text. See the [README](../README.md).

**`npm run desktop:build` says it cannot build for another target.**
The sidecar is a Node single executable made from the local `node.exe`, so each architecture must be built natively. Build x64 on x64 Windows and ARM64 on ARM64 Windows. The release pipeline does exactly that with two runners.

**A Rust build fails with `LNK1104: cannot open file` or another path error.**
Windows limits most paths to 260 characters, and Cargo's build folders under `src-tauri\target` are deep. Unzip or clone the kit into a short folder (for example `C:\dev\my-app`), or point Cargo at a short build folder for that shell: `$env:CARGO_TARGET_DIR = "C:\dev\target"`.

**`cargo test` or `cargo clippy` complain that the sidecar or resources are missing.**
`tauri-build` checks for them even for a check. Run `npm run build` and `npm run desktop:sidecar` first.

## Ports and browser mode

**Desktop mode and ports.** The desktop app asks the system for a free loopback port each launch (`APP_PORT=0`), so it cannot collide with another program.

**`Port 4321 is already in use. Set APP_PORT to another port.`**
That is browser mode (`npm start`). Another process has port 4321. Set `APP_PORT` in your `.env` file or shell, or close the other process. `npm run dev` resolves `APP_PORT` the same way (`.env` beats the shell), so the API and the Vite proxy move together. `npm run sandbox` picks a free port for you.

**`npm run dev` says port 5174 is in use.**
The Vite dev server uses 5174 with `strictPort`, so it will not pick another port. Stop the other Vite process (`Stop-Process -Name node -Force` stops every Node process, so be careful if other work is running).

**I get `421 Host not allowed`.**
The server only accepts loopback host names (`localhost`, `127.0.0.1`, `[::1]`) to block DNS-rebinding attacks. If you reach the server by another name in browser mode, add it to `APP_ALLOWED_HOSTS`.

**`npm start` shows data I did not expect, or I want a clean start.**
Browser mode uses your real per-user data folder unless `APP_DATA_DIR` is set. Use `npm run sandbox` for a throwaway server with demo data. In the sandbox the fake helper answers the Prompt step with canned designs chosen by the words in your prompt (loans, borrow or due: three tables with links and dates; task or project: two tables; a change request on an existing app adds a Notes field; anything else: a crew roster), so the helper path works end to end; pass `--plain-ai` (or `--plain` for `npm run fake:ollama`) for one fixed line instead, or `--no-ai` for no helper at all. `npm run desktop:dev` always uses a fresh temporary folder.

## The assistant and Ollama

**Assistant says it needs Ollama, or Settings > AI shows an error.**
Install Ollama from https://ollama.com/download and open it. In the app, click **Check again**, or open Settings > AI. If Ollama is installed but not running, open the Ollama app (or run `ollama serve`). The server answers `503 ollama_unavailable` while Ollama does not answer and `503 ai_not_configured` when no model is installed. See [AI.md](AI.md).

**Assistant says no model is installed, or no model supports tools.**
Click **Download model** in the setup screen, or run `ollama pull qwen2.5:7b` in a terminal, then pick the model in Settings > AI.

**Answers are slow, or the first answer takes minutes.**
Normal on a PC without a graphics card: the first call loads the model. Use a smaller model (`llama3.2:1b` or `llama3.2:3b`), give the PC more memory, or offer the optional bring-your-own cloud provider. A call that waits more than five minutes for its first word ends with a timeout error. See [AI.md](AI.md#slow-hardware).

**The model download will not start.**
The download button only works with a local Ollama (`http://127.0.0.1:11434`) that is running, and only for the models the setup screen lists. If the download stops, click it again: Ollama resumes where it left off.

**"Assistant is busy with another request."**
Model calls run one at a time and the queue is short. Wait a moment and try again.

## Release problems

**Windows shows "Windows protected your PC" when I run my installer.**
Expected. The installers are not code-signed (the kit uses no paid certificate). Click **More info**, then **Run anyway**. Tell your customers about it up front. See [RELEASING.md](RELEASING.md#code-signing) and [INSTALL.md](INSTALL.md).

**The ARM64 build is missing or never starts in CI.**
The ARM64 build uses GitHub's `windows-11-arm` runner, which can be unavailable or queue for a long time. Nothing is published in that case (the public publish needs both installers). Re-run the failed jobs later. Details are in [RELEASING.md](RELEASING.md#if-something-fails).

**Publish fails with an authentication error.**
Create or renew the `RELEASES_TOKEN` secret, then re-run the `publish-public` job. See [RELEASING.md](RELEASING.md).

**`desktop:build:dev` says it needs a git checkout.**
Dev builds take their version from git. Put your app in a git repo first. See [DEV_CHANNEL.md](DEV_CHANNEL.md).

## What does the license allow?

The core is open source under the GNU Affero General Public License v3.0 (the file named [LICENSE](../LICENSE)). In short, and not as legal advice:

- The core, including the Studio, the server and the Tauri shell, is AGPL-3.0. You can use, study, change and share it under that license's terms.
- `packages/runtime/` is MIT (`packages/runtime/LICENSE`).
- The pro half (`pro/`) is source-available under FSL-1.1-MIT and is not in the public source. A checkout without `pro/` is the public build.
- Which license a built app carries as a whole is not settled, because the runtime package imports AGPL code from the core. See [LICENSING.md](LICENSING.md) and check this before you ship an app you plan to sell.

If anything on this page differs from `LICENSE` or the license file in each folder, those files win.
