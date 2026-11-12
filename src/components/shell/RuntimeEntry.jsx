import { useRef, useState } from 'react';
import { Settings, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { openAssistant } from '../assistant/openAssistant';
import { OLLAMA_SETUP_KEY } from '../../hooks/useOllamaSetup';
import { aiSettingsService } from '../../services/aiSettingsService';
import { OPEN_ASSISTANT_SETUP_EVENT } from './setupEvent';

// The setup is offered once per app session, on the first press of Assistant while it is not ready.
let setupOffered = false;

/**
 * The app entry: Assistant and Settings, two icon buttons at the end of the designed menu bar (or in the corner pill).
 * The first press of Assistant offers the Set up Assistant step (hosted by RuntimeShell) when the Assistant is not ready;
 * after that it opens directly. Presses while the setup check runs are ignored. `buttonClass` is ENTRY_BUTTON of menuClasses.ts,
 * passed in by the runtime module (a static import here would pull that file into the Studio entry chunk).
 */
export default function RuntimeEntry({ buttonClass = '' }) {
  const queryClient = useQueryClient();
  const checking = useRef(false);
  const [busy, setBusy] = useState(false);

  const onAssistant = async () => {
    if (checking.current) return;
    if (setupOffered) {
      openAssistant();
      return;
    }
    checking.current = true;
    setBusy(true);
    let needsSetup = false;
    try {
      const state = await queryClient.fetchQuery({ queryKey: OLLAMA_SETUP_KEY, queryFn: aiSettingsService.setup, staleTime: 0, retry: false });
      needsSetup = state?.ready === false && state?.ollama !== 'disabled';
    } catch {
      // The panel shows its own "needs Ollama" state when the setup cannot be read.
    }
    setupOffered = true;
    checking.current = false;
    setBusy(false);
    if (needsSetup) window.dispatchEvent(new Event(OPEN_ASSISTANT_SETUP_EVENT));
    else openAssistant();
  };

  return (
    <>
      <button type="button" aria-label="Assistant" aria-busy={busy || undefined} title="Ask the Assistant" onClick={onAssistant} className={buttonClass}>
        <Sparkles size={16} aria-hidden="true" />
      </button>
      <Link to="/settings" aria-label="Settings" title="Settings: Light and Dark, your data, privacy" className={buttonClass}>
        <Settings size={16} aria-hidden="true" />
      </Link>
    </>
  );
}
