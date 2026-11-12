// scripts/desktop/smokeParser.js: a sidecar it was asked to smoke-test must exist, otherwise it exits 1 loudly.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('smokeParser', () => {
  it('exits 1 with a clear message when the given sidecar does not exist', () => {
    const missing = path.join(os.tmpdir(), 'no-such-dir', 'session-ledger-server.exe');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'desktop', 'smokeParser.js'), '--sidecar', missing], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`sidecar not found: ${path.resolve(missing)}`);
  });

  it('no longer hardcodes the kit sidecar name', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'desktop', 'smokeParser.js'), 'utf8');
    expect(src).not.toContain('local-app-studio-server');
    expect(src).toContain('sidecarExeName');
  });
});
