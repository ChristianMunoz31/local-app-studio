// Outcome of a finished build: the installer on success, the message and failed step otherwise.
import { useEffect, useRef, useState } from 'react';
import { btnPrimary, btnSecondary } from '@/components/shared/formStyles.js';
import { BUILD_STATUS_LABEL } from '../buildTypes';
import type { BuildRecord } from '../buildTypes';
import { formatMb } from '../lib/format';
import { HINT_CLASS, SUMMARY_CLASS } from './ui';

const COPY_MESSAGE_MS = 2500;

interface Props {
  build: BuildRecord;
  failedStep?: string | null;
  /** Move focus to Copy path once, when the installer just finished here (not when an earlier build is shown). */
  focusCopy?: boolean;
}

export default function BuildResult({ build, failedStep, focusCopy = false }: Props) {
  const [copied, setCopied] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyButton = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  const ready = build.status === 'succeeded' && build.installerPath !== null;
  useEffect(() => {
    if (!ready || !focusCopy || focused.current) return;
    focused.current = true;
    copyButton.current?.focus();
  }, [ready, focusCopy]);

  const copy = async (text: string, what: string): Promise<void> => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${what} copied.`);
    } catch {
      setCopied(`Could not copy the ${what.toLowerCase()}. Select it and copy it yourself.`);
    }
    timer.current = setTimeout(() => setCopied(''), COPY_MESSAGE_MS);
  };

  if (ready) {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm font-semibold text-accent-green">
          Your installer is ready.
        </p>
        <p className="break-all font-mono text-base text-slate-slate100">{build.installerPath}</p>
        <div>
          <button ref={copyButton} type="button" className={btnPrimary} onClick={() => void copy(build.installerPath ?? '', 'Path')}>
            Copy path
          </button>
        </div>
        <p role="status" className="min-h-4 text-xs text-slate-slate400">
          {copied}
        </p>
        <details>
          <summary className={SUMMARY_CLASS}>Show details</summary>
          <dl className="mt-3 space-y-2 text-sm">
            {build.installerSizeBytes !== null && (
              <div>
                <dt className="text-xs text-slate-slate400">Size</dt>
                <dd className="text-slate-slate100">{formatMb(build.installerSizeBytes)}</dd>
              </div>
            )}
            {build.installerSha256 !== null && (
              <div>
                <dt className="text-xs text-slate-slate400">SHA-256</dt>
                <dd className="break-all font-mono text-xs text-slate-slate100">{build.installerSha256}</dd>
              </div>
            )}
          </dl>
          {build.installerSha256 !== null && (
            <div className="mt-2">
              <button type="button" className={btnSecondary} onClick={() => void copy(build.installerSha256 ?? '', 'SHA-256')}>
                Copy SHA-256
              </button>
            </div>
          )}
        </details>
        <p className={HINT_CLASS}>Install it from that folder. Windows may warn because the installer is not signed.</p>
      </div>
    );
  }

  const stoppedAt = failedStep != null && failedStep !== '' ? failedStep : null;
  return (
    <div className="space-y-1">
      <p role="alert" className="text-sm font-semibold text-accent-red">
        {stoppedAt !== null
          ? `The build stopped at ${stoppedAt}. Open Show build log, fix what it says, then press Make installer again.`
          : `Build ${BUILD_STATUS_LABEL[build.status].toLowerCase()}. Press Make installer to try again.`}
      </p>
      {build.message !== null && <p className="text-sm text-slate-slate300">{build.message}</p>}
    </div>
  );
}
