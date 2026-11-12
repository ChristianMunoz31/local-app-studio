import os from 'node:os';
import { configDefaults, defineConfig } from 'vitest/config';
import { resolveProDir } from './scripts/lib/proDir.js';
import { proSeamVitePlugin } from './scripts/lib/proSeam.js';
import { RUNTIME_ALIASES } from './scripts/lib/runtimeAlias.js';

// Pool and worker count (phase 11, WP9). Measured 2026-11-03 on 10 cores, 15 GB, Windows 11, Node 24, Vitest 5.0.3,
// full suite (511 files, 9525 tests), `--maxWorkers=4` because other test runs were using the machine at the same time, so 6 and
// 8 workers are NOT measured yet (they need a quiet machine). Wall seconds and peak MB of the whole process tree:
//   forks (the default), pure project isolated .......... 214.8 s, 2307 MB   <- chosen
//   threads ............................................. 228.2 s, 2096 MB
//   forks, pure project with isolate: false ............. 217.6 s, 2272 MB  (no gain, so every project isolates)
//   forks, frontend on vmThreads ........................ 167.0 s, 4108 MB, 42 tests fail (ReadableStream is not
//                                                          defined in the VM context, `location` cannot be redefined)
// Before the pure project (fac769b, two projects): 317.8 s to 344.2 s, 2305 to 2456 MB.
// Phase 27 (frontend project, quiet machine, docs/PIPELINE.md): 4 workers 303.2 s and 2416 MB, 6 workers 240.7 s and 3366 MB with one load flake
// (designNewTable.dialog), so the default stays 4; 8 workers were not measured. Each extra jsdom worker adds about 500 MB. Set
// VITEST_MAX_WORKERS to try another count; CI has fewer cores, so the count is capped at cores minus one.
const TUNED_MAX_WORKERS = 4;

/**
 * The worker count: `raw` (VITEST_MAX_WORKERS) when it is an integer from 1 to the core count, else the tuned fallback
 * (so -1, 0, 2.5, "abc" or a huge value never reach Vitest).
 * @param {string | undefined} raw
 * @param {number} cores
 * @returns {number}
 */
export function resolveMaxWorkers(raw, cores) {
  const wanted = /^[0-9]+$/.test(String(raw ?? '').trim()) ? Number(raw) : NaN;
  if (Number.isInteger(wanted) && wanted >= 1 && wanted <= cores) return wanted;
  return Math.max(1, Math.min(TUNED_MAX_WORKERS, cores - 1));
}
const MAX_WORKERS = resolveMaxWorkers(process.env.VITEST_MAX_WORKERS, os.availableParallelism());

// Same aliases as vite.config.js (projects do not inherit them): "@/" -> src/ and the runtime package.
const SRC_ALIAS = RUNTIME_ALIASES;

// The pro seam (scripts/lib/proDir.js): a pro run swaps each seam stub for its twin under pro/ and also runs the tests under pro/;
// a public run (APP_PRO_DIR=none, or no pro/ folder) keeps the stubs and refuses any file under pro/. Tests read the mode from
// APP_PRO_MODE (server/__tests__/helpers/proBuild.js).
const PRO = resolveProDir(process.env);
const IS_PRO = PRO.mode === 'pro';

// The developer's own OLLAMA_HOST and .env must never steer a test. Both projects blank OLLAMA_HOST
// and disable dotenv loading; the original OLLAMA_HOST is forwarded (config runs before the
// override) so the network guard can also block a custom local Ollama port.
const ISOLATED_ENV = {
  OLLAMA_HOST: '',
  APP_NO_DOTENV: '1',
  APP_GUARD_OLLAMA_HOST: process.env.OLLAMA_HOST ?? '',
  APP_PRO_MODE: PRO.mode,
};

// Time limits only (they never slow a passing run). With every core busy, trivial tests take 10 s
// or more and server.js imports take 20 s, so the 5 s / 10 s Vitest defaults flake.
const LOAD_LIMITS = {
  frontend: { testTimeout: 20_000, hookTimeout: 30_000 },
  // Each backup, upload inspection and restore step starts a worker thread (about 60 ms idle,
  // several times that on a loaded machine).
  backend: { testTimeout: 45_000, hookTimeout: 60_000 },
};

// src .js/.ts tests that need a DOM (document, window, localStorage or React hooks), found by
// running every src .js/.ts test in node: these 13 files were the only ones that failed there,
// each with "document/window/localStorage/HTMLAnchorElement is not defined". Every other src
// .js/.ts test runs in the node "pure" project and skips the jsdom setup. A new file that needs
// a DOM either goes in this list or is written as .jsx/.tsx (always jsdom).
export const SRC_DOM_TESTS = [
  'src/hooks/__tests__/useAssistant.actions.test.js',
  'src/hooks/__tests__/useAssistant.cloud.test.js',
  'src/hooks/__tests__/useAssistant.test.js',
  'packages/runtime/src/runtime/__tests__/dataClient.test.js',
  'src/services/__tests__/exportService.test.js',
  'src/studio/design/__tests__/keptConnections.test.ts',
  'src/studio/hooks/__tests__/useBuild.test.ts',
  'src/studio/hooks/__tests__/useFeatures.test.ts',
  'src/studio/showcase/__tests__/recent.test.ts',
  'packages/runtime/src/theme/__tests__/applyRoot.test.ts',
  'src/utils/__tests__/dataChanged.test.js',
  'src/utils/__tests__/indexHtmlPrepaint.test.js',
  'src/utils/__tests__/syncMode.test.js',
];

// Three projects so the Node/Express backend is tested in a real `node`
// environment while the existing React/util suite keeps its jsdom DOM.
export default defineConfig({
  test: {
    maxWorkers: MAX_WORKERS,
    // Off by default; `npm run test:coverage` and the CI unit-test step switch it on.
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
    projects: [
      {
        resolve: { alias: SRC_ALIAS },
        plugins: [proSeamVitePlugin(PRO)],
        test: {
          name: 'frontend',
          environment: 'jsdom',
          globals: false,
          include: ['src/**/__tests__/**/*.test.{jsx,tsx}', 'packages/runtime/src/**/__tests__/**/*.test.{jsx,tsx}', ...(IS_PRO ? ['pro/src/**/__tests__/**/*.test.{jsx,tsx}'] : []), ...SRC_DOM_TESTS],
          setupFiles: ['server/__tests__/setup/networkGuard.js', 'src/__tests__/setup/testingLibrary.js'],
          ...LOAD_LIMITS.frontend,
          env: { ...ISOLATED_ENV },
        },
      },
      {
        resolve: { alias: SRC_ALIAS },
        plugins: [proSeamVitePlugin(PRO)],
        test: {
          name: 'pure',
          environment: 'node',
          globals: false,
          include: ['src/**/__tests__/**/*.test.{js,ts}', 'packages/runtime/src/**/__tests__/**/*.test.{js,ts}', ...(IS_PRO ? ['pro/src/**/__tests__/**/*.test.{js,ts}'] : [])],
          exclude: [...configDefaults.exclude, ...SRC_DOM_TESTS],
          setupFiles: ['server/__tests__/setup/networkGuard.js'],
          ...LOAD_LIMITS.frontend,
          env: { ...ISOLATED_ENV },
        },
      },
      {
        resolve: { alias: SRC_ALIAS },
        plugins: [proSeamVitePlugin(PRO)],
        test: {
          name: 'backend',
          environment: 'node',
          globals: false,
          ...LOAD_LIMITS.backend,
          include: ['server/__tests__/**/*.test.js', 'packages/runtime/server/**/__tests__/**/*.test.js', ...(IS_PRO ? ['pro/server/__tests__/**/*.test.js'] : [])],
          // networkGuard first: blocks real connections to remote hosts and to the developer's
          // own Ollama/Local App Studio/Vite ports so tests behave the same locally and in CI.
          setupFiles: ['server/__tests__/setup/networkGuard.js', 'server/__tests__/setup/dataDir.js'],
          // Tests give each request its own client IP via X-Forwarded-For; that is only
          // honored when a proxy is trusted. Local App Studio itself defaults to trusting none.
          // The network opt-ins default OFF here, like production; tests that need a
          // feature turn it on through netPolicy.
          env: {
            ...ISOLATED_ENV,
            APP_TRUST_PROXY: '1',
            APP_NETWORK_OPTIN: '',
          },
        },
      },
    ],
  },
});
