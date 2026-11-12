// Build step: turns the saved design into a Windows installer (DESIGN-phase4.md section 6, phase 12 2.5). Lazy-loaded.
import { useEffect, useId, useRef, useState } from 'react';
import StudioSectionCard from '@/studio/components/StudioSectionCard';
import { btnDanger, btnPrimary, btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import { useNetworkFeature } from '@/hooks/useNetworkFeature.js';
import { useNetworkSettings } from '@/hooks/useNetworkSettings.js';
import { PRO_PARTS } from '@/proParts.js';
import BuildHistory from '../components/BuildHistory';
import BuildLog from '../components/BuildLog';
import BuildOptInSwitch from '../components/BuildOptInSwitch';
import BuildResult from '../components/BuildResult';
import BuildSteps from '../components/BuildSteps';
import InstallerNotInBuild from '../components/InstallerNotInBuild';
import StudioConfirm from '../components/StudioConfirm';
import ToolchainChecklist from '../components/ToolchainChecklist';
import { SUMMARY_CLASS } from '../components/ui';
import { useBuild } from '../hooks/useBuild';
import { useStepChrome } from '../hooks/useStepChrome';
import { useToolchain } from '../hooks/useToolchain';
import { useWorkspace } from '../hooks/useWorkspace';
import { exportFileName, exportedNotice } from '../lib/appFiles';
import { downloadJson } from '../lib/download';
import { formatElapsed } from '../lib/format';

/** Name of the build opt-in switch when the server has not sent its label yet. */
const BUILD_SWITCH_NAME = 'Allow downloads for builds';
const CANNOT_STOP ='The installer is being saved and can no longer be stopped.';

/** "a", "a and b", "a, b and c". */
const joinList = (parts: string[]): string => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

function FoldedLog({ lines, truncated }: { lines: Parameters<typeof BuildLog>[0]['lines']; truncated: boolean }) {
  return (
    <details>
      <summary className={SUMMARY_CLASS}>Show build log</summary>
      <div className="mt-2">
        <BuildLog lines={lines} truncated={truncated} />
      </div>
    </details>
  );
}

/** A build without the installer (docs/ARCHITECTURE.md, 'The pro seam'): one line and the app export, which every build has. */
function BuildWithoutInstaller() {
  const { record, spec } = useWorkspace();
  const [notice, setNotice] = useState('');
  const onExport = (): void => {
    const file = exportFileName(record.name);
    downloadJson(file, spec);
    setNotice(exportedNotice(record.name, file));
  };
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <section aria-label="Build">
        <InstallerNotInBuild onExport={onExport} notice={notice} />
      </section>
    </div>
  );
}

export default function BuildTab() {
  return PRO_PARTS.installer ? <BuildWithInstaller /> : <BuildWithoutInstaller />;
}

function BuildWithInstaller() {
  const { record, revision } = useWorkspace();
  const chrome = useStepChrome();
  const blockedId = useId();
  const { report, loading, error: toolchainError, refresh } = useToolchain();
  const { builds, live, elapsedMs, starting, error, optInRequired, start, cancel } = useBuild(record.id);
  const { offError } = useNetworkFeature('build');
  const { features } = useNetworkSettings();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const running = live?.build.status === 'running';
  const toolsReady = report?.ok === true;
  const toolsMissing = report !== null && !report.ok;
  const saving = live?.steps.find((s) => s.id === 'desktop-build')?.status === 'done';
  const optInOff = offError !== null;
  // BuildOptInSwitch renders nothing when the feature is not offered, so there is no switch to point at.
  const buildFeature = features?.find((f) => f.id === 'build');
  const switchShown = buildFeature !== undefined && buildFeature.available !== false;
  const canStart = toolsReady && !optInOff && !running && !starting;
  const toolsPending = report === null ? (toolchainError !== null ? 'The build tools check did not finish.' : 'Checking the build tools.') : null;
  const switchName = buildFeature?.label ?? BUILD_SWITCH_NAME;
  const blockers = [
    toolsMissing && 'install the missing build tools',
    optInOff && (switchShown ? `turn on "${switchName}"` : `turn on "${switchName}" in Settings, Network`),
  ].filter((b): b is string => typeof b === 'string');
  const blockedLine = toolsPending ?? (blockers.length > 0 ? `Before you can make an installer: ${joinList(blockers)}.` : null);

  const shown = live?.build ?? builds[0] ?? null;
  const finished = shown !== null && shown.status !== 'running' ? shown : null;
  const failedStep = live?.steps.find((s) => s.status === 'failed' || s.status === 'cancelled')?.label ?? null;
  const justFinishedHere = finished !== null && live?.build.id === finished.id;
  const installerReady = finished?.status === 'succeeded' && finished.installerPath !== null;
  const startClass = installerReady ? btnSecondary : btnPrimary;

  // The installer of the saved design exists: the rail may mark Build done.
  const doneForRevision = installerReady && finished.specRevision === revision;
  const chromeRef = useRef(chrome);
  useEffect(() => {
    chromeRef.current = chrome;
  });
  useEffect(() => {
    if (doneForRevision) chromeRef.current.markDone('build', revision);
  }, [doneForRevision, revision]);

  // The build ended while "Stop this build?" was open (it finished or failed on its own): the question no longer applies.
  if (!running && confirmCancel) setConfirmCancel(false);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <StudioSectionCard title="Make an installer" subtitle="Makes a Windows installer for this app on this computer.">
        <div className="space-y-4">
          <p className="text-sm text-slate-slate300">The first build on this PC takes 5 to 15 minutes.</p>
          <ToolchainChecklist report={report} loading={loading} error={toolchainError} onRefresh={() => void refresh()} collapseWhenReady />
          <BuildOptInSwitch />
          {blockedLine !== null && (
            <p id={blockedId} role="status" className="text-sm text-slate-slate400">
              {blockedLine}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={startClass}
              disabled={!canStart}
              aria-describedby={blockedLine !== null ? blockedId : undefined}
              onClick={() => void start(revision)}
            >
              {starting ? 'Starting...' : 'Make installer'}
            </button>
            {running && (
              <>
                <button
                  type="button"
                  className={`${btnDanger} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
                  aria-disabled={saving ? true : undefined}
                  title={saving ? CANNOT_STOP : undefined}
                  onClick={() => (saving ? chrome.announce(CANNOT_STOP) : setConfirmCancel(true))}
                >
                  Stop build
                </button>
                <span role="timer" className="font-mono text-sm text-slate-slate300" aria-label="Time elapsed">
                  {formatElapsed(elapsedMs)}
                </span>
              </>
            )}
          </div>
          {optInRequired && switchShown && <p className="text-sm text-slate-slate300">{`Turn on "${switchName}" to continue.`}</p>}
          {error !== null && (
            <p role="alert" className={formErrorClass}>
              {error}
            </p>
          )}
        </div>
      </StudioSectionCard>

      {live !== null && running && (
        <StudioSectionCard title="Progress">
          <div className="space-y-4">
            {live.steps.length === 0 ? <p role="status" className="text-sm text-slate-slate400">Starting the build...</p> : <BuildSteps steps={live.steps} />}
            <FoldedLog lines={live.lines} truncated={live.truncated} />
          </div>
        </StudioSectionCard>
      )}

      {finished !== null && (
        <StudioSectionCard title="Result">
          <BuildResult build={finished} failedStep={justFinishedHere ? failedStep : null} focusCopy={justFinishedHere} />
          {live !== null && justFinishedHere && live.lines.length > 0 && !finished.installerPath && (
            <div className="mt-4">
              <FoldedLog lines={live.lines} truncated={live.truncated} />
            </div>
          )}
        </StudioSectionCard>
      )}

      <StudioSectionCard className="py-3">
        <details>
          <summary className={SUMMARY_CLASS}>Earlier builds</summary>
          <div className="mt-2">
            <BuildHistory builds={builds} />
          </div>
        </details>
      </StudioSectionCard>

      {confirmCancel && (
        <StudioConfirm
          title="Stop this build?"
          message="The build stops now. You can start a new one any time."
          confirmLabel="Stop build"
          busyLabel="Stopping..."
          cancelLabel="Keep building"
          onConfirm={async () => {
            await cancel();
            setConfirmCancel(false);
          }}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </div>
  );
}
