import { useMemo } from 'react';
import Markdown from '../shared/Markdown';
import { stripDashes } from '../../utils/assistantDashes';

const DISALLOWED = ['img'];

// Images are dropped (not rendered), which blocks markdown-image exfiltration of page context.
// No rehype-raw: model output can never inject HTML.
// No link is clickable. A model-written http(s) link shows its text and then the real host as
// plain text ("docs (example.com)"), so a misleading label cannot disguise the destination.
// Anything else renders as plain text.
function safeHost(href) {
  try {
    const url = new URL(String(href ?? ''));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : null;
  } catch {
    return null;
  }
}

function SafeLink({ href, children }) {
  const host = safeHost(href);
  if (!host) return <span>{children}</span>;
  return (
    <span>
      {children} <span className="text-slate-slate300">({host})</span>
    </span>
  );
}

const COMPONENTS = { a: SafeLink };

/**
 * One chat bubble in the Assistant panel.
 * @param {{ role: 'user'|'assistant', content: string }} props
 */
export default function AssistantMessage({ role, content }) {
  const shown = useMemo(() => (role === 'user' ? content : stripDashes(content)), [role, content]);
  if (role === 'user') {
    return (
      <div className="text-right">
        <p className="glass-assistant-user inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-left text-base leading-relaxed text-slate-slate100">
          <span className="sr-only">You said: </span>
          {content}
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="glass-assistant-inner inline-block max-w-[92%] rounded-xl px-3.5 py-2.5 text-left text-base leading-relaxed text-slate-slate200">
        <span className="sr-only">Assistant said: </span>
        <div className="prose-assistant break-words [&_table]:block [&_table]:overflow-x-auto">
          <Markdown disallowedElements={DISALLOWED} unwrapDisallowed components={COMPONENTS}>
            {shown}
          </Markdown>
        </div>
      </div>
    </div>
  );
}
