// Process entry point of the desktop sidecar bundle (scripts/desktop/buildSidecar.js) and of the dev parser
// child. It only decides the role, then loads the matching module lazily:
//   --role parser  ->  server/ingest/parserChild.js (reads one job on stdin, never loads server.js)
//   --role preview ->  server.js as a runtime-mode preview child of Local App Studio (needs APP_MODE=runtime and APP_SPEC_PATH)
//   (no role)      ->  server.js (the app)
// The role switch cannot live inside server.js: a top-level await in the first import of an ES module does
// not hold back its sibling imports, so server.js's whole import graph (loadEnv.js, the database modules)
// would still evaluate in a parser process. Nothing is statically imported here except ./role.js.
// `npm start`, `npm run desktop:dev` and the tests keep running server.js directly.
import { previewEnvProblem, roleFromArgv, withoutRoleArgs } from './role.js';

/* global __APP_SOURCEMAPS__ */
// Dev builds bake __APP_SOURCEMAPS__ in (buildSidecar.js --sourcemap) so stack traces name real files; APP_SOURCE_MAPS=1 does the same by hand.
if ((typeof __APP_SOURCEMAPS__ === 'boolean' && __APP_SOURCEMAPS__) || process.env.APP_SOURCE_MAPS === '1') process.setSourceMapsEnabled(true);

// Early guard: one stderr line (error name and code only), exit 1. For the server and preview roles server/processGuards.js
// removes it through this symbol once it installs its own handlers; for the parser role it stays.
const entryGuard = (err) => {
  try {
    console.error('Unexpected error.', err?.name ?? 'unknown', err?.code ?? '');
  } finally {
    process.exit(1);
  }
};
globalThis[Symbol.for('las.entryGuard')] = entryGuard;
process.on('uncaughtException', entryGuard);

let role = null;
try {
  role = roleFromArgv(process.argv);
} catch (err) {
  console.error(err instanceof Error ? err.message : 'Invalid command line.');
  process.exit(2);
}

const fail = (err) => {
  console.error(role === 'parser' ? 'Parser failed to start.' : role === 'preview' ? 'Preview failed to start.' : 'Server failed to start.', err?.code ?? err?.name ?? 'unknown');
  process.exit(1);
};

if (role === 'parser') {
  import('./ingest/parserChild.js').then((mod) => mod.runParserChild(), fail).catch(fail);
} else {
  // One server branch for the app and the preview role, so the bundle loads server.js from exactly one place.
  const problem = role === 'preview' ? previewEnvProblem(process.env) : null;
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
  // server.js refuses any --role in argv (it guards the parser role), so drop it before importing.
  if (role === 'preview') process.argv.splice(0, process.argv.length, ...withoutRoleArgs(process.argv));
  import('../server.js').catch((err) => {
    if (role === 'preview') return fail(err);
    console.error(err);
    return process.exit(1);
  });
}
