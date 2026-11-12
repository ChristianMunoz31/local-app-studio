// The bullets of the Prompt step's review pane and its "Show everything" fold (DESIGN-phase16.md 1.5). The bullets come from
// the pure promptBullets grammar; the fold holds everything the old Review summary showed, plus the field types.
import { useMemo, useState } from 'react';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { diffSpecs, summarizeChanges } from '../lib/specDiff';
import type { SpecChange } from '../lib/specDiff';
import { ALSO_CHANGED_HEADING, ASK_ALL_MISSED, NOTHING_CHANGED } from '../lib/askOutcome';
import type { AskExitKind, AskOutcome } from '../lib/askOutcome';
import type { PromptBullets as PromptBulletsModel } from '../lib/promptBullets';
import { featuresLine, lookLine, menuLine, pageLine, summarizeSpec, tableLine } from '../lib/specSummary';
import type { PageSummary, SpecSummary } from '../lib/specSummary';
import DiffView from './DiffView';
import { SUMMARY_CLASS, TEXT_BUTTON } from './ui';

/** What follows a page line in Show everything: a full stop first, so the line and the tag read as two sentences. */
export const PAGE_OPENS_FROM_LIST = '. It opens from a list.';
export const PAGE_NOT_IN_MENU = '. It is not in the menu bar.';
const pageTag = (p: PageSummary): string | null => (p.opensFromList ? PAGE_OPENS_FROM_LIST : !p.inMenu ? PAGE_NOT_IN_MENU : null);

/** The headline, a line per table and per page (menu pages first), shared by the Show everything fold. */
export function SummaryLines({ summary }: { summary: SpecSummary }) {
  const menuFirst = [...summary.pages].sort((a, b) => Number(b.inMenu) - Number(a.inMenu));
  return (
    <>
      <p className="text-sm font-medium text-slate-slate100">{summary.headline}</p>
      {summary.tables.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-slate-slate100">Tables</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-slate200">
            {summary.tables.map((t) => (
              <li key={t.id}>{tableLine(t)}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="mb-1 text-sm font-semibold text-slate-slate100">Pages</h4>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-slate200">
          {menuFirst.map((p) => {
            const tag = pageTag(p);
            return (
              <li key={p.id}>
                {pageLine(p)}
                {tag !== null && <span className="text-xs text-slate-slate400">{tag}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

const LIST = 'list-disc space-y-1 pl-5 text-sm text-slate-slate200';

/** The bullets: the lead, a line per table, per page (and the parts that cannot connect), the look, the menu and the changes. */
export default function PromptBullets({ bullets }: { bullets: PromptBulletsModel }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-slate100">{bullets.lead}</p>
      {bullets.tables.length > 0 && (
        <ul aria-label="Tables" className={LIST}>
          {bullets.tables.map((t, i) => (
            <li key={`${i}:${t.text}`} title={t.detail ?? undefined}>
              {t.text}
            </li>
          ))}
        </ul>
      )}
      <ul aria-label="Pages" className={LIST}>
        {bullets.pages.map((p, i) => (
          <li key={`${i}:${p.text}`}>{p.text}</li>
        ))}
      </ul>
      {(bullets.look !== null || bullets.menu !== null) && (
        <ul aria-label="Look and menu" className={LIST}>
          {bullets.look !== null && <li>{bullets.look}</li>}
          {bullets.menu !== null && <li>{bullets.menu}</li>}
        </ul>
      )}
      {bullets.changes.length > 0 && (
        <ul aria-label="Changes" className={LIST}>
          {bullets.changes.map((c, i) => (
            <li key={`${i}:${c}`}>{c}</li>
          ))}
          {bullets.moreChanges > 0 && <li>{`and ${bullets.moreChanges} more ${bullets.moreChanges === 1 ? 'change' : 'changes'}`}</li>}
        </ul>
      )}
    </div>
  );
}

/** The place lines of a proposal (placeBullets): where parts were put on a grid. Nothing when there are none. */
export function PlaceLines({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul aria-label="Places" className={LIST}>
      {lines.map((line, i) => (
        <li key={`${i}:${line}`}>{line}</li>
      ))}
    </ul>
  );
}

export interface AskResultProps {
  outcome: AskOutcome;
  /** The bullets of `outcome.alsoChanged` (changeBullets), already worded. */
  also: { shown: string[]; more: number };
  /** The person chose to do a not done ask by hand. */
  onExit(kind: AskExitKind): void;
}

/** What the helper did with an ask: a line per clause (Done or Not done, with a way to do it by hand), then what else changed. */
export function AskResult({ outcome, also, onExit }: AskResultProps) {
  const { lines } = outcome;
  return (
    <div className="space-y-3">
      {outcome.nothingChanged && <p className="text-sm font-medium text-slate-slate100">{NOTHING_CHANGED}</p>}
      {lines.length > 0 && (
        <ul aria-label="Your ask" className="space-y-1.5 text-sm text-slate-slate100">
          {lines.map((line, i) => (
            <li key={`${i}:${line.text}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={line.done ? 'font-medium' : 'font-medium text-accent-amber'}>{line.text}</span>
              {line.exit !== null && (
                <button
                  type="button"
                  className={TEXT_BUTTON}
                  aria-label={`${line.exit.label}. ${line.text}`}
                  onClick={() => line.exit !== null && onExit(line.exit.kind)}
                >
                  {line.exit.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {outcome.missedAll && <p className="text-sm text-slate-slate300">{ASK_ALL_MISSED}</p>}
      {also.shown.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-slate-slate100">{ALSO_CHANGED_HEADING}</h4>
          <ul aria-label={ALSO_CHANGED_HEADING} className={LIST}>
            {also.shown.map((c, i) => (
              <li key={`${i}:${c}`}>{c}</li>
            ))}
            {also.more > 0 && <li>{`and ${also.more} more ${also.more === 1 ? 'change' : 'changes'}`}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface ShowEverythingProps {
  /** The proposal, or the saved app for the idle view. */
  spec: AppSpec;
  /** The saved app when this is a proposal (edit or create), else null. */
  before: AppSpec | null;
  /** True for an edit proposal: the change counts line shows. */
  edit: boolean;
  bullets: PromptBulletsModel;
}

/** A fold with everything Review used to show, the field types, and (for a proposal) every change. */
export function ShowEverything({ spec, before, edit, bullets }: ShowEverythingProps) {
  const [diffOpen, setDiffOpen] = useState(false);
  const summary = useMemo(() => summarizeSpec(spec), [spec]);
  const beforeSummary = useMemo(() => (before === null ? null : summarizeSpec(before)), [before]);
  const changes: SpecChange[] = useMemo(() => (before === null ? [] : diffSpecs(before, spec)), [before, spec]);
  const used = featuresLine(summary.features);
  const look = lookLine(summary.theme, beforeSummary?.theme ?? null);
  const menu = menuLine(summary.menu, beforeSummary?.menu ?? null);
  const typed = bullets.tables.filter((t) => t.detail !== null);
  return (
    <details>
      <summary className={SUMMARY_CLASS}>Show everything</summary>
      <div className="mt-3 space-y-4">
        {edit && <p className="text-sm text-slate-slate300">{summarizeChanges(changes)}</p>}
        <SummaryLines summary={summary} />
        {typed.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-slate-slate100">Fields</h4>
            <ul className={LIST}>
              {typed.map((t, i) => (
                <li key={`${i}:${t.detail}`}>{t.detail}</li>
              ))}
            </ul>
          </div>
        )}
        {used !== null && <p className="text-sm text-slate-slate200">{used}</p>}
        {look !== null && <p className="text-sm text-slate-slate200">{look}</p>}
        {menu !== null && <p className="text-sm text-slate-slate200">{menu}</p>}
        {before !== null && (
          <details onToggle={(e) => setDiffOpen(e.currentTarget.open)}>
            <summary className={SUMMARY_CLASS}>Show every change</summary>
            {diffOpen && (
              <div className="mt-3">
                <DiffView before={before} after={spec} />
              </div>
            )}
          </details>
        )}
      </div>
    </details>
  );
}
