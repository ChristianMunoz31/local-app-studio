// First-run welcome dialog (src/components/onboarding/OnboardingFlow.jsx).
import { expect } from '../support/fixtures.js';

export function onboarding(page) {
  const dialog = page.getByRole('dialog', { name: 'Welcome to Local App Studio' });
  return {
    dialog,
    async expectVisible() {
      await expect(dialog).toBeVisible();
    },
    /** Welcome step: type a name (optional) and continue to the Assistant step. */
    async continueWithName(name) {
      if (name) await dialog.getByLabel(/What should Local App Studio call you/).fill(name);
      await dialog.getByRole('button', { name: 'Continue' }).click();
    },
    /** Assistant step (the last one): the Ollama setup is optional; skip it (or finish when Ollama is ready). */
    async passAssistantStep() {
      const step = page.getByRole('dialog', { name: 'Set up Assistant' });
      await expect(step).toBeVisible();
      await step.getByRole('button', { name: /^(Skip for now|Finish)$/ }).click();
    },
    /** The whole flow with only a display name. */
    async complete(name) {
      await this.expectVisible();
      await this.continueWithName(name);
      await this.passAssistantStep();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
  };
}
