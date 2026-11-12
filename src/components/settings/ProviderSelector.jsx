import { Link } from 'react-router-dom';
import { Cpu } from 'lucide-react';
import { useAssistantStatus } from '../../hooks/useAssistantStatus';

// Read-only badge for the Assistant brain. The model and provider are chosen in Settings > AI,
// so this only reports what is active and links there.
export default function ProviderSelector() {
  const { status } = useAssistantStatus();
  if (!status) return null;

  // status.ai is where calls really go. Older servers only send the provider, so fall back to
  // effectiveProvider (cloud only when fully set up, consented and allowed).
  const kind =
    status.ai?.kind ?? ((status.effectiveProvider ?? status.provider) === 'openai_compat' ? 'cloud' : 'local');
  let where = 'on this computer';
  if (kind === 'lan') where = 'on your network';
  if (kind === 'cloud') where = status.ai?.host ? `cloud (${status.ai.host})` : 'cloud';
  let label = `Assistant: ${status.model}, ${where}`;
  if (status.available === false || !status.model) {
    label = status.reason === 'ai_disabled' ? 'Assistant: AI is off' : 'Assistant: needs Ollama';
  }

  return (
    <Link
      to={{ pathname: '/settings', hash: '#ai' }}
      title="Change the Assistant model in Settings > AI"
      className="flex items-center gap-1.5 rounded-md text-[11px] text-slate-slate400 hover:text-slate-slate100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]"
    >
      <Cpu size={12} className="shrink-0" aria-hidden="true" />
      {label}
    </Link>
  );
}
