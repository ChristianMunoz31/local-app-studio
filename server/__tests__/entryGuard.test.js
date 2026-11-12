// The early guard in server/entry.js: the parser role has no other handler, so an uncaught error ends it with exit 1.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'entry.js');
const PRELOAD = 'data:text/javascript,setTimeout(()=>{throw%20new%20TypeError("boom")},300)';

describe('entry early guard', () => {
  it('exits 1 on an uncaught throw in the parser role, with the error name only', async () => {
    const child = spawn(process.execPath, ['--import', PRELOAD, ENTRY, '--role', 'parser'], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH },
    });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    const timer = setTimeout(() => child.kill(), 8000);
    const code = await new Promise((resolve) => child.on('close', resolve));
    clearTimeout(timer);
    expect(code).toBe(1);
    expect(stderr).toContain('TypeError');
    expect(stderr).not.toContain('boom');
  }, 15000);
});
