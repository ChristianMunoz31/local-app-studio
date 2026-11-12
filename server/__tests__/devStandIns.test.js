// scripts/desktop/lib.js ensureDevStandIns: a fresh checkout can run `tauri dev` without a prior sidecar build.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDevStandIns, STAND_IN_TEXT } from '../../scripts/desktop/lib.js';

const dirs = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-standins-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'server', 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server', 'db', 'migrations', '001_init.sql'), 'select 1;\n');
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('ensureDevStandIns', () => {
  it('creates the sidecar, dist and migrations stand-ins on a fresh tree', () => {
    const root = fixture();
    const created = ensureDevStandIns({ root, triple: 'aarch64-pc-windows-msvc' });
    const bin = path.join(root, 'src-tauri', 'binaries', 'local-app-studio-server-aarch64-pc-windows-msvc.exe');
    expect(created).toHaveLength(3);
    expect(fs.readFileSync(bin, 'utf8')).toBe(STAND_IN_TEXT);
    expect(fs.existsSync(path.join(root, 'src-tauri', 'resources', 'dist', 'index.html'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src-tauri', 'resources', 'migrations', '001_init.sql'), 'utf8')).toBe('select 1;\n');
  });

  it('never touches files that already exist (a real sidecar stays)', () => {
    const root = fixture();
    const bin = path.join(root, 'src-tauri', 'binaries', 'local-app-studio-server-x86_64-unknown-linux-gnu');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, 'REAL');
    const created = ensureDevStandIns({ root, triple: 'x86_64-unknown-linux-gnu' });
    expect(created.some((p) => p === bin)).toBe(false);
    expect(fs.readFileSync(bin, 'utf8')).toBe('REAL');
    expect(ensureDevStandIns({ root, triple: 'x86_64-unknown-linux-gnu' })).toEqual([]);
  });
});
