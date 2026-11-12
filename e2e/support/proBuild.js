// Which build do the e2e tests run against? The server (e2e/support/appServer.js) and the Vite build in dist/ both follow APP_PRO_DIR
// (scripts/lib/proDir.js), so a public run needs `APP_PRO_DIR=none npm run build` first, then `APP_PRO_DIR=none npx playwright test`.
//
// A test that needs a pro part (the helper behind Prompt and Make my app, the installer behind Build) is tagged `@pro` in its
// options and calls skipWithoutPro as its first statement, or at the top of the file when every test needs it:
//
//   test('Make my app ...', { tag: '@pro' }, async ({ page }) => {
//     skipWithoutPro(test, 'the helper is not in a public build');
//     ...
//   });
//
// The skip carries its reason and the assertions stay as they are. `--grep @pro` and `--grep-invert @pro` pick either half.
import { resolveProDir } from '../../scripts/lib/proDir.js';

/** True when this run is a public build (APP_PRO_DIR=none, or no pro/ folder). */
export const PUBLIC_BUILD = resolveProDir(process.env).mode === 'public';

/**
 * Skips the test (or, at the top of a file or describe, every test in it) under a public build.
 * @param {import('@playwright/test').TestType<any, any>} test the Playwright `test` of the calling file
 * @param {string} reason why the test needs the pro part; shown in the report
 */
export function skipWithoutPro(test, reason) {
  test.skip(PUBLIC_BUILD, reason);
}
