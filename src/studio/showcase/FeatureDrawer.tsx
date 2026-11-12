// The details of one entry as a sheet on the right: a large preview, what it is, what it asks for and how to use it.
// The kit Modal gives it the focus trap, Escape and return of focus.
import { Suspense, lazy } from 'react';
import type { FeatureLibrary } from '@/catalog/features';
import type { Theme } from '@local-app-studio/runtime/spec/schema';
import Modal from '@/components/shared/Modal.jsx';
import { PILL, TONE_CLASS } from '@/components/settings/pillStyles.js';
import { btnDanger, btnPrimary, btnSecondary } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';
import { plainIssue } from '../lib/issueWords';
import { CATEGORY_LABELS } from './entries';
import type { ShowcaseEntry } from './entries';
import { FRAME_CLASS } from './frame';

const PreviewFrame = lazy(() => import('./PreviewFrame'));

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

export interface FeatureDrawerProps {
  entry: ShowcaseEntry;
  library: FeatureLibrary;
  theme?: Theme;
  onClose(): void;
  onUse(): void;
  /** Deletes a damaged feature (the page asks first). Without it a damaged feature has no delete button here. */
  onDelete?(): void;
}

export default function FeatureDrawer({ entry, library, theme, onClose, onUse, onDelete }: FeatureDrawerProps) {
  const apps = entry.feature?.usedBy.apps.length ?? 0;
  return (
    <Modal title={entry.name} onClose={onClose} placement="right">
      <div className="space-y-4">
        <Suspense fallback={<div aria-hidden="true" className={`w-full animate-pulse rounded-md bg-slate-slate700/40 ${FRAME_CLASS.lg}`} />}>
          <PreviewFrame entry={entry} library={library} size="lg" theme={theme} />
        </Suspense>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${PILL} ${TONE_CLASS.muted}`}>{CATEGORY_LABELS[entry.category]}</span>
          {entry.status === 'needs_repair' && <span className={`${PILL} ${TONE_CLASS.warn}`}>Needs repair</span>}
        </div>
        <p className="text-sm text-slate-slate300">{entry.description}</p>
        {entry.params.length > 0 && (
          <section aria-label="Settings you fill in">
            <h3 className="mb-1.5 text-[10px] uppercase tracking-widest text-slate-slate400">Settings you fill in</h3>
            <ul className="space-y-1 text-sm text-slate-slate100">
              {entry.params.map((p) => (
                <li key={`${p.label}:${p.words}`}>{`${p.label}: ${p.words}`}</li>
              ))}
            </ul>
          </section>
        )}
        {entry.kind === 'feature' && <p className={HINT_CLASS}>{apps === 0 ? 'Not used in an app yet' : `Used in ${plural(apps, 'app')}`}</p>}
        {entry.status === 'needs_repair' && (
          <section aria-label="What is wrong" className="space-y-2">
            <p className="text-sm text-accent-amber">
              This feature is damaged, so it cannot be added. What is wrong is listed below. Delete it, or make it again in Design and save it with Replace.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-slate100">
              {(entry.feature?.issues ?? []).slice(0, 5).map((issue) => (
                <li key={`${issue.path}:${issue.code}`}>{plainIssue(issue)}</li>
              ))}
            </ul>
            {onDelete && (
              <button type="button" className={btnDanger} onClick={onDelete}>
                Delete feature
              </button>
            )}
          </section>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Close
          </button>
          <button type="button" className={btnPrimary} onClick={onUse} disabled={entry.status !== 'ok'}>
            Use in app
          </button>
        </div>
      </div>
    </Modal>
  );
}
