// The Vite and Vitest aliases of the runtime package (@local-app-studio/runtime, packages/runtime). The package's `exports` map says the
// same for Node and esbuild (through the workspace link in node_modules); tsconfig.json `paths` says it for the type checker. The server
// alias comes first so `@local-app-studio/runtime/server/x.js` never falls into the `src/` rule.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirOf = (relative) => fileURLToPath(new URL(relative, import.meta.url)).replaceAll(path.sep, '/');
const PACKAGE_SERVER = dirOf('../../packages/runtime/server/');
const PACKAGE_SRC = dirOf('../../packages/runtime/src/');
const APP_SRC = dirOf('../../src');

/** Alias entries for `resolve.alias`: the runtime package (server first, then src) and "@/" for the app's src/. */
export const RUNTIME_ALIASES = Object.freeze([
  { find: /^@local-app-studio\/runtime\/server\//, replacement: PACKAGE_SERVER },
  { find: /^@local-app-studio\/runtime\//, replacement: PACKAGE_SRC },
  { find: '@', replacement: APP_SRC },
]);
