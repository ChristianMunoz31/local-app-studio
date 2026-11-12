// The Apps page and the Blank app dialog, for flows that pass through them on the way to something open. They hold in both builds
// (docs/ARCHITECTURE.md 'The pro seam'): a pro build has the helper's prompt box on the Apps start card, opened by the Create button (not on the page until it is pressed, unless start words are saved) and a new app lands on Prompt;
// a public build has the "helper is not in this build" card (a second button, no heading) and a new app lands on Design (src/studio/lib/steps.ts,
// startStep). The build is decided the way the @pro tag decides it (PUBLIC_BUILD in e2e/support/proBuild.js, which reads APP_PRO_DIR, the
// variable the e2e server and the Vite build in dist/ both follow), not by anything the browser could see.
import { expect } from '@playwright/test';
import { PUBLIC_BUILD } from '../support/proBuild.js';

const HELPER_LINE = 'The helper is not in this build. Build it yourself in Design.';

/** The step a new Blank app lands on in this build. */
export const LANDING_STEP = PUBLIC_BUILD ? 'design' : 'prompt';

/** The URL of the step a new Blank app lands on in this build. */
export const LANDING_URL = new RegExp(`/apps/[^/]+/${LANDING_STEP}$`);

/** The Apps page's own "Blank app" button (header or empty state), never the public start card's "Start a blank app instead". */
export const blankAppButton = (page) => page.getByRole('button', { name: 'Blank app', exact: true });

/** The Apps page's Create button (exact: "Create app" in the dialog must not match; the header one first when the empty state shows a second). */
export const createButton = (page) => page.getByRole('button', { name: 'Create', exact: true }).first();

/**
 * Waits for what the Apps start card shows in this build: the Create button (a pro build; the prompt box is not on the page until it is
 * pressed), or the helper-not-in-this-build line.
 */
export async function expectStartCard(page) {
  if (PUBLIC_BUILD) await expect(page.getByText(HELPER_LINE)).toBeVisible();
  else await expect(createButton(page)).toBeVisible();
}

/**
 * Presses Create and waits for the prompt box to have the cursor. Pro only: a public build has no start box (Create opens the Blank app dialog).
 * `click` lets a journey count the press: `openStartBox(page, (l) => j.click(l))`.
 */
export async function openStartBox(page, click = (locator) => locator.click()) {
  await click(createButton(page));
  await expect(page.getByLabel('Your prompt')).toBeFocused();
}

/** Opens the Blank app dialog from Apps, names the app and presses Create app. Does not wait for the landing step. */
export async function createBlankApp(page, name) {
  await blankAppButton(page).click();
  await page.getByLabel('App name').fill(name);
  await page.getByRole('button', { name: 'Create app' }).click();
}

/** Asserts the page is on the step a new Blank app lands on in this build (Prompt in a pro build, Design in a public build). */
export async function expectLanding(page) {
  await expect(page).toHaveURL(LANDING_URL);
}

/** The Apps card of the page (region "Apps"): the app grid and its header. The Examples gallery is a separate region, so counts and card lookups scope here. */
export const appsRegion = (page) => page.getByRole('region', { name: 'Apps', exact: true });

/** The app cards (list items) of the Apps region only, never the example cards. */
export const appCards = (page) => appsRegion(page).getByRole('listitem');

/** The Examples gallery (region "Examples"). */
export const examplesCard = (page) => page.getByRole('region', { name: 'Examples', exact: true });

/** The example card (list item) whose heading is `name`. */
export const exampleCard = (page, name) => examplesCard(page).getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });

/** The "Use this example" button of one example card (accessible name "Use this example <name>"). */
export const useExampleButton = (page, name) => exampleCard(page, name).getByRole('button', { name: `Use this example ${name}`, exact: true });

/** Presses "Use this example" on a card and waits for the app's Preview step (the app is made and Preview opens). Returns the new app id. */
export async function useExample(page, name) {
  await useExampleButton(page, name).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+\/preview$/, { timeout: 30_000 });
  return /\/apps\/([^/]+)\/preview$/.exec(new URL(page.url()).pathname)[1];
}

/** The notice Preview shows after an example is used. */
export const madeFromExample = (name) => `Made ${name} from the example. It is yours to change.`;
