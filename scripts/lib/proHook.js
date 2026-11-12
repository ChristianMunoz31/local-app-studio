// `node --import ./scripts/lib/proHook.js server.js`: applies the pro seam to an unbundled run (docs/ARCHITECTURE.md).
// It resolves the build once, registers the resolve hook in a pro build and writes the decision back to
// the APP_PRO_DIR variable (`none` or the absolute folder) so every child process (the Preview child) agrees.
import { register } from 'node:module';
import { resolveProDir } from './proDir.js';

const resolved = resolveProDir(process.env);
process.env.APP_PRO_DIR = resolved.mode === 'pro' ? String(resolved.dir) : 'none';
if (resolved.mode === 'pro') register('./proResolveHook.js', import.meta.url, { data: { dir: resolved.dir, mode: 'pro' } });
