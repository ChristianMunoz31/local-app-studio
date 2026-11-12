import { useAppInfo } from '../../hooks/useAppInfo';
import { isPlaceholderRepo } from '../../../scripts/release/placeholder.js';
import { IS_BUILT_APP, PRODUCT_NAME as PRODUCT, useHiddenNetworkFeatures } from '../../hooks/useHiddenNetworkFeatures';

const LINK =
  'underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]';
const RELEASES_URL = 'https://github.com/ChristianMunoz31/local-app-studio-releases/releases/latest';
// An un-renamed build links a GitHub handle anyone could register, so the link is dropped until init-app runs.
const LINK_IS_PLACEHOLDER = isPlaceholderRepo(RELEASES_URL.replace('https://github.com/', ''));
const HASH_COMMAND = 'Get-FileHash .\\Local-App-Studio-Setup-x64.exe -Algorithm SHA256';

/**
 * Plain-language steps for checking the privacy claims of Local App Studio (or of a built app) without trusting it. Steps 2 and 3 are for the
 * desktop app, so they show only when /api/app/info says desktop. The dev channel uses its own process name.
 */
export default function VerifyYourself() {
  const { info } = useAppInfo();
  // A built app has no update check, so these steps do not name one (unless update checks are on).
  const hasUpdates = !useHiddenNetworkFeatures().includes('updates');
  const desktop = info?.desktop === true;
  const serverName = info?.channel === 'dev' ? 'local-app-studio-dev-server.exe' : 'local-app-studio-server.exe';
  // A built app names itself "this app" (never Local App Studio) and has no releases page or installer checksum of its own to point at,
  // so the download step is left out.
  const showDownload = desktop && !IS_BUILT_APP;
  return (
    <div className="space-y-3 text-sm text-slate-slate300">
      <p className="text-xs text-slate-slate400">
        You don&apos;t have to take our word for it. These checks work on your own computer.
      </p>
      {info?.cloudAi === 'absent' && (
        <p className="text-xs text-slate-slate400">This build contains no cloud provider.</p>
      )}
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <p className="font-semibold text-slate-slate100">Turn off Wi-Fi</p>
          <p>
            Turn off Wi-Fi (or unplug the network cable) and use {PRODUCT} as usual. Everything keeps working, except features that
            obviously need the internet{hasUpdates ? ', like update checks,' : ','} which you turned on yourself.
          </p>
        </li>
        {desktop && (
          <li>
            <p className="font-semibold text-slate-slate100">Watch the connections</p>
            <p>
              On Windows, open Resource Monitor, go to the Network tab and find{' '}
              {IS_BUILT_APP ? (
                <>the process of this app&apos;s local server, whose name ends in <span className="font-mono">-server.exe</span>.</>
              ) : (
                <>
                  <span className="font-mono">{serverName}</span>, {PRODUCT}&apos;s local server.
                </>
              )}{' '}
              It only talks to <span className="font-mono">127.0.0.1</span>, which is your computer and
              nothing else, unless you turned on a feature{hasUpdates ? ' like update checks' : ''}. You can also add a Windows Defender
              Firewall rule for it. The window of {PRODUCT} uses <span className="font-mono">msedgewebview2.exe</span>, a part of Windows
              that other apps share, so connections from that name are not a reliable sign of what {PRODUCT} does.
            </p>
          </li>
        )}
        {showDownload && (
          <li>
            <p className="font-semibold text-slate-slate100">Check your download</p>
            <p>
              Each release has a <span className="font-mono">SHA256SUMS.txt</span> file with the expected checksum of both installers.
              Download it from{' '}
              {LINK_IS_PLACEHOLDER ? (
                'the release page you downloaded the installer from'
              ) : (
                <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                  the latest release page
                </a>
              )}
              . Then open PowerShell in the folder with the installer and run:
            </p>
            <pre className="glass-subtle mt-1 overflow-x-auto rounded-md p-2 text-xs">{HASH_COMMAND}</pre>
            <p className="mt-1">
              Use <span className="font-mono">Local-App-Studio-Setup-arm64.exe</span> if you downloaded the ARM installer. The hash must match the
              line for your file in <span className="font-mono">SHA256SUMS.txt</span>. If it does not match, delete the file and
              download it again.
            </p>
          </li>
        )}
        {!desktop && (
          <li className="list-none text-xs text-slate-slate400">These steps are for the desktop app.</li>
        )}
        {/* An explicit number: the conditional steps above and the list-none note count as list items, so the automatic number would drift. */}
        <li value={showDownload ? 4 : desktop ? 3 : 2}>
          <p className="font-semibold text-slate-slate100">See what {PRODUCT} connected to</p>
          <p>
            Open Network activity in this section to see the connections {PRODUCT} made: the feature, the host, the time and the result.
          </p>
        </li>
      </ol>
    </div>
  );
}
