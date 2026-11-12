// Settings of one page: title, web address, menu entry and the lists it shows. The whole next spec is validated before it is
// saved, and problems are shown under the part they belong to, in plain words.
import { useId, useMemo, useState } from 'react';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { ICONS } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, NavItem, Source, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import type { SaveResult } from '../types';
import { plainIssue, plainMessage } from '../lib/issueWords';
import { followTitle } from '../lib/followWords';
import { titleClash } from '../lib/pageRules';
import { validateSpec } from '../lib/validate';
import SourcesEditor from './SourcesEditor';
import { HINT_CLASS } from './ui';

export interface PageSettingsDialogProps {
  spec: AppSpec;
  pageId: string;
  onSave(next: AppSpec): Promise<SaveResult>;
  onCancel(): void;
}

type IconName = (typeof ICONS)[number];
const isIcon = (value: string): value is IconName => ICONS.some((i) => i === value);

const issuesAt = (issues: readonly SpecIssue[], path: string): SpecIssue[] => issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));

/** The problems under one input; `id` is what the input points at with aria-describedby. */
function Problems({ id, issues }: { id: string; issues: readonly SpecIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div id={id}>
      {issues.map((i) => (
        <p key={`${i.path}:${i.code}`} className={formErrorClass}>
          {plainMessage(i.message)}
        </p>
      ))}
    </div>
  );
}

const invalid = (id: string, issues: readonly SpecIssue[]): { 'aria-describedby'?: string; 'aria-invalid'?: true } =>
  issues.length === 0 ? {} : { 'aria-describedby': id, 'aria-invalid': true };

const capital = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

export default function PageSettingsDialog({ spec, pageId, onSave, onCancel }: PageSettingsDialogProps) {
  const uid = useId();
  const clashId = `${uid}-title-taken`;
  const original = spec.pages.find((p) => p.id === pageId);
  const originalNav = spec.nav.find((n) => n.pageId === pageId);
  const [title, setTitle] = useState(original?.title ?? '');
  const [route, setRoute] = useState(original?.route ?? '/');
  const [sources, setSources] = useState<Source[]>(original?.sources ?? []);
  const [inMenu, setInMenu] = useState(originalNav !== undefined);
  const [menuLabel, setMenuLabel] = useState(originalNav?.label ?? original?.title ?? '');
  const [icon, setIcon] = useState<IconName | ''>(originalNav?.icon ?? '');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const next = useMemo<AppSpec>(() => {
    const others = spec.nav.filter((n) => n.pageId !== pageId);
    const item: NavItem = icon === '' ? { pageId, label: menuLabel } : { pageId, label: menuLabel, icon };
    const nav = inMenu ? (originalNav ? spec.nav.map((n) => (n.pageId === pageId ? item : n)) : [...others, item]) : others;
    return { ...spec, pages: spec.pages.map((p) => (p.id === pageId ? { ...p, title, route, sources, layout: followTitle(p.layout, p.title, title) } : p)), nav };
  }, [spec, pageId, title, route, sources, inMenu, menuLabel, icon, originalNav]);

  // The menu label of a page in the menu follows the title while it still equals it; one the person worded stays.
  const onTitle = (value: string): void => {
    if (originalNav !== undefined) setMenuLabel((label) => (label === title ? value : label));
    setTitle(value);
  };

  const issues = useMemo(() => validateSpec(next).issues, [next]);
  const pageIndex = spec.pages.findIndex((p) => p.id === pageId);
  const navIndex = next.nav.findIndex((n) => n.pageId === pageId);
  if (!original) return null;
  const titleIssues = issuesAt(issues, `pages.${pageIndex}.title`);
  // Two pages with one title cannot be told apart in Design, so the title is refused here as Add a page refuses it.
  const clash = titleClash(spec, title, pageId);
  const routeIssues = issuesAt(issues, `pages.${pageIndex}.route`);
  const labelIssues = issuesAt(issues, `nav.${navIndex}.label`);
  const shown = [`pages.${pageIndex}.title`, `pages.${pageIndex}.route`, `pages.${pageIndex}.sources`, `nav.${navIndex}.label`];
  const unplaced = issues.filter((i) => !shown.some((p) => i.path === p || i.path.startsWith(`${p}.`)));

  const submit = async (): Promise<void> => {
    if (issues.length > 0 || clash !== null) return;
    setBusy(true);
    setSaveError(null);
    const result = await onSave(next);
    setBusy(false);
    if (!result.ok) setSaveError(result.message);
  };

  return (
    <Modal title="Page settings" onClose={onCancel} size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block">
              <span className={labelClass}>Title</span>
              <input className={inputClass} value={title} onChange={(e) => onTitle(e.target.value)} {...(clash === null ? invalid(`${uid}-title`, titleIssues) : { 'aria-describedby': clashId, 'aria-invalid': true as const })} />
            </label>
            <Problems id={`${uid}-title`} issues={titleIssues} />
            {clash !== null && (
              <p id={clashId} className={formErrorClass}>
                {clash}
              </p>
            )}
          </div>
          <div>
            <label className="block">
              <span className={labelClass}>Web address in the app</span>
              <input className={inputClass} value={route} disabled={original.route === '/'} onChange={(e) => setRoute(e.target.value)} {...invalid(`${uid}-route`, routeIssues)} />
            </label>
            {original.route === '/' && <span className={HINT_CLASS}>The home page is the first page the app opens.</span>}
            <Problems id={`${uid}-route`} issues={routeIssues} />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className={labelClass}>Menu</legend>
          <label className="flex items-center gap-2 text-sm text-slate-slate200">
            <input type="checkbox" checked={inMenu} onChange={(e) => setInMenu(e.target.checked)} />
            Show in the menu
          </label>
          {inMenu && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block">
                  <span className={labelClass}>Menu label</span>
                  <input className={inputClass} value={menuLabel} onChange={(e) => setMenuLabel(e.target.value)} {...invalid(`${uid}-menu`, labelIssues)} />
                </label>
                <Problems id={`${uid}-menu`} issues={labelIssues} />
              </div>
              <label className="block">
                <span className={labelClass}>Icon</span>
                <select className={inputClass} value={icon} onChange={(e) => setIcon(isIcon(e.target.value) ? e.target.value : '')}>
                  <option value="">None</option>
                  {ICONS.map((name) => (
                    <option key={name} value={name}>
                      {capital(name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </fieldset>

        <SourcesEditor spec={next} page={next.pages[pageIndex]} sources={sources} issues={issues} onChange={setSources} />

        {issues.length > 0 && (
          <p role="alert" className={formErrorClass}>
            {issues.length === 1 ? 'Fix 1 problem to save.' : `Fix ${issues.length} problems to save.`}
            {unplaced.slice(0, 3).map((i) => (
              <span key={`${i.path}:${i.code}`} className="block">
                {plainIssue(i, next)}
              </span>
            ))}
          </p>
        )}
        {saveError && (
          <p role="alert" className={formErrorClass}>
            {saveError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || issues.length > 0 || clash !== null}>
            {busy ? 'Saving...' : 'Save page settings'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
