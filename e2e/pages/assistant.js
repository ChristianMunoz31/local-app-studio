// The floating Assistant launcher and panel (src/components/assistant/).
import { expect } from '../support/fixtures.js';

export function assistant(page) {
  const launcher = page.getByRole('button', { name: 'Ask Assistant about this page' });
  const panel = page.getByRole('dialog', { name: 'Assistant' });
  return {
    launcher,
    panel,
    async open() {
      await launcher.click();
      await expect(panel).toBeVisible();
    },
    async close() {
      await panel.getByRole('button', { name: 'Close Assistant' }).click();
      await expect(panel).toBeHidden();
    },
    async ask(text) {
      await panel.getByRole('textbox', { name: 'Message Assistant' }).fill(text);
      await panel.getByRole('button', { name: 'Send' }).click();
    },
    /** The write-confirmation card Assistant shows before changing anything. */
    confirmCard() {
      return panel.getByRole('group', { name: /^Confirm:/ });
    },
    approve() {
      return this.confirmCard().getByRole('button', { name: 'Approve' }).click();
    },
    decline() {
      return this.confirmCard().getByRole('button', { name: 'Decline' }).click();
    },
    /** A visible message in the panel (the screen-reader live region repeats the text, so skip it). */
    message(text) {
      return panel.locator('p:not(.sr-only)').filter({ hasText: text });
    },
    /** The friendly state when Ollama is not available. */
    needsOllama() {
      return panel.getByText('Assistant needs Ollama');
    },
  };
}
