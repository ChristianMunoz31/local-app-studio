// Features: every building block in one place. Built-in parts and your own saved features look the same (a preview,
// a name, one line) and are found by category or search. Your own features also have edit, duplicate, export and delete.
// The search, the categories and the count are the ones of the Design shelf, so both give the same names in the same order.
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Plus, Puzzle, Upload } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import StudioSectionCard from '@/studio/components/StudioSectionCard';
import { Skeleton } from '@/components/shared/Skeleton.jsx';
import { btnPrimary, btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import { HelpButton } from '../components/HelpSheet';
import IssueList from '../components/IssueList';
import { FOCUS_RING, SUMMARY_CLASS } from '../components/ui';
import StudioConfirm from '../components/StudioConfirm';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useFeatures } from '../hooks/useFeatures';
import { downloadJson } from '../lib/download';
import { builderRefusalWords } from '../builder/featureRefusal';
import { featureFileOf } from '../lib/featureFromSelection';
import { StudioApiError, featuresApi } from '../services/studioApi';
import FeatureDrawer from '../showcase/FeatureDrawer';
import FeatureTile from '../showcase/FeatureTile';
import type { TileAction } from '../showcase/FeatureTile';
import ShowcaseFilters from '../showcase/ShowcaseFilters';
import { NoResults } from '../showcase/ResultCount';
import RecentRow from '../showcase/RecentRow';
import UseInAppDialog from '../showcase/UseInAppDialog';
import { CATEGORY_LABELS, buildShowcaseEntries } from '../showcase/entries';
import { categoryCounts, groupHits, parseCategory, parseSort, searchEntries } from '../showcase/search';
import type { CategoryChoice, SortChoice } from '../showcase/search';
import type { ShowcaseEntry } from '../showcase/entries';
import type { FeatureRecord, FeatureUsage } from '../types';

const MAX_FILE_BYTES = 256 * 1024;
const messageOf = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);
const GRID = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3';
const MAX_QUERY_CHARS = 100;
const FEATURE_FILE_PROBLEMS = 'This feature file has problems, so nothing was imported. Ask the person who sent it for a new export.';
const SHOW_WHAT_IS_WRONG = 'Show what is wrong';
const NO_FEATURES_YET = 'No features yet. Press New feature, or in Design select a part and choose Save as feature.';
const alreadyInLibrary = (name: string): string => `${name} is already in your library. Nothing was added.`;
const usedBySentence = (label: string, usage: FeatureUsage): string => {
  const users = [...usage.apps.map((a) => a.name), ...usage.features.map((f) => `${f.label} (feature)`)];
  const list = users.length > 1 ? `${users.slice(0, -1).join(', ')} and ${users[users.length - 1]}` : (users[0] ?? 'an app');
  return `${label} is used by ${list}. Remove it there first.`;
};
const NOT_A_FEATURE_FILE = 'That file is not a feature file. Pick a feature file exported from Local App Studio.';

export default function FeaturesPage() {
  useDocumentTitle('Features, Local App Studio');
  const { features, library, loading, error, reload } = useFeatures();
  // The view lives in the address bar (?q=&cat=&sort=) so Back returns to it. Bad values fall back to the defaults.
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').slice(0, MAX_QUERY_CHARS);
  const category = parseCategory(params.get('cat'));
  const sort = parseSort(params.get('sort'));
  // What is typed lives in local state and the address bar follows it. setParams is a navigation that lands later, so an
  // input bound to the address bar snaps back to the old value under load and loses keystrokes (Escape then showed the last
  // letter). Only an outside change of the address (Back, a link) replaces the draft: every address this page writes is
  // remembered until it lands, and a landing that was written here is ignored.
  const [draft, setDraft] = useState(query);
  const written = useRef<string[]>([]);
  const paramsKey = params.toString();
  useEffect(() => {
    const i = written.current.indexOf(paramsKey);
    if (i >= 0) {
      written.current.splice(0, i + 1);
      return;
    }
    setDraft(query);
  }, [paramsKey, query]);
  const setView = (next: { q?: string; cat?: CategoryChoice; sort?: SortChoice }): void => {
    const q = next.q ?? draft;
    const cat = next.cat ?? category;
    const order = next.sort ?? sort;
    const out = new URLSearchParams();
    if (q !== '') out.set('q', q);
    if (cat !== 'all') out.set('cat', cat);
    if (order !== 'default') out.set('sort', order);
    written.current.push(out.toString());
    setParams(out, { replace: true });
  };
  const setQuery = (q: string): void => {
    const cut = q.slice(0, MAX_QUERY_CHARS);
    setDraft(cut);
    setView({ q: cut });
  };
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<ShowcaseEntry | null>(null);
  const [using, setUsing] = useState<ShowcaseEntry | null>(null);
  const [deleting, setDeleting] = useState<FeatureRecord | null>(null);
  const [blocked, setBlocked] = useState<{ label: string; usage: FeatureUsage } | null>(null);
  const [actionError, setActionError] = useState('');
  const [issues, setIssues] = useState<SpecIssue[]>([]);
  /** The refused import's problems in plain sentences (a damaged file never shows a path or a part id). */
  const [refusalList, setRefusalList] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  /** True when the import was refused with a list of problems: the lead sentence is fixed and the list sits in a fold. */
  const [refused, setRefused] = useState(false);
  /** Counts the messages that need to be seen: each one is scrolled into view and focused. */
  const [attention, setAttention] = useState(0);
  const messageRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const deleteOpener = useRef<HTMLElement | null>(null);

  const entries = useMemo(() => buildShowcaseEntries(features), [features]);
  const shown = useMemo(() => searchEntries(entries, { category, query, sort }), [entries, category, query, sort]);
  const groups = useMemo(() => groupHits(shown), [shown]);
  const counts = useMemo(() => categoryCounts(entries, query), [entries, query]);
  const searching = query.trim() !== '';

  // "/" jumps to the search box, unless the person is typing somewhere or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // With nothing of your own saved, Your features says how to make one (unless a search or another category is active).
  const showNoCustom = !error && features.length === 0 && !searching && (category === 'all' || category === 'custom');

  // A refusal or a blocked delete can appear far from the person's eye: bring it into view and move focus to it.
  useEffect(() => {
    if (attention === 0) return;
    const box = messageRef.current;
    if (box === null) return;
    box.scrollIntoView?.({ block: 'center' });
    box.focus({ preventScroll: true });
  }, [attention]);

  const guard = async (action: () => Promise<void>, fallback: string, refusal?: string): Promise<void> => {
    setActionError('');
    setNotice('');
    setIssues([]);
    setRefusalList([]);
    setRefused(false);
    setBlocked(null);
    try {
      await action();
    } catch (err) {
      if (refusal !== undefined && err instanceof StudioApiError && err.issues.length > 0) {
        setActionError(refusal);
        setRefusalList(builderRefusalWords(err.issues));
        setRefused(true);
      } else {
        setActionError(messageOf(err, fallback));
        if (err instanceof StudioApiError) setIssues(err.issues);
      }
      setAttention((n) => n + 1);
    }
  };

  const onExport = (feature: FeatureRecord): void => {
    const file = featureFileOf(feature.id, features);
    if (file) downloadJson(`${feature.id}.feature.json`, file);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await guard(async () => {
      if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large. A feature file can be up to 256 KB.');
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(NOT_A_FEATURE_FILE);
      }
      const known = new Set(features.map((f) => f.id));
      const result = await featuresApi.importFile(parsed);
      await reload();
      // The server answers with the features the file stands for. One that was already stored, unchanged, keeps its id and
      // nothing is renamed; a changed one is stored under a new id. So all ids known before and no rename means nothing was added.
      const last = result.imported[result.imported.length - 1];
      if (last !== undefined && result.renamed.length === 0 && result.imported.every((r) => known.has(r.id))) {
        setNotice(alreadyInLibrary(last.label));
        return;
      }
      const names = result.imported.map((r) => `"${r.label}"`).join(', ');
      const renamed = result.renamed.map((r) => `${r.from} is now ${r.to}`).join(', ');
      setNotice(`Imported ${names}.${renamed ? ` Renamed: ${renamed}.` : ''}`);
    }, 'Could not import the feature file. Nothing was changed. Try again.', FEATURE_FILE_PROBLEMS);
  };

  const confirmDelete = async (feature: FeatureRecord): Promise<void> => {
    try {
      await featuresApi.remove(feature.id);
    } catch (err) {
      if (err instanceof StudioApiError && err.code === 'feature_in_use') {
        setBlocked({ label: feature.label, usage: err.inUse ?? { apps: [], features: [] } });
        setAttention((n) => n + 1);
        setDeleting(null);
        return;
      }
      throw err;
    }
    await reload();
    deleteOpener.current = document.getElementById(headingId);
    setDeleting(null);
  };

  const askDelete = (feature: FeatureRecord, trigger: HTMLElement | null): void => {
    deleteOpener.current = trigger;
    setBlocked(null);
    // Use is known from the library: say so now instead of offering a Delete that is refused afterwards.
    if (feature.usedBy.apps.length > 0 || feature.usedBy.features.length > 0) {
      setActionError('');
      setIssues([]);
      setNotice('');
      setBlocked({ label: feature.label, usage: feature.usedBy });
      setAttention((n) => n + 1);
      return;
    }
    setDeleting(feature);
  };

  const actionsFor = (entry: ShowcaseEntry): TileAction[] => {
    const base: TileAction[] = [
      { id: 'details', label: 'Details', onSelect: () => setDetail(entry) },
      { id: 'use', label: 'Use in app', disabled: entry.status !== 'ok', onSelect: () => setUsing(entry) },
    ];
    const feature = entry.feature;
    if (entry.kind !== 'feature' || feature === undefined) return base;
    return [
      ...base,
      { id: 'edit', label: 'Edit', disabled: !feature.ok, onSelect: () => navigate(`/features/${encodeURIComponent(feature.id)}/edit`) },
      {
        id: 'duplicate',
        label: 'Duplicate',
        disabled: !feature.ok,
        onSelect: () => void guard(async () => (await featuresApi.duplicate(feature.id), await reload()), 'Could not duplicate the feature. Nothing was changed. Try again.'),
      },
      { id: 'export', label: 'Export', disabled: !feature.ok, onSelect: () => onExport(feature) },
      { id: 'delete', label: 'Delete', danger: true, onSelect: (trigger) => askDelete(feature, trigger) },
    ];
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <StudioSectionCard
        title="Features"
        headingId={headingId}
        icon={Puzzle}
        subtitle="The parts of every page. Your own features are shared by all your apps."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-label="Feature file" data-testid="feature-file" onChange={(e) => void onImport(e)} />
            <button type="button" className={btnPrimary} onClick={() => navigate('/features/new')}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} aria-hidden="true" />
                New feature
              </span>
            </button>
            <button type="button" className={btnSecondary} onClick={() => fileRef.current?.click()}>
              <span className="inline-flex items-center gap-1.5">
                <Upload size={14} aria-hidden="true" />
                Import a feature
              </span>
            </button>
            <HelpButton />
          </div>
        }
      >
        {error && (
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <p role="alert" className={formErrorClass}>
              {error}
            </p>
            <button type="button" className={btnSecondary} onClick={() => void reload()}>
              Try again
            </button>
          </div>
        )}
        <div
          ref={messageRef}
          tabIndex={-1}
          role="group"
          aria-label="Messages"
          className={`rounded-md ${FOCUS_RING}`}
        >
          {actionError && (
            <div className="mb-2 space-y-2">
              <p role="alert" className={formErrorClass}>
                {actionError}
              </p>
              {refused ? (
                <details>
                  <summary className={SUMMARY_CLASS}>{SHOW_WHAT_IS_WRONG}</summary>
                  <div className="mt-2">
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-slate200">
                      {refusalList.map((sentence) => (
                        <li key={sentence}>{sentence}</li>
                      ))}
                    </ul>
                  </div>
                </details>
              ) : (
                <IssueList issues={issues} max={5} />
              )}
            </div>
          )}
          {notice && (
            <p role="status" className="mb-2 text-sm text-accent-green">
              {notice}
            </p>
          )}
          {blocked && (
            <p role="alert" className="mb-3 text-sm text-accent-red">
              {usedBySentence(blocked.label, blocked.usage)}
            </p>
          )}
        </div>
        <ShowcaseFilters
          category={category}
          query={draft}
          sort={sort}
          counts={counts}
          onCategory={(cat) => setView({ cat })}
          onQuery={setQuery}
          onSort={(next) => setView({ sort: next })}
          searchRef={searchRef}
          shown={shown.length}
        />
        {!loading && !searching && category === 'all' && (
          <div className="mb-4">
            <RecentRow entries={entries} onPick={setDetail} labelFor={(e) => `Recently used: ${e.name}. Show details`} />
          </div>
        )}
        {loading ? (
          <ul className={GRID} role="status" aria-label="Loading features" data-testid="features-loading">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="glass-subtle space-y-2 rounded-lg p-3">
                <Skeleton className="aspect-video w-full" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </li>
            ))}
          </ul>
        ) : shown.length === 0 && !showNoCustom ? (
          <NoResults query={query} noOwn={features.length === 0 && category === 'custom'} onClear={() => setQuery('')} />
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.category} aria-label={g.label}>
                <h3 className="mb-2 text-[10px] uppercase tracking-widest text-slate-slate400">{`${g.label} (${g.count})`}</h3>
                {g.subgroups.map((sub) => (
                  <Fragment key={sub.id ?? 'all'}>
                    {sub.label !== null && <h4 className="mb-2 mt-3 text-xs font-semibold text-slate-slate300">{`${sub.label} (${sub.count})`}</h4>}
                    <ul className={GRID}>
                      {sub.hits.map(({ entry, nameRanges }) => (
                        <FeatureTile key={entry.key} entry={entry} library={library} size="md" nameRanges={nameRanges} onOpen={() => setDetail(entry)} actions={actionsFor(entry)} />
                      ))}
                    </ul>
                  </Fragment>
                ))}
              </section>
            ))}
            {showNoCustom && !groups.some((g) => g.category === 'custom') && (
              <section aria-label={CATEGORY_LABELS.custom}>
                <h3 className="mb-2 text-[10px] uppercase tracking-widest text-slate-slate400">{CATEGORY_LABELS.custom}</h3>
                <p className="text-sm text-slate-slate400">{NO_FEATURES_YET}</p>
              </section>
            )}
          </div>
        )}
      </StudioSectionCard>
      {detail && (
        <FeatureDrawer
          entry={detail}
          library={library}
          onClose={() => setDetail(null)}
          onUse={() => {
            setUsing(detail);
          }}
          onDelete={
            detail.feature === undefined
              ? undefined
              : () => {
                  const feature = detail.feature;
                  setDetail(null);
                  if (feature !== undefined) askDelete(feature, document.getElementById(headingId));
                }
          }
        />
      )}
      {using && <UseInAppDialog entry={using} onClose={() => setUsing(null)} />}
      {deleting && (
        <StudioConfirm
          title={`Delete ${deleting.label}?`}
          message="The feature is removed from your library. Apps that do not use it are not affected."
          confirmLabel="Delete feature"
          busyLabel="Deleting..."
          cancelLabel="Keep feature"
          finalFocusRef={deleteOpener}
          onConfirm={() => confirmDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
