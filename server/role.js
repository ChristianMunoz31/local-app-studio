// Process role from the command line. The sidecar executable is also the document parser (the parser host starts it
// again with `--role parser`, docs/INGEST.md) and, in Local App Studio, the preview server (`--role preview`). Pure helper, no side effects, imported first by
// server/entry.js.
import path from 'node:path';

/** Roles other than the default server. */
export const ROLES = Object.freeze(['parser', 'preview']);

/**
 * The role named by `--role <name>` or `--role=<name>` in `argv`, or null for the normal server.
 * Strict on purpose: an unknown, missing or repeated role is an error, so a typo never starts the
 * server (and its database) by accident. `argv[0]` (the executable) is not scanned.
 * @param {readonly string[]} argv usually process.argv
 * @returns {'parser' | 'preview' | null}
 * @throws {Error} on an unknown, missing or repeated role (the message names no user input)
 */
export function roleFromArgv(argv) {
  let role = null;
  let seen = 0;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    let value;
    if (arg === '--role') value = argv[i + 1];
    else if (typeof arg === 'string' && arg.startsWith('--role=')) value = arg.slice('--role='.length);
    else continue;
    seen += 1;
    if (!ROLES.includes(value)) throw new Error(`Unknown or missing --role value. Supported roles: ${ROLES.join(', ')}.`);
    role = value;
  }
  if (seen > 1) throw new Error('--role may be given only once.');
  return role;
}

/* global __APP_MODE__ */
const BAKED_MODE = typeof __APP_MODE__ === 'string' ? __APP_MODE__ : undefined;

/**
 * Why the preview role must not start, or null. Pure.
 * @param {Record<string, string | undefined>} [env]
 * @param {string | undefined} [bakedMode] the build-time app mode, when bundled
 * @returns {string | null}
 */
export function previewEnvProblem(env = process.env, bakedMode = BAKED_MODE) {
  if (bakedMode === 'runtime') return 'The preview role exists only in Local App Studio.';
  if (env.APP_MODE !== 'runtime') return 'The preview role needs APP_MODE=runtime.';
  const specPath = (env.APP_SPEC_PATH || '').trim();
  if (!specPath || !path.isAbsolute(specPath)) return 'The preview role needs APP_SPEC_PATH (an absolute path).';
  return null;
}

/**
 * argv without the --role flag and its value (both forms).
 * @param {readonly string[]} argv
 * @returns {string[]}
 */
export function withoutRoleArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (i > 0 && argv[i] === '--role') i += 1;
    else if (i > 0 && typeof argv[i] === 'string' && argv[i].startsWith('--role=')) continue;
    else out.push(argv[i]);
  }
  return out;
}
