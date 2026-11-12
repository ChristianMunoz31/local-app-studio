import { Link } from 'react-router-dom';
import { AI_DISABLED } from '../../utils/apiError';

export const LINK_CLASS =
  'font-medium underline underline-offset-2 hover:text-slate-slate100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]';

// Keyed off the server's structured reason (status `reason`, or the 503 body's `reason`),
// never off the message text.
const isTurnedOff = ({ code, reason }) => reason === AI_DISABLED || code === AI_DISABLED;

/**
 * Friendly state for a 503 `ollama_unavailable` / `ai_not_configured` (or status
 * `{ available: false }`). `message` is the server's classified, user-safe text; raw errors
 * and stack traces must never be passed in. `code` is the error code and `reason` the status
 * or 503 reason; when the reason is `ai_disabled` (APP_AI=0) the card says AI is turned
 * off and has no Settings link, since there is nothing to set up in Settings.
 */
export default function AiUnavailable({
  message,
  code,
  reason,
  link = true,
  className = 'text-xs text-slate-slate300',
}) {
  if (isTurnedOff({ code, reason })) {
    return (
      <div role="status" className={className}>
        <p className="font-semibold text-slate-slate100">AI is turned off</p>
        <p>AI features are turned off on this computer.</p>
      </div>
    );
  }
  // The server message already says what is wrong (and often what to do), so it replaces the
  // generic intro instead of following it; the link text avoids repeating "Settings > AI".
  const linkText = message && message.includes('Settings > AI') ? 'Open Settings > AI' : 'Set it up in Settings > AI';
  return (
    <div role="status" className={className}>
      <p className="font-semibold text-slate-slate100">Assistant needs Ollama</p>
      <p>
        {message ? <span>{message}</span> : 'Assistant runs on your machine through Ollama.'}{' '}
        {link ? (
          <Link to={{ pathname: '/settings', hash: '#ai' }} className={LINK_CLASS}>
            {linkText}
          </Link>
        ) : (
          linkText
        )}
        .
      </p>
    </div>
  );
}
