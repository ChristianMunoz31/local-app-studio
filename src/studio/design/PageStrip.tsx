// The strip above the Design canvas: what the open page does in one line (the Prompt step's bullet grammar), the words the app was
// made from, and Ask for a change, which carries the page to Prompt where the answer is checked like any other. It reads the
// saved app (DesignTab passes it into the session toolbar, as a full row), and it never changes the app itself.
import { useContext, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { btnSecondary, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { PRO_PARTS } from '@/proParts.js';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { TEXT_BUTTON } from '../components/ui';
import { useOptionalDescribeSession } from '../hooks/useDescribeSession';
import { useStepChrome } from '../hooks/useStepChrome';
import { readPrompt } from '../lib/appMemory';
import { pageBullet, shortQuote } from '../lib/promptBullets';
import { DesignContext } from './DesignContext';
import { behindCount, newerVersionLine } from './indicator';
import { launchState, pageAskInstruction, pageAskPrefix, stepPath } from '../lib/steps';

interface PageStripProps {
  /** The saved app. */
  spec: AppSpec;
  /** The open page. */
  pageId: string;
  appId: string;
}

const WORDS_SHOWN = 120;
const MAX_ASK = 2000;

export const STRIP_WORKING = 'The helper is working on a design.';
export const STRIP_WAITING = "The helper's design is waiting on Prompt.";

export default function PageStrip({ spec, pageId, appId }: PageStripProps) {
  const chrome = useStepChrome();
  const describe = useOptionalDescribeSession();
  const inputId = useId();
  const [words, setWords] = useState('');
  // The strip sits inside the Design session when there is one: the count follows the draft, so an update shows at once.
  const design = useContext(DesignContext);
  const behind = design === null ? 0 : behindCount(design.root, design.library);
  const page = spec.pages.find((p) => p.id === pageId);
  if (page === undefined) return null;
  const bullet = pageBullet(spec, pageId);
  const kept = readPrompt(appId).trim();
  const phase = describe?.phase ?? 'idle';
  const busy = phase === 'running';
  const waiting = phase === 'proposal' || phase === 'unchanged';
  const maxLength = MAX_ASK - pageAskPrefix(page.title).length;
  const openPrompt = (): void => chrome.go(stepPath(appId, 'prompt'));
  const ask = (e: FormEvent): void => {
    e.preventDefault();
    if (words.trim() === '') return;
    chrome.go(stepPath(appId, 'prompt'), { state: launchState({ mode: 'edit', instruction: pageAskInstruction(page.title, words) }) });
  };
  return (
    <section aria-label="This page" className="glass-subtle flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-4 py-2 text-sm text-slate-slate200">
      <div className="min-w-0 space-y-0.5">
        {bullet !== null && (
          <p>
            <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-slate400">This page</span>
            {bullet}
          </p>
        )}
        {behind > 0 && <p>{newerVersionLine(behind)}</p>}
        {kept !== '' && <p className="text-xs text-slate-slate400">{`Your words: "${shortQuote(kept, WORDS_SHOWN)}"`}</p>}
      </div>
      {!PRO_PARTS.helper ? null : busy || waiting ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>{busy ? STRIP_WORKING : STRIP_WAITING}</p>
          <button type="button" className={TEXT_BUTTON} onClick={openPrompt}>
            Open Prompt
          </button>
        </div>
      ) : (
        <form onSubmit={ask} className="flex w-full min-w-0 flex-1 flex-wrap items-end gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <label htmlFor={inputId} className={labelClass}>
              Ask the helper to change this page
            </label>
            <input id={inputId} type="text" className={inputClass} value={words} maxLength={maxLength} onChange={(e) => setWords(e.target.value)} />
          </div>
          <button type="submit" className={btnSecondary} disabled={words.trim() === ''}>
            Ask
          </button>
        </form>
      )}
    </section>
  );
}
