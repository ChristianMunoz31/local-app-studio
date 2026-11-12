// Guided card for when Ollama (the local model runner) is not ready (DESIGN-phase5.md section 8). It explains and offers
// the next click; it never starts a process or downloads a model by itself.
import { useEffect, useRef } from 'react';
import StudioSectionCard from './StudioSectionCard';
import OllamaSetup from '@/components/shared/OllamaSetup.jsx';
import { btnPrimary, btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import { useOllamaSetup } from '@/hooks/useOllamaSetup.js';
import { SUMMARY_CLASS } from './ui';

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

export interface HelperSetupCardProps {
  serverMessage?: string | null;
  onReady(): void;
  /** Shows a button that skips the helper; the caller decides where it goes. */
  onSkip?(): void;
  /** The skip button's words. Default: Build it yourself in Design. */
  skipLabel?: string;
  /** Id for the card's heading (it can take focus), so a page can move focus to it. */
  headingId?: string;
}

export default function HelperSetupCard({ serverMessage = null, onReady, onSkip, skipLabel, headingId }: HelperSetupCardProps) {
  const { setup, isFetching, checkAgain } = useOllamaSetup();
  const ready = setup?.ready === true;
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    if (ready) onReadyRef.current();
  }, [ready]);

  const check = (
    <button type="button" className={btnSecondary} onClick={() => void checkAgain()} disabled={isFetching}>
      {isFetching ? 'Checking...' : 'Check again'}
    </button>
  );

  let body;
  if (setup?.ollama === 'missing') {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-slate-slate200">Ollama is not installed. Install it, open it, then press Check again.</p>
        <div className="flex flex-wrap gap-2">
          <a href={OLLAMA_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className={`${btnPrimary} no-underline`}>
            Get Ollama
            <span className="sr-only"> (opens in your browser)</span>
          </a>
          {check}
        </div>
      </div>
    );
  } else if (setup?.ollama === 'stopped' || setup?.ollama === 'unreachable') {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-slate-slate200">Ollama is not running. Open Ollama from the Start menu, then press Check again.</p>
        <div className="flex flex-wrap gap-2">{check}</div>
        <details>
          <summary className={SUMMARY_CLASS}>Still not working?</summary>
          <p className="mt-1 text-sm text-slate-slate300">
            Open a terminal and run <code className="font-mono text-slate-slate100">ollama serve</code>, then press Check again.
          </p>
        </details>
      </div>
    );
  } else {
    body = <OllamaSetup subject="Local App Studio" />;
  }

  return (
    <StudioSectionCard title="Set up the helper (Ollama)" headingId={headingId}>
      <div className="space-y-3">
        {serverMessage && (
          <p role="alert" className={formErrorClass}>
            {serverMessage}
          </p>
        )}
        <p className="text-sm text-slate-slate200">
          Local App Studio uses Ollama, a free app that runs AI models on this computer. Your descriptions never leave this PC. You can also skip it and build the app yourself.
        </p>
        {body}
        {onSkip && (
          <div>
            <button type="button" className={btnSecondary} onClick={onSkip}>
              {skipLabel ?? 'Build it yourself in Design'}
            </button>
          </div>
        )}
      </div>
    </StudioSectionCard>
  );
}
