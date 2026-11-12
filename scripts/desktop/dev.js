// Runs `tauri dev` against a throwaway data dir and `node server.js` (no SEA build needed).
// The shell still starts the server with a minimal env, a secret on stdin and the ready handshake.
// Guards: the data dir is always a fresh folder under the OS temp dir (never the real data dir).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDevStandIns, ROOT, runTauri } from './lib.js';
import { assertSafeDataDir, resolveNpmCli } from '../lib/sandboxSafety.js';

try {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    const res = spawnSync(process.execPath, [resolveNpmCli(), 'run', 'build'], { cwd: ROOT, env: process.env, stdio: 'inherit', shell: false });
    if (res.status !== 0) throw new Error('npm run build failed');
  }
  for (const p of ensureDevStandIns()) console.log(`created dev stand-in: ${path.relative(ROOT, p)}`);
  const dataDir = assertSafeDataDir(path.join(os.tmpdir(), 'local-app-studio-desktop-dev', String(Date.now())));
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`desktop dev data dir: ${dataDir}`);
  runTauri(['dev'], {
    ...process.env,
    APP_DESKTOP_DATA_DIR: dataDir,
    APP_DEV_NODE: process.execPath,
    // devServer.js registers the pro seam hook, then loads server.js. The shell drops NODE_OPTIONS and runs `node <entry>` with no
    // other flags, so the hook cannot be passed as `--import` here.
    APP_DEV_ENTRY: path.join(ROOT, 'devServer.js'),
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
