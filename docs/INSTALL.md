# Installing Local App Studio

Local App Studio is a desktop app that runs on your own computer. Your data stays on your computer. This guide shows how to install it and set it up.

*For the developer:* this page is a ready-made install guide for your own customers. Publish it on your site or in your releases repo. The download links point at the releases location the owner sets in `config/release.json` (`releasesRepo`; `npm run init-app` rewrites the links to match), so check them after your first release. If you build the app yourself, see [RELEASING.md](RELEASING.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

**Platform:** Local App Studio is tested on Windows only. Builds for macOS and Linux have not been tested, so this guide covers Windows.

**Note:** Local App Studio installers are not code-signed, so Windows shows a security warning the first time you run one. It is expected, and the steps below show how to continue.

## Why you see a warning

Windows warns about apps that are not code-signed. Code signing is a paid certificate that proves who made an app. The warning does not mean something is wrong with the file. It means Windows cannot check who made it. Only install a Local App Studio file that you got from someone you trust.

## Windows

1. Download the installer for your PC. These links always give you the newest version:
   - Most PCs (Intel or AMD): [Local-App-Studio-Setup-x64.exe](https://github.com/ChristianMunoz31/local-app-studio-releases/releases/latest/download/Local-App-Studio-Setup-x64.exe)
   - ARM PCs such as Windows on Snapdragon: [Local-App-Studio-Setup-arm64.exe](https://github.com/ChristianMunoz31/local-app-studio-releases/releases/latest/download/Local-App-Studio-Setup-arm64.exe)

   Not sure which you have? Open Settings, then System, then About, and look at "System type". All versions are on the [releases page](https://github.com/ChristianMunoz31/local-app-studio-releases/releases).
2. Double-click the file.
3. Windows shows **Windows protected your PC** (SmartScreen), because the installer is not code-signed. This is expected. Click **More info**, then click **Run anyway**.
4. Follow the installer. It installs for your user only. It does not need administrator rights.
5. If your PC does not have Microsoft Edge WebView2, the installer downloads it. This needs an internet connection once.
6. Open Local App Studio from the Start menu.

### Check your download (optional)

Each release has a `SHA256SUMS.txt` file with the expected checksum of both installers. To check yours, open PowerShell in the folder with the installer and run:

```powershell
Get-FileHash .\Local-App-Studio-Setup-x64.exe -Algorithm SHA256
```

Use `Local-App-Studio-Setup-arm64.exe` if you downloaded the ARM installer. The hash must match the line for your file in `SHA256SUMS.txt` (download it from the same release page). If it does not match, delete the file and download it again.

## Installing Local App Studio Dev next to Local App Studio

Local App Studio Dev is a test build for people helping to test new work. Most people do not need it. It installs next to Local App Studio, so you can keep using Local App Studio while you try it. It is unsigned, like all Local App Studio builds.

1. Download `Local-App-Studio-Dev_<version>_<arch>-setup.exe`. The version looks like `<next version>-dev.<date>.<commit>`. Pick `x64` for most PCs, or `arm64` for ARM PCs.
2. Double-click the file. Windows may show **Windows protected your PC** (SmartScreen). Click **More info**, then click **Run anyway**.
3. Follow the installer. It installs for your user only, in `%LOCALAPPDATA%\Local App Studio Dev`, and does not need administrator rights.
4. Open **Local App Studio Dev** from the Start menu. It has its own icon with an amber DEV badge, and a small **Dev build** label at the top of the window.

Local App Studio Dev and Local App Studio are separate apps:

- Local App Studio Dev keeps its data in `%APPDATA%\Local App Studio Dev`. Local App Studio keeps its data in `%APPDATA%\Local App Studio`. Neither app reads or changes the other's data on its own.
- Both can run at the same time.
- Local App Studio Dev has its own log: `%LOCALAPPDATA%\com.neuralfoundry.localappstudio.dev\logs\server.log`.
- Uninstall Local App Studio Dev from **Apps > Installed apps**. It is a separate entry. Uninstalling or updating it keeps `%APPDATA%\Local App Studio Dev` and does not touch Local App Studio or its data.
- Local App Studio Dev checks for newer Local App Studio Dev builds only (not for Local App Studio releases), and only if you turned on update checks in Settings.

To test with your own data, open Settings > Data & storage in Local App Studio Dev and use **Copy my data from Local App Studio**. This is one-way: Local App Studio Dev never changes your Local App Studio data, and changes you make in Local App Studio Dev stay in Local App Studio Dev. Local App Studio Dev makes a safety backup of its own data first, and saved keys are not copied.

## First run

1. **Welcome.** Local App Studio may ask what to call you. This is optional. You can click **Skip for now**.
2. **Set up Assistant.** Assistant is Local App Studio's built-in helper. It is optional. You can set it up later in Settings. Assistant runs on a free app called Ollama on your computer, so nothing leaves your computer.
   - If Local App Studio says Ollama is missing, click **Get Ollama**. It opens https://ollama.com/download in your browser. Install Ollama and open it.
   - Come back to Local App Studio and click **Check again**.
   - Local App Studio suggests a model based on how much memory your computer has:

     | Computer memory | Suggested model | Download size |
     | --- | --- | --- |
     | Under 6 GB | `llama3.2:1b` | about 1.3 GB |
     | 6 GB to under 10 GB | `llama3.2:3b` | about 2.0 GB |
     | 10 GB to under 14.5 GB | `llama3.2:3b`, plus optional `qwen2.5:7b` | about 2.0 GB, optional 4.7 GB |
     | 14.5 GB or more | `qwen2.5:7b` for your data, plus `llama3.2:3b` for fast chat | about 4.7 GB and 2.0 GB |

   - Click **Download model**. Ollama downloads the model from the Ollama library. Local App Studio itself does not connect to the internet for this. A progress bar shows the download. Large models can take a while on a slow connection.
   - Click **Cancel** to stop a download. If you start it again, Ollama picks up where it left off.
   - Click **Skip for now** if you do not want Assistant yet.

The first answer from Assistant can be slow on a computer without a graphics card. Later answers are faster.

## Where your data lives

Your data is in `%APPDATA%\Local App Studio`.

- Updating, reinstalling and uninstalling Local App Studio keep this folder.
- To remove your data, close Local App Studio and delete the folder yourself. This cannot be undone, so export your data first if you want a copy.
- Local App Studio makes a backup of your data every day inside this folder (`backups`). You can restore one in Settings > Data & storage.

## Help menu

- **Open data folder** opens the folder above.
- **Export my data** opens Settings > Data & storage, where you can export everything as a ZIP. The file is saved to your Downloads folder and shown to you.
- **About Local App Studio** shows the version.

## Troubleshooting

**Local App Studio did not start.** The window shows an error page with the path of a log file named `server.log`. It is replaced each time Local App Studio starts. On Windows it is at `%LOCALAPPDATA%\com.neuralfoundry.localappstudio\logs\server.log`. Close Local App Studio and open it again. If it still fails, share the log with the person who gave you the build. The log holds technical messages, not your own content.

**Assistant says it needs Ollama.** Install Ollama from https://ollama.com/download and open it. Then click **Check again** in the Assistant setup, or open Settings > AI. If Ollama is installed but not running, open the Ollama app.

**I opened Local App Studio a second time and nothing new appeared.** Only one Local App Studio runs at a time. A second launch brings the existing window to the front.

**The window says it lost its session.** Close Local App Studio and open it again from its app icon.
