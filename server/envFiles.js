// The one definition of how dotenv files combine with the shell environment. loadEnv.js applies it to process.env for the
// server; vite.config.js reads it without mutating anything so the dev proxy sees the same values the server will.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { isDesktopMode } from './runtime.js';

/**
 * @param {string} file
 * @returns {Record<string, string>} parsed entries, or {} when the file is missing or unreadable
 */
function parseEnvFile(file) {
  try {
    return dotenv.parse(fs.readFileSync(file));
  } catch {
    return {};
  }
}

/**
 * The name `key` already has in `view`, or undefined. On Windows process.env keys are case-insensitive, so the match
 * ignores case there; elsewhere it is exact.
 * @param {Record<string, string | undefined>} view
 * @param {string} key
 * @param {boolean} insensitive
 * @returns {string | undefined}
 */
function existingName(view, key, insensitive) {
  if (Object.prototype.hasOwnProperty.call(view, key)) return key;
  if (!insensitive) return undefined;
  const lower = key.toLowerCase();
  return Object.keys(view).find((name) => name.toLowerCase() === lower);
}

/**
 * Only the entries the files contribute: the primary file (wins over the shell, even over an empty value), then the local
 * file (only fills keys that are still unset). APP_NO_DOTENV=1 and desktop mode skip both files and yield {}. On win32 keys
 * match case-insensitively, as process.env does, and a file entry keeps the name the key already has in `env`, so the result
 * never holds two spellings of one variable. Pure: `env` is not mutated.
 * @param {string} dir Folder holding the files (the repo root).
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platform] process.platform; injectable for tests
 * @returns {Record<string, string>} key/value pairs to apply on top of `env`
 */
export function envFileAssignments(dir, env = process.env, platform = process.platform) {
  const assignments = {};
  if (env.APP_NO_DOTENV === '1' || isDesktopMode(env)) return assignments;
  const insensitive = platform === 'win32';
  const view = { ...env };
  const set = (key, value, onlyIfUnset) => {
    const name = existingName(view, key, insensitive);
    if (onlyIfUnset && name !== undefined) return;
    const target = name ?? key;
    view[target] = value;
    assignments[target] = value;
  };
  for (const [key, value] of Object.entries(parseEnvFile(path.join(dir, '.env')))) set(key, value, false);
  for (const [key, value] of Object.entries(parseEnvFile(path.join(dir, '.env.local')))) set(key, value, true);
  return assignments;
}

/**
 * The environment the server runs with: `env` plus envFileAssignments. Pure: `env` is not mutated.
 * @param {string} dir Folder holding the files (the repo root).
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platform] process.platform; injectable for tests
 * @returns {Record<string, string | undefined>} a new object
 */
export function mergeEnvFiles(dir, env = process.env, platform = process.platform) {
  return { ...env, ...envFileAssignments(dir, env, platform) };
}
