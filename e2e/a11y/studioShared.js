// Shared setup of the Studio accessibility specs (studioAxe, studioContrast, studioKeyboard). Each spec file calls
// setupStudio() at its top level, so each file gets its own sandbox server (useApp registers the hooks in the calling file),
// its own two imported apps and the same screen list. The specs are three files on purpose: every spec file shares one
// server, and the server's global limiter allows 300 API calls per 15 minutes, which the screens of all three together
// exceed (the last test of a single file then saw 429 on /api/license and /api/state).
import fs from 'node:fs';
import { test, expect, useApp } from '../support/fixtures.js';
import { cannedDescribeChat } from '../../scripts/lib/fakeDescribeAnswers.js';
import { builder } from '../pages/builder.js';
import { PUBLIC_BUILD } from '../support/proBuild.js';
import { expectStartCard, openStartBox } from '../pages/apps.js';

export const AA = 4.5;
export const BASE = { light: [255, 255, 255], dark: [24, 22, 20] };

const crewRoster = () => JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));

export const steps = (page) => page.getByRole('navigation', { name: 'Steps' });
export const canvas = (page) => page.getByRole('region', { name: 'Page layout' });
export const heading3 = (page, name) => page.getByRole('heading', { level: 3, name, exact: true });

/** Puts the theme in place before the page loads, as axe.js does. */
export async function theme(page, name) {
  await page.emulateMedia({ colorScheme: name, reducedMotion: 'reduce' });
}

/** A page title that is new in this run: the light run keeps its page in the same app, and a second page may not share a title. */
export async function archiveTitle(page) {
  const dark = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? 'Archive dark' : 'Archive';
}

/**
 * Design: Page actions > Add a page (a title new in this run), so the page has no list. Home already lists Crews, and a Table of
 * records dropped there joins that list and says Connected at once; on a new page, with two tables that fit, it says Needs a table.
 */
export async function addArchivePage(page) {
  const title = await archiveTitle(page);
  const picker = page.getByLabel('Page', { exact: true });
  // Adding a page saves it at once, so an earlier test of the same file (same app, same theme) already left this page in the app,
  // and a second Add page with the same title is refused (the picker stays on Home). Then the saved page is just chosen.
  const saved = await picker.locator('option').filter({ hasText: new RegExp(`^${title}$`) }).count();
  if (saved > 0) {
    await picker.selectOption({ label: title });
  } else {
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: 'Add a page' }).click();
    await page.getByLabel('Page title').fill(title);
    await page.getByRole('button', { name: 'Add page', exact: true }).click();
  }
  await expect(picker).toHaveValue(/archive/);
}

export async function settle(page) {
  await page.waitForLoadState('networkidle');
}

/**
 * Starts the sandbox server for the calling spec file and imports the two apps (Crew Roster as Classic, and a Midnight copy)
 * before its tests. Returns the server context, the app ids (filled in beforeAll), the path helper, openDesign and SCREENS.
 */
export function setupStudio() {
  const ctx = useApp({ seed: true, ollama: 'fake', fakeChat: cannedDescribeChat });
  const apps = {};

  async function post(path, data) {
    const res = await fetch(`${ctx.server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    if (res.status !== 201) throw new Error(`${path} answered ${res.status}: ${await res.text()}`);
    return (await res.json()).data;
  }

  test.beforeAll(async () => {
    const classic = crewRoster();
    apps.crew = (await post('/api/studio/apps/import', { spec: classic })).id;
    const midnight = crewRoster();
    midnight.app = { ...midnight.app, name: 'Midnight Roster', slug: 'midnight-roster', identifier: 'com.example.midnightroster' };
    midnight.theme = { ...midnight.theme, id: 'midnight' };
    apps.midnight = (await post('/api/studio/apps/import', { spec: midnight })).id;
  });

  // The helper's waiting design is kept on the server with the app (phase 17, P17-01), so the screen that makes one ("prompt with a design waiting")
  // would leave it for every later screen of the same app. Each test starts with none, as it did when the design lived in the browser.
  test.beforeEach(async () => {
    for (const id of Object.values(apps)) {
      const res = await fetch(`${ctx.server.url}/api/studio/apps/${id}/waiting`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Clearing the waiting design answered ${res.status}`);
    }
  });

  const path = (step, id = apps.crew) => `/apps/${id}/${step}`;

  /** Opens Design and waits for the canvas. */
  async function openDesign(page) {
    await page.goto(path('design'));
    await expect(canvas(page)).toBeVisible();
    await settle(page);
  }

  /** Every screen: its name, the axe shard it belongs to (`group`, studioAxeShared.js), how to reach it, and (optionally) the exact document title. */
  const ALL_SCREENS = [
    { name: 'apps', group: 'apps', title: 'Apps, Local App Studio', open: async (page) => {
        await page.goto('/apps');
        await expectStartCard(page);
      } },
    { name: 'apps start box', group: 'apps', open: async (page) => {
        await page.goto('/apps');
        await openStartBox(page);
      } },
    { name: 'apps help sheet', group: 'apps', open: async (page) => {
        await page.goto('/apps');
        await page.getByRole('button', { name: 'Help' }).first().click();
        await expect(page.getByRole('dialog', { name: 'Help and keyboard shortcuts' })).toBeVisible();
      } },
    { name: 'features', group: 'features', title: 'Features, Local App Studio', open: async (page) => {
        await page.goto('/features');
        await expect(heading3(page, 'Features')).toBeVisible();
        await expect(page.getByTestId('feature-tile').first()).toBeVisible();
      } },
    { name: 'feature drawer', group: 'features', open: async (page) => {
        await page.goto('/features');
        await page.getByRole('button', { name: 'Show details for Number row', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Number row', exact: true })).toBeVisible();
      } },
    { name: 'prompt idle', group: 'prompt', title: 'Prompt, Crew Roster, Local App Studio', open: async (page) => {
        await page.goto(path('prompt'));
        // A saved app: its first prompt as words, and one ask box, the right pane's.
        await expect(page.getByText('Your first prompt', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Ask for a change')).toBeVisible();
        await expect(page.getByLabel('What should change?')).toHaveCount(0);
      } },
    // The old review summary is the right pane of Prompt; the old address redirects to it.
    { name: 'prompt with your app', group: 'prompt', title: 'Prompt, Crew Roster, Local App Studio', open: async (page) => {
        await page.goto(path('review'));
        await expect(page.getByRole('heading', { name: 'Your app', exact: true })).toBeVisible();
      } },
    // The helper's answer (the canned loans design, a new idea for the Crew Roster app) waits beside the box.
    { name: 'prompt with a design waiting', group: 'prompt', title: 'Prompt, Crew Roster, Local App Studio', open: async (page) => {
        await page.goto(path('prompt'));
        await page.getByRole('button', { name: 'Start over with a new prompt' }).click();
        await page.getByLabel('Your prompt').fill('An app to track equipment loans for my rental shop.');
        await page.getByRole('button', { name: 'Make my app' }).click();
        await expect(page.getByRole('heading', { name: 'What the helper made' })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('button', { name: 'Use this', exact: true })).toBeVisible();
      } },
    { name: 'design', group: 'design', title: 'Design, Crew Roster, Local App Studio', open: openDesign },
    // A connected part (green pill), a part that needs a table (amber, dashed box with Connect) and one that needs a field, plus the page strip.
    { name: 'design with indicators', group: 'design', open: async (page) => {
        await openDesign(page);
        await addArchivePage(page);
        await page.locator('[data-canvas-block]').first().focus();
        await page.getByRole('button', { name: 'Add here: Page, place 2' }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Add Table of records' }).click();
        await page.getByRole('button', { name: 'Add here: Page, place 3' }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Add Checklist' }).click();
        await expect(page.locator('[data-indicator="needs_table"]').first()).toBeVisible();
        await expect(page.locator('[data-indicator="needs_field"]').first()).toBeVisible();
        await expect(page.getByRole('region', { name: 'This page' })).toBeVisible();
      } },
    { name: 'design settings popover', group: 'design', open: async (page) => {
        await openDesign(page);
        await page.locator('[data-canvas-block][data-layer-id="h1"]').dblclick();
        await expect(page.getByRole('dialog', { name: 'Settings for Heading' })).toBeVisible();
      } },
    { name: 'design look tab', group: 'design', open: async (page) => {
        await openDesign(page);
        await page.getByRole('tab', { name: 'Look' }).click();
        await expect(page.getByTestId('theme-picker')).toBeVisible();
      } },
    { name: 'design save as feature dialog', group: 'design', open: async (page) => {
        await openDesign(page);
        await page.locator('[data-canvas-block][data-layer-id="h1"]').click();
        await page.getByRole('button', { name: 'Save as feature' }).click();
        await expect(page.getByRole('dialog', { name: 'Save as feature' })).toBeVisible();
      } },
    { name: 'design page actions menu', group: 'design', open: async (page) => {
        await openDesign(page);
        await page.getByRole('button', { name: 'Page actions' }).click();
        await expect(page.getByRole('menuitem', { name: 'Add a page' })).toBeVisible();
      } },
    // The Feature builder: empty, with a Table of records and a Quick add on one table slot, and its Save dialog.
    { name: 'feature builder', group: 'features', title: 'New feature, Local App Studio', open: async (page) => {
        await builder(page).openNew();
        await expect(page.getByTestId('slot-panel')).toBeVisible();
      } },
    { name: 'feature builder with slots', group: 'features', open: async (page) => {
        await builder(page).withParts();
        await expect(page.getByTestId('slot-row').first()).toBeVisible();
      } },
    { name: 'feature builder save dialog', group: 'features', open: async (page) => {
        const b = builder(page);
        await b.withParts();
        await b.openSave();
      } },
    { name: 'data', group: 'steps', title: 'Data, Crew Roster, Local App Studio', open: async (page) => {
        await page.goto(path('data'));
        await expect(page.getByRole('navigation', { name: 'Tables' })).toBeVisible();
      } },
    { name: 'preview running', group: 'steps', title: 'Preview, Crew Roster, Local App Studio', open: async (page) => {
        await page.goto(path('preview'));
        await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
      } },
    { name: 'preview enlarged', group: 'steps', open: async (page) => {
        await page.goto(path('preview'));
        await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
        await page.getByRole('button', { name: 'Enlarge', exact: true }).click();
        await expect(page.getByRole('dialog', { name: /, enlarged$/ })).toBeVisible();
      } },
    { name: 'build', group: 'steps', title: 'Build, Crew Roster, Local App Studio', open: async (page) => {
        await page.goto(path('build'));
        await expect(page.getByRole('switch', { name: 'Allow downloads for builds' })).toBeVisible();
      } },
    { name: 'delete app confirm', group: 'apps', open: async (page) => {
        await page.goto('/apps');
        await page.getByRole('button', { name: 'More actions for Midnight Roster' }).click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
      } },
    { name: 'design stuck dialog', group: 'design', open: async (page) => {
        // A Table of records on a new page cannot be connected by itself (two tables), so leaving Design asks first.
        await openDesign(page);
        await addArchivePage(page);
        const first = await page.locator('[data-canvas-block]').first().getAttribute('data-layer-id');
        await page.locator(`[data-canvas-block][data-layer-id="${first}"]`).focus();
        await page.getByRole('button', { name: 'Add here: Page, place 2' }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Add Table of records' }).click();
        await steps(page).getByRole('link', { name: /Data/ }).click();
        await expect(page.getByRole('alertdialog', { name: 'Your changes on Design cannot be saved yet' })).toBeVisible();
      } },
  ];

  // The screens of the helper (Prompt) and the installer (Build) are not in a public build (e2e/support/proBuild.js): they are left out of its list.
  const PRO_SCREENS = new Set(['apps start box', 'prompt idle', 'prompt with your app', 'prompt with a design waiting', 'build']);
  const SCREENS = PUBLIC_BUILD ? ALL_SCREENS.filter((screen) => !PRO_SCREENS.has(screen.name)) : ALL_SCREENS;

  return { ctx, apps, path, openDesign, SCREENS };
}
