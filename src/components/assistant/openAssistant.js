// Fire from anywhere (command palette) to open the Assistant panel, optionally with a question
// that is sent straight away. AssistantAdvisor listens for it. Mirrors openCommandPalette().
export const ASSISTANT_OPEN_EVENT = 'assistant:open';

/**
 * @param {{ prompt?: string }} [options]
 */
export function openAssistant({ prompt } = {}) {
  window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, { detail: { prompt } }));
}
