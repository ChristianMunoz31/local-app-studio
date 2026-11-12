import { defineConfig, devices } from '@playwright/test';

// Chromium only. No `webServer`: every spec file starts its own sandboxed Local App Studio server in
// beforeAll (e2e/support/appServer.js) so each file gets a fresh data dir. Needs `npm run build`.
// Projects (each matches its folder): flows, first-run, a11y, visual. The visual project only runs
// on Linux, because its baselines are rendered in the pinned Playwright Linux image (see
// scripts/visualUpdate.js); anywhere else it is skipped, never silently compared.
const CI = Boolean(globalThis.process?.env?.CI);
const onLinux = globalThis.process?.platform === 'linux';
// The gate reruns a failed test alone to classify it (scripts/ci/gateClassify.js), so Playwright's own CI retry is off then.
const classifying = globalThis.process?.env?.GATE_CLASSIFY === '1';
// APP_DEBUG=1 (npm run debug:e2e) keeps a video and a screenshot of a failure; PW_VIDEO=on|retain-on-failure sets the video directly.
const debug = globalThis.process?.env?.APP_DEBUG === '1';
const pwVideo = globalThis.process?.env?.PW_VIDEO;
const video = pwVideo === 'on' || pwVideo === 'retain-on-failure' ? pwVideo : debug ? 'retain-on-failure' : 'off';

if (!onLinux && !globalThis.process?.env?.TEST_WORKER_INDEX) {
  console.log('[playwright] visual project skipped: baselines are Linux only (npm run test:visual:update renders them).');
}

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: CI,
  retries: classifying ? 0 : CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    video,
    screenshot: debug ? 'only-on-failure' : 'off',
  },
  projects: [
    { name: 'flows', testMatch: 'flows/**/*.spec.js' },
    { name: 'first-run', testMatch: 'first-run/**/*.spec.js' },
    { name: 'a11y', testMatch: 'a11y/**/*.spec.js' },
    {
      name: 'visual',
      testMatch: 'visual/**/*.spec.js',
      ...(onLinux ? {} : { testIgnore: '**' }),
    },
  ],
});
