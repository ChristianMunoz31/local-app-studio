// The axe run of one route group (DESIGN-phase12.md WP-5, section 1.5; phase 27 split it into one spec file per route group): axe
// (WCAG 2.0/2.1 A and AA) on each listed Studio screen of the group in the light and dark themes. Contrast is studioContrast.spec.js,
// keyboard, motion and titles studioKeyboard.spec.js; every spec file has its own sandbox server (see studioShared.js), so the shards
// also run on separate workers.
//
// Each test gates on serious and critical violations (scan() from support/axe.js) and records all four impact counts as an
// `axe` annotation, "<screen> | <theme> | critical serious moderate minor", for the before and after table.
import { test, expect } from '../support/fixtures.js';
import { scan, describe as describeViolations } from '../support/axe.js';
import { setupStudio, settle, theme } from './studioShared.js';

/** The shards, one spec file each (`group` of a screen in studioShared.js). A screen with a group not listed here fails the run. */
export const AXE_GROUPS = ['apps', 'features', 'prompt', 'design', 'steps'];

/** Registers the axe tests of one group in the calling spec file. */
export function registerAxe(group) {
  const { SCREENS } = setupStudio();
  const unknown = SCREENS.filter((screen) => !AXE_GROUPS.includes(screen.group));
  if (unknown.length > 0) throw new Error(`Studio screens without an axe shard: ${unknown.map((s) => s.name).join(', ')}`);
  for (const mode of ['light', 'dark']) {
    test.describe(`studio axe ${mode}`, () => {
      for (const screen of SCREENS.filter((s) => s.group === group)) {
        test(`${screen.name} has no serious or critical violations`, async ({ page }, testInfo) => {
          await theme(page, mode);
          await screen.open(page);
          await settle(page);
          if (screen.title) await expect(page).toHaveTitle(screen.title);
          const blocking = await scan(page, testInfo, { name: screen.name.replace(/\s+/g, '-'), theme: mode });
          const all = JSON.parse(testInfo.attachments.at(-1).body.toString()).violations;
          const count = (impact) => all.filter((v) => v.impact === impact).length;
          const line = `${screen.name} | ${mode} | ${count('critical')} ${count('serious')} ${count('moderate')} ${count('minor')} | ${all.map((v) => v.id).join(',')}`;
          testInfo.annotations.push({ type: 'axe', description: line });
          expect(describeViolations(blocking), `axe violations on ${screen.name} (${mode})`).toEqual([]);
        });
      }
    });
  }
}
