import { useId, useRef, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber';
import { ruleProblems, ruleSentence } from '@local-app-studio/runtime/spec/rules';
import type { Rule, RuleTo } from '@local-app-studio/runtime/spec/rules';
import type { Field, SpecIssue, Table } from '@local-app-studio/runtime/spec/schema';
import { btnSecondary, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { addRule, removeBrokenRules, removeRule, ruleTargets, ruleWatchable } from '../lib/automationEdit';
import type { ChangeMeta } from '../lib/tableChange';
import { issuesAt } from '../lib/validate';
import { Errors } from './FieldRow';
import { DefaultEditor } from './TableAdvanced';
import { HINT_CLASS, PROBLEM_NOTICE_CLASS } from './ui';

interface Props {
  table: Table;
  index: number;
  issues: SpecIssue[];
  onChange(next: Table, meta?: ChangeMeta): void;
}

type Kind = 'today' | 'now' | 'clear' | 'value' | 'field';

const KINDS: ReadonlyArray<{ kind: Kind; label: string }> = [
  { kind: 'today', label: "today's date" },
  { kind: 'now', label: 'now' },
  { kind: 'clear', label: 'empty' },
  { kind: 'value', label: 'a value' },
  { kind: 'field', label: 'the value of another field' },
];

const NOT_RUNNABLE = 'This automation cannot run as it is written.';

/** A labelled select. */
function Pick({ id, label, children, ...select }: ComponentPropsWithRef<'select'> & { id: string; label: string }) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} className={inputClass} {...select}>
        {children}
      </select>
    </div>
  );
}

/** "Pick a field" and one option for each field. */
const fieldOptions = (list: Field[]) => (
  <>
    <option value="">Pick a field</option>
    {list.map((f) => (
      <option key={f.id} value={f.id}>
        {f.label}
      </option>
    ))}
  </>
);

/** The rule the row describes, or null while it is not complete. */
function draftRule(when: Field | undefined, is: string, target: Field | undefined, kind: Kind, value: string | number | boolean | undefined, source: string): Rule | null {
  if (when === undefined || target === undefined || is === '') return null;
  const to: RuleTo | null = kind === 'value' ? (value === undefined ? null : { value }) : kind === 'field' ? (source === '' ? null : { field: source }) : kind;
  if (to === null) return null;
  return { when: { field: when.id, is: when.type === 'boolean' ? is === 'true' : is }, then: [{ set: target.id, to }] };
}

/** The Automations of one table: each rule in words with Remove, and one row to add a rule (one action each, DESIGN-phase28.md F1). */
export default function TableAutomations({ table, index, issues, onChange }: Props) {
  const uid = useId();
  const base = `tables.${index}`;
  const rules = Array.isArray(table.rules) ? table.rules : [];
  const watchable = ruleWatchable(table);
  const [whenId, setWhenId] = useState('');
  const [is, setIs] = useState('');
  const [targetId, setTargetId] = useState('');
  const [kind, setKind] = useState<Kind>('today');
  const [value, setValue] = useState<string | number | boolean | undefined>(undefined);
  const [source, setSource] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const whenRef = useRef<HTMLSelectElement>(null);

  const when = watchable.find((f) => f.id === whenId);
  const targets = ruleTargets(table, whenId === '' ? null : whenId);
  const target = targets.find((f) => f.id === targetId);
  const sources = targets.filter((f) => f.id !== targetId);
  const rule = draftRule(when, is, target, kind, value, source);
  const fits = rule !== null && ruleProblems(table, rule, readAutoNumber(table)?.field ?? null).length === 0;
  const broken = (r: number): boolean => issues.some((i) => i.path.startsWith(`${base}.rules.${r}.`) && i.code === 'rule_field_missing');
  const brokenCount = rules.filter((_, r) => broken(r)).length;

  const add = (): void => {
    if (rule === null || !fits) return;
    onChange(addRule(table, rule), { label: 'Added an automation' });
    setWhenId('');
    setIs('');
    setValue(undefined);
    whenRef.current?.focus();
  };

  const fixBroken = (): void => {
    const fixed = removeBrokenRules(table);
    onChange(fixed.table, { label: 'Removed an automation', notice: `Removed ${fixed.removed === 1 ? 'an automation' : `${fixed.removed} automations`}.` });
    headingRef.current?.focus();
  };

  // The row's button unmounts with the row, which would drop focus to the page: the heading takes it.
  const remove = (k: number): void => {
    onChange(removeRule(table, k), { label: 'Removed an automation', ...(broken(k) ? { notice: 'Removed an automation.' } : {}) });
    headingRef.current?.focus();
  };

  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3">
      <h3 ref={headingRef} tabIndex={-1} id={`${uid}-h`} className="text-sm font-semibold text-slate-slate100 focus-visible:outline-hidden">
        Automations
      </h3>
      <p className={HINT_CLASS}>Fills in a field when a choice or tick box changes. A value you type always wins.</p>
      <Errors issues={issuesAt(issues, `${base}.rules`).filter((i) => i.path === `${base}.rules`)} id={`${uid}-rules-err`} />
      {rules.length > 0 && (
        <ul className="space-y-2">
          {rules.map((r, k) => {
            const bad = broken(k);
            const words = bad ? '' : ruleSentence(table, r);
            const label = bad ? 'Remove this automation' : `Remove the automation: ${words}`;
            return (
              <li key={k} className="flex flex-wrap items-center gap-3">
                {!bad && <span className="text-sm text-slate-slate100">{words}</span>}
                <button type="button" className={btnSecondary} aria-label={label} onClick={() => remove(k)}>
                  {bad ? label : 'Remove'}
                </button>
                <Errors issues={issues.filter((i) => i.path.startsWith(`${base}.rules.${k}.`))} id={`${uid}-rule-err-${k}`} />
              </li>
            );
          })}
        </ul>
      )}
      {brokenCount > 1 && (
        <div>
          <button type="button" className={btnSecondary} onClick={fixBroken}>
            Remove all broken automations
          </button>
        </div>
      )}
      {watchable.length === 0 ? (
        <p className={HINT_CLASS}>Add a choice or tick box field to this table to start an automation.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Pick ref={whenRef} id={`${uid}-when`} label="When this field changes" value={whenId} onChange={(e) => { setWhenId(e.target.value); setIs(''); }}>
            {fieldOptions(watchable)}
          </Pick>
          <Pick id={`${uid}-is`} label="To this" value={is} disabled={when === undefined} onChange={(e) => setIs(e.target.value)}>
            <option value="">Pick one</option>
            {when?.type === 'boolean' ? (
              <>
                <option value="true">Ticked</option>
                <option value="false">Unticked</option>
              </>
            ) : (
              when?.type === 'select' && when.options.map((o) => <option key={o} value={o}>{o}</option>)
            )}
          </Pick>
          <Pick id={`${uid}-set`} label="Fill in this field" value={targetId} onChange={(e) => { setTargetId(e.target.value); setValue(undefined); setSource(''); }}>
            {fieldOptions(targets)}
          </Pick>
          <Pick id={`${uid}-kind`} label="With" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </Pick>
          {kind === 'value' && target !== undefined && (
            <div>
              <label htmlFor={`${uid}-value`} className={labelClass}>
                Value
              </label>
              <DefaultEditor field={value === undefined ? target : ({ ...target, default: value } as Field)} id={`${uid}-value`} onChange={(next) => setValue((next as { default?: string | number | boolean }).default)} />
            </div>
          )}
          {kind === 'field' && (
            <Pick id={`${uid}-source`} label="Copy from" value={source} onChange={(e) => setSource(e.target.value)}>
              {fieldOptions(sources)}
            </Pick>
          )}
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="button" className={btnSecondary} disabled={!fits} onClick={add}>
              Add an automation
            </button>
          </div>
        </div>
      )}
      {/* Always present, so a text set after mount is read as a change. */}
      <div role="status" className="space-y-2 empty:hidden">
        {brokenCount > 0 && (
          <div className={PROBLEM_NOTICE_CLASS}>
            <span>An automation names a field this table no longer has.</span>
          </div>
        )}
        {rule !== null && !fits && <p className="text-xs text-accent-red">{NOT_RUNNABLE}</p>}
      </div>
    </section>
  );
}
