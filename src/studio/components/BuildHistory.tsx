// Earlier builds of this app, newest first.
import { PILL, TONE_CLASS } from '../../components/settings/pillStyles';
import { BUILD_STATUS_LABEL } from '../buildTypes';
import type { BuildRecord, BuildStatus } from '../buildTypes';
import { formatElapsed } from '../lib/format';

const TONE: Readonly<Record<BuildStatus, keyof typeof TONE_CLASS>> = {
  running: 'muted',
  succeeded: 'ok',
  failed: 'warn',
  cancelled: 'muted',
  interrupted: 'warn',
};

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export default function BuildHistory({ builds }: { builds: BuildRecord[] }) {
  if (builds.length === 0) return <p className="text-sm text-slate-slate400">No builds yet.</p>;
  return (
    <ul className="divide-y divide-slate-slate700/50" aria-label="Earlier builds">
      {builds.slice(0, 20).map((b) => (
        <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm text-slate-slate300">
          <span className="w-44 shrink-0">{new Date(b.startedAt).toLocaleString()}</span>
          <span className={`${PILL} ${TONE_CLASS[TONE[b.status]]}`}>{BUILD_STATUS_LABEL[b.status]}</span>
          {b.appVersion !== null && <span>Version {b.appVersion}</span>}
          {b.durationMs !== null && <span>{formatElapsed(b.durationMs)}</span>}
          {b.installerPath !== null && <span className="min-w-0 break-all font-mono text-xs text-slate-slate400">{baseName(b.installerPath)}</span>}
        </li>
      ))}
    </ul>
  );
}
