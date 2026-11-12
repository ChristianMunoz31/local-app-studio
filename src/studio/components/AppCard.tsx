// One app on the Apps page: a single link named by the app name, plus a sibling actions menu.
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { PILL, TONE_CLASS } from '@/components/settings/pillStyles.js';
import { relativeTimeLabel } from '../lib/relativeTime';
import type { AppSummary } from '../types';
import ActionMenu from './ActionMenu';
import { STEP_FOCUS } from '../lib/steps';
import { HINT_CLASS } from './ui';
import { waitingLine } from '../lib/appFiles';

// PILL is rounded-full: swap it, so the waiting line's radius does not depend on stylesheet order.
const WAITING_PILL = PILL.replace('rounded-full', 'rounded-lg');

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

function editedLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : ` · Edited ${relativeTimeLabel(date)}`;
}

interface AppCardProps {
  app: AppSummary;
  onChangeLook(): void;
  onDuplicate(): void;
  onExport(): void;
  /** Offered when given: the design and the Preview records as one ZIP. */
  onExportWithRecords?(): void;
  onDelete(trigger: HTMLButtonElement): void;
}

export default function AppCard({ app, onChangeLook, onDuplicate, onExport, onExportWithRecords, onDelete }: AppCardProps) {
  const nameId = useId();
  const descId = useId();
  const metaId = useId();
  const pillsId = useId();
  const hasDescription = app.description.trim() !== '';
  const hasPills = !app.ok || app.hasInstaller;
  const waitingId = useId();

  return (
    <li className="glass-subtle relative rounded-lg">
      <Link
        to={`/apps/${app.id}`}
        state={STEP_FOCUS}
        aria-labelledby={nameId}
        aria-describedby={`${hasPills ? `${pillsId} ` : ''}${descId} ${metaId}${app.waiting ? ` ${waitingId}` : ''}`}
        className="flex h-full flex-col rounded-lg p-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
      >
        <span id={nameId} className="block min-h-7 break-words line-clamp-2 pr-10 text-sm font-semibold text-slate-slate100">
          {app.name}
        </span>
        <span id={descId} className={`mt-1 block break-words line-clamp-2 text-sm ${hasDescription ? 'text-slate-slate300' : 'text-slate-slate400'}`}>
          {hasDescription ? app.description : 'No description yet.'}
        </span>
        <span id={metaId} className={`mt-auto block pt-1 ${HINT_CLASS}`}>
          {`${plural(app.tableCount, 'table')}, ${plural(app.pageCount, 'page')}${editedLabel(app.updatedAt)}`}
        </span>
        {hasPills && (
          <span id={pillsId} className="mt-1 flex flex-wrap gap-1">
            {!app.ok && <span className={`${PILL} ${TONE_CLASS.warn}`}>Needs repair</span>}
            {app.hasInstaller && <span className={`${PILL} ${TONE_CLASS.ok}`}>Installer built</span>}
          </span>
        )}
        {app.waiting && (
          <span className="mt-1 block">
            {/* Pending, not done: the warn tone, and long words wrap inside the card instead of running out of it. */}
            <span id={waitingId} className={`${WAITING_PILL} ${TONE_CLASS.warn} max-w-full whitespace-normal break-words text-left`}>
              {waitingLine(app.waiting)}
            </span>
          </span>
        )}
      </Link>
      <div className="absolute right-2 top-2">
        <ActionMenu
          label={`More actions for ${app.name}`}
          menuLabel={`Actions for ${app.name}`}
          items={[
            { id: 'look', label: 'Change look', disabled: !app.ok, onSelect: onChangeLook },
            { id: 'duplicate', label: 'Duplicate', disabled: !app.ok, onSelect: onDuplicate },
            { id: 'export', label: 'Export', onSelect: onExport },
            ...(onExportWithRecords === undefined ? [] : [{ id: 'export-records', label: 'Export with records', disabled: !app.ok, onSelect: onExportWithRecords }]),
            { id: 'delete', label: 'Delete', danger: true, onSelect: onDelete },
          ]}
        />
      </div>
    </li>
  );
}
