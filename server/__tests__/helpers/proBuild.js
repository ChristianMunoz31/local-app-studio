// Is this test run a public build (APP_PRO_DIR=none, or no pro/ folder)? vitest.config.js sets APP_PRO_MODE.
// A test that needs a pro module skips itself under a public build, and every skip carries its reason:
//
//   import { PUBLIC_BUILD } from './helpers/proBuild.js';
//   it('x', (ctx) => { ctx.skip(PUBLIC_BUILD, 'needs the helper, which is not in a public build'); ... });
//   describe.skipIf(PUBLIC_BUILD)('x (needs the helper, which is not in a public build)', () => { ... });
export const PUBLIC_BUILD = process.env.APP_PRO_MODE === 'public';
