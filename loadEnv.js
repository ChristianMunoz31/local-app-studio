// Loads environment variables. Imported FIRST by server.js so that the env is
// populated before any other module (e.g. the SQLite layer resolving APP_DATA_DIR) reads process.env
// at import time - ESM evaluates imported modules in source order, so this must
// come before those imports to take effect.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { envFileAssignments } from './server/envFiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Precedence lives in envFileAssignments: the primary file beats the shell (e.g. when a parent process has the var set to
// empty) and the local file only fills gaps. APP_NO_DOTENV=1 (the sandbox/preview scripts set it so the owner's file can
// never repoint the data dir or port of a throwaway server) and desktop mode (the shell owns the sidecar's environment)
// skip both files.
// Only the keys the files contribute are written, so inherited variables are never reassigned.
Object.assign(process.env, envFileAssignments(__dirname));
