// scripts/doctor.js: table and JSON output, exit codes, and the fixture seam (APP_DOCTOR_FAKE, read only under Vitest).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../../scripts/doctor.js';

const report = (counts) => ({
  checkedAt: '2026-11-04T10:12:00.000Z',
  lines: [
    { id: 'node', label: 'Node.js', status: 'found', detail: '24.15.0', action: '' },
    { id: 'rustc', label: 'Rust', status: counts.missing ? 'missing' : 'found', detail: '', action: counts.missing ? 'Install Rust.' : '' },
  ],
  counts: { found: 1, missing: 0, problem: 0, ...counts },
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cli-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function cli(argv, rep, env = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => (out += t), err: (t) => (err += t), env, run: rep ? async () => rep : undefined });
  return { code, out, err };
}

describe('doctor CLI', () => {
  it('prints the table and exits 0 even with a missing tool', async () => {
    const r = await cli([], report({ missing: 1 }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('Found    Node.js');
    expect(r.out).toContain('Missing  Rust');
    expect(r.out).toContain('1 found, 1 missing, 0 problems.');
  });

  it('prints the report as JSON', async () => {
    const rep = report({ problem: 1 });
    const r = await cli(['--json'], rep);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual(rep);
  });

  it('exits 1 with --strict on a Missing or Problem line and 0 when all is found', async () => {
    expect((await cli(['--strict'], report({ missing: 1 }))).code).toBe(1);
    expect((await cli(['--strict'], report({ problem: 1 }))).code).toBe(1);
    expect((await cli(['--strict', '--json'], report({}))).code).toBe(0);
  });

  it('refuses an unknown option with exit 2 and the usage line', async () => {
    const r = await cli(['--fix'], report({}));
    expect(r.code).toBe(2);
    expect(r.err).toContain('Usage: npm run doctor');
    expect(r.out).toBe('');
  });

  it('reads a fixture through APP_DOCTOR_FAKE under Vitest only', async () => {
    const file = path.join(dir, 'fixture.json');
    fs.writeFileSync(file, JSON.stringify(report({ missing: 1 })));
    const r = await cli(['--strict'], null, { VITEST: 'true', APP_DOCTOR_FAKE: file });
    expect(r.code).toBe(1);
    expect(r.out).toContain('Missing  Rust');
  });
});
