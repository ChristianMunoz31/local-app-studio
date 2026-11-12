// "Save selection as feature": name, description for the helper, and which values in the selection become settings.
// On success the selection is replaced by its own expansion, so it becomes a block of the saved feature.
import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { FEATURE_LIMITS } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import type { PartContext } from '@/catalog/types';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { buildFeatureInput, defaultChoices, featureIdFor, groupNote, slotGroups, valuesOf } from '../lib/featureFromSelection';
import type { AppWords } from '../lib/featureFromSelection';
import { layerIds } from '../lib/layout';
import { PLACEHOLDER_WARNING, hasPlaceholderText } from '../lib/placeholderText';
import { newFeatureLayer } from '../lib/layoutTree';
import { libraryOf } from '../hooks/useFeatures';
import { StudioApiError, featuresApi } from '../services/studioApi';
import type { FeatureInput, FeatureRecord } from '../types';
import IssueList from './IssueList';
import { HINT_CLASS } from './ui';
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';

interface Props {
  /** The part being saved, as it is on the page. */
  selection: LayoutLayer;
  /** The whole page layout: the ids and the room the replacement works from. */
  root: LayoutLayer;
  features: readonly FeatureRecord[];
  library: FeatureLibrary;
  ctx: PartContext;
  /** The app's tables and pages, so a row reads "List: Open crews" instead of the stored name. Without it the stored names show. */
  spec?: AppWords | null;
  /** The selection as a block of the saved feature, or null when it could not be placed again (the feature is saved anyway), and the saved feature. */
  onSaved(replacement: LayoutLayer | null, saved: FeatureRecord): void;
  onCancel(): void;
  /** Opens the feature in the builder instead of saving it here. Without it the button is not shown. */
  onOpenBuilder?(input: FeatureInput): void;
}

const MY_FEATURE = 'My feature';
export default function SaveFeatureDialog({ selection, root, features, library, ctx, spec = null, onSaved, onCancel, onOpenBuilder }: Props) {
  const descId = useId();
  const { groups, droppedLists } = useMemo(() => slotGroups(selection, library), [selection, library]);
  const defaults = useMemo(() => defaultChoices(groups, library), [groups, library]);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [names, setNames] = useState(() => Object.fromEntries(defaults.params.map((p) => [p.group, { name: p.name, label: p.label }])));
  const [mode, setMode] = useState<'new' | 'replace'>('new');
  const editable = features.filter((f) => f.ok);
  // Nothing is preselected: replacing is a choice, never a default.
  const [replaceId, setReplaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<SpecIssue[]>([]);

  const chosen = groups.filter((g) => g.forced || ticked.has(g.key));
  // The name inside is never shown: it is made from the name of the feature, or it is the feature being replaced.
  const idFor = (name: string): string => (mode === 'replace' ? replaceId : featureIdFor(name.trim() === '' ? 'my feature' : name, library));

  const toggle = (key: string): void =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setLabelOf = (key: string, value: string): void => setNames((prev) => ({ ...prev, [key]: { ...prev[key], label: value } }));

  // The selection becomes a block of the saved feature, with the values it already had.
  const replacementFor = (record: FeatureRecord, values: Record<string, string>): LayoutLayer | null => {
    const def = libraryOf([record]).get(record.id);
    if (def === undefined) return null;
    const lib = new Map(library);
    lib.set(record.id, def);
    const taken = layerIds(root);
    for (const old of layerIds(selection)) taken.delete(old);
    const expanded = newFeatureLayer(def, values, ctx, lib, taken, selection.id);
    return expanded.ok ? expanded.value : null;
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setMessage('');
    setIssues([]);
    if (label.trim() === '') return setMessage('Give the feature a name.');
    if (description.trim() === '') return setMessage('Say in one sentence what the feature is for, so the helper knows when to use it.');
    if (mode === 'replace' && replaceId === '') return setMessage('Pick the feature to replace.');
    if (chosen.length > FEATURE_LIMITS.params) return setMessage(`A feature can let people change up to ${FEATURE_LIMITS.params} things. Untick some texts.`);
    const choices = {
      id: idFor(label),
      label: label.trim(),
      description: description.trim(),
      params: chosen.map((g) => ({ group: g.key, name: names[g.key].name, label: names[g.key].label.trim() })),
    };
    const input = buildFeatureInput(selection, choices, library);
    const base = mode === 'replace' ? features.find((f) => f.id === replaceId) : undefined;
    setBusy(true);
    try {
      const record = base ? await featuresApi.update(base.id, input, base.version) : await featuresApi.create(input);
      onSaved(replacementFor(record, valuesOf(groups, choices)), record);
    } catch (err) {
      setMessage(err instanceof Error && err.message ? err.message : 'Could not save the feature. Nothing was changed. Try again.');
      if (err instanceof StudioApiError) setIssues(err.issues);
      setBusy(false);
    }
  };

  /** The feature as it is now, for the builder: "My feature" stands in for a name and a line that are not typed yet. */
  const openBuilder = (): void => {
    if (chosen.length > FEATURE_LIMITS.params) return setMessage(`A feature can let people change up to ${FEATURE_LIMITS.params} things. Untick some texts.`);
    const choices = {
      id: idFor(label),
      label: label.trim() === '' ? MY_FEATURE : label.trim(),
      description: description.trim() === '' ? MY_FEATURE : description.trim(),
      params: chosen.map((g) => ({ group: g.key, name: names[g.key].name, label: names[g.key].label.trim() })),
    };
    onOpenBuilder?.(buildFeatureInput(selection, choices, library));
  };

  return (
    <Modal title="Save as feature" onClose={onCancel} size="lg" dismissible={!busy}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)}>
        <label className="block">
          <span className={labelClass}>Name</span>
          <input className={inputClass} value={label} maxLength={FEATURE_LIMITS.labelChars} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        <div>
          <label htmlFor={descId} className={labelClass}>
            What it is for (the helper reads this to know when to use it)
          </label>
          <textarea
            id={descId}
            aria-describedby={`${descId}-hint`}
            className={inputClass}
            rows={2}
            value={description}
            maxLength={FEATURE_LIMITS.descriptionChars}
            onChange={(e) => setDescription(e.target.value.replace(/\s+/g, ' '))}
          />
          <p id={`${descId}-hint`} className={`mt-1 flex justify-between ${HINT_CLASS}`}>
            <span>One sentence: what it shows and when to use it.</span>
            <span>{`${description.length} of ${FEATURE_LIMITS.descriptionChars}`}</span>
          </p>
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-bold text-slate-slate100">What people can change when they add it</legend>
          {groups.length === 0 && <p className="text-sm text-slate-slate400">This part has nothing people need to change.</p>}
          {groups.map((g) => {
            const on = g.forced || ticked.has(g.key);
            const box = `save-feature-${g.key}`;
            return (
              <div key={g.key} className="glass-subtle space-y-2 rounded-lg p-3">
                <label className="flex items-center gap-2 text-sm text-slate-slate100">
                  <input id={box} type="checkbox" checked={on} disabled={g.forced} onChange={() => toggle(g.key)} />
                  <span>{groupNote(g, groups, spec)}</span>
                  {g.forced && <span className="text-xs text-slate-slate400">Always a setting</span>}
                </label>
                {on && names[g.key] && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className={labelClass}>Label</span>
                      <input className={inputClass} value={names[g.key].label} maxLength={FEATURE_LIMITS.labelChars} onChange={(e) => setLabelOf(g.key, e.target.value)} />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
          {droppedLists.length > 0 && (
            <p className={HINT_CLASS}>{`${droppedLists.length === 1 ? 'One list was' : `${droppedLists.length} lists were`} reset to the part default, because the table can change.`}</p>
          )}
        </fieldset>
        {editable.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-slate-slate100">Save as new or replace</legend>
            <label className="flex items-center gap-2 text-sm text-slate-slate300">
              <input type="radio" name="save-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
              Save as a new feature
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-slate300">
              <input type="radio" name="save-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              Replace one of your features
              <select aria-label="Feature to replace" className={`${inputClass} w-auto`} value={replaceId} onChange={(e) => setReplaceId(e.target.value)} disabled={mode !== 'replace'}>
                <option value="">Pick the feature to replace</option>
                {editable.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        )}
        {message && (
          <p role="alert" className={formErrorClass}>
            {message}
          </p>
        )}
        {hasPlaceholderText(selection) && <p className={HINT_CLASS}>{PLACEHOLDER_WARNING}</p>}
        <IssueList issues={issues} max={4} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {onOpenBuilder !== undefined && (
            <button type="button" className={btnSecondary} onClick={openBuilder} disabled={busy}>
              Open in the builder
            </button>
          )}
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Saving...' : 'Save feature'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
