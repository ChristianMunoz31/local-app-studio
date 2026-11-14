// The left pane of Design: built-in parts and your saved features as tiles you drag onto the page, or add with the Add
// button at the place chosen with "Add here". Previews are drawn in the app's own look. The search, the categories and the
// count are the ones of the Features page (showcase/SearchField, CategoryPills, ResultCount), so the same words give the same
// names in the same order in both places. Each tile is one Tab stop: its Add button.
import { useDraggable } from '@dnd-kit/core';
import { Fragment, memo, useCallback, useContext, useEffect, useId, useMemo, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { FeatureLibrary } from '@/catalog/features';
import type { Theme } from '@local-app-studio/runtime/spec/schema';
import { btnSecondary } from '@/components/shared/formStyles.js';
import { FOCUS_RING, HINT_CLASS, POPOVER_CLASS } from '../components/ui';
import CategoryPills from '../showcase/CategoryPills';
import RecentRow from '../showcase/RecentRow';
import ResultCount, { NoResults } from '../showcase/ResultCount';
import SearchField from '../showcase/SearchField';
import { categoryCounts, groupHits, searchEntries } from '../showcase/search';
import type { CategoryChoice, SearchHit } from '../showcase/search';
import { fitsMenu } from '../lib/menuTree';
import { shelfEntries } from './shelfEntries';
import type { ShowcaseEntry } from '../showcase/entries';
import FeatureTile from '../showcase/FeatureTile';
import { DesignContext } from './DesignContext';
import { entryNeedsTable } from './indicator';
import ThemePicker from '../theme/ThemePicker';
import type { FeatureRecord } from '../types';

export type ShelfCategory = CategoryChoice;

export type ShelfTab = 'features' | 'look';

export interface ShelfFilters {
  category: ShelfCategory;
  query: string;
}

interface PaletteTileProps {
  entry: ShowcaseEntry;
  library: FeatureLibrary;
  theme: Theme;
  selected: boolean;
  nameRanges: SearchHit['nameRanges'];
  onSelect(key: string): void;
  onAdd(entry: ShowcaseEntry): void;
  needsTable: boolean;
}

/** The hook is here and the tile is a memo: dnd-kit re-renders every draggable as the pointer passes over the page, and a tile's preview is not cheap. */
function PaletteTile(props: PaletteTileProps) {
  const { entry } = props;
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `palette:${entry.key}`, data: { kind: 'palette', key: entry.key }, disabled: entry.status === 'needs_repair' });
  return <TileBody {...props} setNodeRef={setNodeRef} listeners={listeners} isDragging={isDragging} />;
}

const TileBody = memo(function TileBody({ entry, library, theme, selected, nameRanges, onSelect, onAdd, needsTable, setNodeRef, listeners, isDragging }: PaletteTileProps & Pick<ReturnType<typeof useDraggable>, 'setNodeRef' | 'listeners' | 'isDragging'>) {
  const damaged = entry.status === 'needs_repair';
  return (
    // The tile is a list item of the group's list and is itself the drag source.
    <FeatureTile
      entry={entry}
      library={library}
      needsTable={needsTable}
      size="sm"
      theme={theme}
      selected={selected}
      nameRanges={nameRanges}
      openLabel={`Select ${entry.name}`}
      openFocusable={false}
      onOpen={() => onSelect(entry.key)}
      actions={[]}
      itemRef={setNodeRef}
      itemProps={listeners}
      dimmed={isDragging}
      footer={
        <div className="px-3 pb-3">
          {damaged ? (
            <p className={HINT_CLASS}>Damaged, so it cannot be added.</p>
          ) : (
            <>
              {fitsMenu(entry) && <p className={`mb-1 ${HINT_CLASS}`}>Fits the menu</p>}
              <button type="button" className={`${btnSecondary} w-full`} aria-label={`Add ${entry.name}`} onClick={() => onAdd(entry)}>
                Add
              </button>
            </>
          )}
        </div>
      }
    />
  );
});

interface FeaturesPaneProps {
  features: readonly FeatureRecord[];
  library: FeatureLibrary;
  theme: Theme;
  filters: ShelfFilters;
  onFilters(next: ShelfFilters): void;
  selectedKey: string | null;
  onSelect(key: string): void;
  onAdd(entry: ShowcaseEntry): void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** The line telling where the next Add goes, or null. */
  note: string | null;
}

/** A callback that keeps its identity and calls the newest one, so a memo that holds it is not drawn again for a new closure. */
function useStable<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

function FeaturesPane({ features, library, theme, filters, onFilters, selectedKey, onSelect, onAdd, searchRef, note }: FeaturesPaneProps) {
  const design = useContext(DesignContext);
  // The tiles hold a live preview each: they are drawn again only when their own entry changes, not for every render of the session.
  const select = useStable(onSelect);
  const add = useStable(onAdd);
  const hides = design?.builder?.hidesEntry;
  const entries = useMemo(() => shelfEntries(features).filter((e) => hides === undefined || !hides(e.key)), [features, hides]);
  const shown = useMemo(() => searchEntries(entries, { ...filters, sort: 'default' }), [entries, filters]);
  const groups = useMemo(() => groupHits(shown), [shown]);
  const counts = useMemo(() => categoryCounts(entries, filters.query), [entries, filters.query]);
  const showRecent = filters.query.trim() === '' && filters.category === 'all';

  return (
    <div className="space-y-3">
      <SearchField value={filters.query} onChange={(query) => onFilters({ ...filters, query })} inputRef={searchRef} id="shelf-search" />
      <CategoryPills value={filters.category} counts={counts} onChange={(category) => onFilters({ ...filters, category })} />
      {note !== null && (
        <p className={`${POPOVER_CLASS} px-3 py-2 text-xs text-slate-slate100`}>
          {note}
        </p>
      )}
      {showRecent && <RecentRow entries={entries} onPick={onAdd} labelFor={(e) => `Recently used: ${e.name}. Add it to the page`} />}
      <ResultCount count={shown.length} />
      {shown.length === 0 && <NoResults query={filters.query} noOwn={features.length === 0 && filters.category === 'custom'} onClear={() => onFilters({ ...filters, query: '' })} />}
      {groups.map((g) => (
        <section key={g.category} aria-label={g.label} className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-widest text-slate-slate400">{`${g.label} (${g.count})`}</h3>
          {g.subgroups.map((sub) => (
            <Fragment key={sub.id ?? 'all'}>
              {sub.label !== null && <h4 className="text-xs font-semibold text-slate-slate300">{`${sub.label} (${sub.count})`}</h4>}
              <ul className="space-y-2">
                {sub.hits.map(({ entry, nameRanges }) => (
                  <PaletteTile key={entry.key} entry={entry} library={library} theme={theme} selected={selectedKey === entry.key} nameRanges={nameRanges} onSelect={select} onAdd={add} needsTable={entryNeedsTable(entry, library, design?.ctx ?? null)} />
                ))}
              </ul>
            </Fragment>
          ))}
        </section>
      ))}
    </div>
  );
}

interface Props extends FeaturesPaneProps {
  tab: ShelfTab;
  onTab(next: ShelfTab): void;
  onTheme(next: Theme): void;
  /** More controls for the Look panel, shown above the theme picker (the menu bar). */
  lookExtra?: ReactNode;
}

const TABS: ReadonlyArray<{ id: ShelfTab; label: string }> = [
  { id: 'features', label: 'Features' },
  { id: 'look', label: 'Look' },
];

/** Two tabs: the parts and features to add to the page, and the look of the whole app (applied to the canvas as you pick). */
export default function FeatureShelf({ tab, onTab, onTheme, lookExtra, ...pane }: Props) {
  const uid = useId();
  const inBuilder = useContext(DesignContext)?.builder !== undefined;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tab === 'features' ? 'look' : 'features';
    onTab(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  };
  return (
    <div className="space-y-3">
      {inBuilder ? (
        <FeaturesPane {...pane} />
      ) : (
        <>
          <div role="tablist" aria-label="Shelf" title="Use the arrow keys to switch" className="flex gap-1 border-b border-slate-slate700/60" onKeyDown={onKeyDown}>
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`${uid}-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`${uid}-panel`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => onTab(t.id)}
                className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${FOCUS_RING} ${
                  tab === t.id ? 'border-accent-indigo text-slate-slate100' : 'border-transparent text-slate-slate400 hover:text-slate-slate100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
            {tab === 'features' ? (
              <FeaturesPane {...pane} />
            ) : (
              <>
                {lookExtra}
                <ThemePicker value={pane.theme} onChange={onTheme} idPrefix={`${uid}-look`} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
