// One tile of the showcase, the same for a built-in part and a saved feature: preview, name, one line, category chip,
// settings chips and a menu. Only the category chip and the menu items differ.
import { Suspense, lazy, useId } from 'react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';
import type { FeatureLibrary } from '@/catalog/features';
import type { Theme } from '@local-app-studio/runtime/spec/schema';
import { PILL, TONE_CLASS } from '@/components/settings/pillStyles.js';
import ActionMenu from '../components/ActionMenu';
import ConnectionBadge from '../design/ConnectionBadge';
import { CATEGORY_LABELS } from './entries';
import type { ShowcaseEntry } from './entries';
import { FRAME_CLASS } from './frame';
import type { SearchHit } from './search';
import { entryShowsData } from './usesData';

const PreviewFrame = lazy(() => import('./PreviewFrame'));

export interface TileAction {
  id: string;
  label: string;
  onSelect(trigger: HTMLButtonElement): void;
  disabled?: boolean;
  danger?: boolean;
}

export interface FeatureTileProps {
  entry: ShowcaseEntry;
  library: FeatureLibrary;
  size: 'md' | 'sm';
  onOpen(): void;
  /** Accessible name of the body button. Default: "Show details for {name}". */
  openLabel?: string;
  /** In order: Details, Use in app, then Edit, Duplicate, Export, Delete for your own features. */
  actions: TileAction[];
  theme?: Theme;
  selected?: boolean;
  footer?: ReactNode;
  /** Parts of the name to highlight (from a search). */
  nameRanges?: SearchHit['nameRanges'];
  /** False takes the body button out of the Tab order (the shelf: its Add button is the one Tab stop of the tile). Default true. */
  openFocusable?: boolean;
  /** The shelf makes the list item itself the drag source: its ref, its handlers and a dimmed look while dragging. */
  itemRef?: Ref<HTMLLIElement>;
  itemProps?: HTMLAttributes<HTMLLIElement>;
  dimmed?: boolean;
  /** True draws the Needs a table pill. Undefined: the Features page default, every entry that draws rows (there is no app to connect it to). */
  needsTable?: boolean;
}

/** The name with the matched parts in a mark. */
function HighlightedName({ name, ranges }: { name: string; ranges: SearchHit['nameRanges'] }) {
  if (ranges.length === 0) return <>{name}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(name.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-accent-amber/25 text-inherit">
        {name.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < name.length) parts.push(name.slice(at));
  return <>{parts}</>;
}

/** "Used in 2 apps" for a saved feature, from the usage data; null for a part. */
function usedInText(n: number | null): string | null {
  if (n === null) return null;
  if (n === 0) return 'Not used in an app yet';
  return `Used in ${n} ${n === 1 ? 'app' : 'apps'}`;
}

export default function FeatureTile({ entry, library, size, onOpen, openLabel, actions, theme, selected = false, footer, nameRanges = [], openFocusable = true, itemRef, itemProps, dimmed = false, needsTable }: FeatureTileProps) {
  const descId = useId();
  const sampleId = `${descId}-sample`;
  const needsId = `${descId}-needs`;
  const compact = size === 'sm';
  const sample = entryShowsData(entry, library);
  const needs = needsTable ?? sample;
  return (
    <li
      {...itemProps}
      ref={itemRef}
      className={`glass-subtle glass-hover relative flex h-full flex-col rounded-lg ${dimmed ? 'opacity-40' : ''} ${selected ? 'ring-2 ring-slate-brandLight forced-colors:outline forced-colors:outline-2' : ''}`}
      data-testid="feature-tile"
      data-entry-key={entry.key}
    >
      {/* The preview is a sibling of the body button (a button must not contain interactive parts). It is inert, hidden from
          assistive tech and ignores the pointer, so a click on it reaches the stretched ::after of the body button below. */}
      <div aria-hidden="true" className="pointer-events-none p-3 pb-0 pr-12">
        <Suspense fallback={<div className={`w-full animate-pulse rounded-md bg-slate-slate700/40 ${FRAME_CLASS[size]}`} />}>
          <PreviewFrame entry={entry} library={library} size={size} theme={theme} />
        </Suspense>
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel ?? `Show details for ${entry.name}`}
        // The name is the aria-label (it overrides the text inside), so "Sample data" is a description, read after the name. The visible badge sits under the picture beside the category chip.
        aria-describedby={[compact ? '' : descId, sample ? sampleId : '', needs ? needsId : ''].filter((id) => id !== '').join(' ') || undefined}
        aria-pressed={selected ? true : undefined}
        tabIndex={openFocusable ? undefined : -1}
        className="flex w-full flex-1 flex-col rounded-lg px-3 pb-3 pt-2 text-left focus-visible:outline-hidden after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-slate-brandLight"
      >
        <span className="block break-words line-clamp-2 text-sm font-semibold text-slate-slate100">
          <HighlightedName name={entry.name} ranges={nameRanges} />
          {sample && (
            <span id={sampleId} className="sr-only">
              Sample data
            </span>
          )}
          {needs && (
            <span id={needsId} className="sr-only">
              Needs a table
            </span>
          )}
        </span>
        {!compact && (
          <span id={descId} className="mt-1 block line-clamp-3 text-sm text-slate-slate300">
            {entry.description}
          </span>
        )}
        <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          <span className={`${PILL} ${TONE_CLASS.muted}`}>{CATEGORY_LABELS[entry.category]}</span>
          {sample && (
            <span aria-hidden="true" data-sample-badge="" className={`${PILL} ${TONE_CLASS.muted}`}>
              Sample data
            </span>
          )}
          {needs && <ConnectionBadge indicator={{ state: 'needs_table', text: 'Needs a table', offer: null, target: 'props.table' }} size="sm" />}
          {entry.status === 'needs_repair' && <span className={`${PILL} ${TONE_CLASS.warn}`}>Needs repair</span>}
        </span>
        {!compact && usedInText(entry.usedInApps) !== null && <span className="mt-2 block text-xs text-slate-slate400">{usedInText(entry.usedInApps)}</span>}
        {!compact && entry.params.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {entry.params.map((p) => (
              <span key={`${p.label}:${p.words}`} className="rounded bg-slate-slate700/40 px-1.5 py-0.5 text-xs text-slate-slate300">{`${p.label}: ${p.words}`}</span>
            ))}
          </span>
        )}
      </button>
      {actions.length > 0 && (
        <div className="absolute right-4 top-4 z-10 rounded-md bg-slate-slate900/60">
          <ActionMenu label={`More actions for ${entry.name}`} menuLabel={`Actions for ${entry.name}`} items={actions} />
        </div>
      )}
      {footer !== undefined && footer !== null && <div className="relative z-10">{footer}</div>}
    </li>
  );
}
