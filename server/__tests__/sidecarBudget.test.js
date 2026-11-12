// scripts/checks/sidecarBudget.js: the sidecar size limit behind check:sidecar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, main, measure, moduleTable, moduleTableToMarkdown, resolveCheckMode, toMarkdown } from '../../scripts/checks/sidecarBudget.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const budget = { studio: { bundleKb: 100, bundleGzipKb: 10 }, runtime: { bundleKb: 50, bundleGzipKb: 5 }, exeKb: { 'win32-x64': 1000 } };

describe('measure', () => {
  it('reports KiB with two decimals, the gzip size, and the exe only when given', () => {
    const bundle = Buffer.alloc(2048, 'a');
    const out = measure({ bundle });
    expect(out.bundleKb).toBe(2);
    expect(out.bundleGzipKb).toBe(Math.round((gzipSync(bundle).length / 1024) * 100) / 100);
    expect(out).not.toHaveProperty('exeKb');
    expect(measure({ bundle, exe: 1536 }).exeKb).toBe(1.5);
  });

  it('accepts a string bundle', () => {
    expect(measure({ bundle: 'x'.repeat(1024) }).bundleKb).toBe(1);
  });
});

describe('evaluate', () => {
  it('passes at or under the budget', () => {
    const r = evaluate({ bundleKb: 100, bundleGzipKb: 9.99, exeKb: 999 }, budget, 'win32-x64');
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.key)).toEqual(['bundleKb', 'bundleGzipKb', 'exeKb']);
  });

  it('fails when any metric is over', () => {
    expect(evaluate({ bundleKb: 100.01, bundleGzipKb: 1, exeKb: 1 }, budget, 'win32-x64').ok).toBe(false);
    expect(evaluate({ bundleKb: 1, bundleGzipKb: 10.5, exeKb: 1 }, budget, 'win32-x64').ok).toBe(false);
    const over = evaluate({ bundleKb: 1, bundleGzipKb: 1, exeKb: 1001 }, budget, 'win32-x64');
    expect(over.ok).toBe(false);
    expect(over.rows.find((x) => x.key === 'exeKb').ok).toBe(false);
  });

  it('picks the limits of the requested app mode, studio by default', () => {
    const measured = { bundleKb: 60, bundleGzipKb: 6 };
    expect(evaluate(measured, budget, 'win32-x64').ok).toBe(true);
    expect(evaluate(measured, budget, 'win32-x64', 'studio').ok).toBe(true);
    const runtime = evaluate(measured, budget, 'win32-x64', 'runtime');
    expect(runtime.ok).toBe(false);
    expect(runtime.rows.map((r) => [r.key, r.budget])).toEqual([['bundleKb', 50], ['bundleGzipKb', 5]]);
    expect(evaluate({ bundleKb: 50, bundleGzipKb: 5 }, budget, 'win32-x64', 'runtime').ok).toBe(true);
  });

  it('fails a mode the budget has no limits for', () => {
    expect(evaluate({ bundleKb: 1, bundleGzipKb: 1 }, { exeKb: {} }, 'win32-x64', 'runtime').ok).toBe(false);
  });

  it('keys the exe budget by platform and CPU', () => {
    expect(evaluate({ bundleKb: 1, bundleGzipKb: 1, exeKb: 99999 }, budget, 'win32-arm64').rows).toHaveLength(2);
    expect(evaluate({ bundleKb: 1, bundleGzipKb: 1, exeKb: 99999 }, budget, 'win32').rows).toHaveLength(2);
    expect(evaluate({ bundleKb: 1, bundleGzipKb: 1, exeKb: 99999 }, budget, 'win32-x64').ok).toBe(false);
  });

  it('skips the exe row when it was not built or the platform has no budget', () => {
    expect(evaluate({ bundleKb: 1, bundleGzipKb: 1 }, budget, 'win32-x64').rows).toHaveLength(2);
    expect(evaluate({ bundleKb: 1, bundleGzipKb: 1, exeKb: 99999 }, budget, 'linux-x64').rows).toHaveLength(2);
    expect(evaluate({ bundleKb: 1, bundleGzipKb: 1, exeKb: 99999 }, budget, 'linux-x64').ok).toBe(true);
  });
});

describe('resolveCheckMode', () => {
  it('reads --mode, else APP_MODE, else studio (no baked spec)', () => {
    expect(resolveCheckMode([], {})).toBe('studio');
    expect(resolveCheckMode([], { APP_MODE: 'runtime' })).toBe('runtime');
    expect(resolveCheckMode([], { APP_MODE: '  ' })).toBe('studio');
    expect(resolveCheckMode(['--mode', 'runtime'], {})).toBe('runtime');
    expect(resolveCheckMode(['--mode=studio'], { APP_MODE: 'runtime' })).toBe('studio');
  });

  it('defaults to runtime when the root has config/app-spec.json, like the build; --mode and APP_MODE still win', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-budget-root-'));
    try {
      expect(resolveCheckMode([], {}, root)).toBe('studio');
      fs.mkdirSync(path.join(root, 'config'));
      fs.writeFileSync(path.join(root, 'config', 'app-spec.json'), '{}');
      expect(resolveCheckMode([], {}, root)).toBe('runtime');
      expect(resolveCheckMode(['--mode', 'studio'], {}, root)).toBe('studio');
      expect(resolveCheckMode([], { APP_MODE: 'studio' }, root)).toBe('studio');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects anything else', () => {
    expect(() => resolveCheckMode(['--mode', 'prod'], {})).toThrow(/--mode must be one of studio, runtime/);
    expect(() => resolveCheckMode(['--mode'], {})).toThrow(/--mode must be/);
    expect(() => resolveCheckMode([], { APP_MODE: 'prod' })).toThrow(/APP_MODE/);
  });
});

describe('toMarkdown', () => {
  it('has the heading and the same columns as the bundle budget', () => {
    const { rows } = evaluate({ bundleKb: 1, bundleGzipKb: 20 }, budget, 'win32-x64');
    const md = toMarkdown(rows);
    expect(md.split('\n')[0]).toBe('### Sidecar size (KiB)');
    expect(md).toContain('| Metric | Measured | Budget | Status |');
    expect(md).toContain('| bundleKb | 1 | 100 | ok |');
    expect(md).toContain('| bundleGzipKb | 20 | 10 | OVER |');
  });
});

describe('moduleTable', () => {
  const metafile = {
    outputs: {
      'out/server.cjs': {
        bytes: 1000,
        inputs: { 'a.js': { bytesInOutput: 600 }, 'b.js': { bytesInOutput: 300 }, 'c.js': { bytesInOutput: 100 }, 'dead.js': { bytesInOutput: 0 } },
      },
    },
  };

  it('sorts by raw bytes, apportions gzip by raw share and drops inputs with no bytes in the output', () => {
    const t = moduleTable(metafile, { gzipBytes: 500 });
    expect(t.rows).toEqual([
      { file: 'a.js', rawBytes: 600, gzipBytes: 300 },
      { file: 'b.js', rawBytes: 300, gzipBytes: 150 },
      { file: 'c.js', rawBytes: 100, gzipBytes: 50 },
    ]);
    expect(t.totalRawBytes).toBe(1000);
    expect(t.totalGzipBytes).toBe(500);
    expect(t.otherRawBytes).toBe(0);
  });

  it('keeps the top N and rolls the rest into one row so the columns still add up', () => {
    const t = moduleTable(metafile, { gzipBytes: 500, top: 2 });
    expect(t.rows.map((r) => r.file)).toEqual(['a.js', 'b.js']);
    expect(t.otherRawBytes).toBe(100);
    expect(t.otherGzipBytes).toBe(50);
  });

  it('adds the same file across outputs and survives an empty metafile', () => {
    const two = { outputs: { x: { bytes: 1, inputs: { 'a.js': { bytesInOutput: 5 } } }, y: { bytes: 1, inputs: { 'a.js': { bytesInOutput: 7 } } } } };
    expect(moduleTable(two, { gzipBytes: 10 }).rows).toEqual([{ file: 'a.js', rawBytes: 12, gzipBytes: 10 }]);
    expect(moduleTable({}, { gzipBytes: 10 })).toMatchObject({ rows: [], totalRawBytes: 0, otherGzipBytes: 0 });
  });

  it('renders KiB rows, the rest and the totals as markdown', () => {
    const md = moduleTableToMarkdown(moduleTable({ outputs: { o: { bytes: 1, inputs: { 'big.js': { bytesInOutput: 2048 }, 'small.js': { bytesInOutput: 1024 } } } } }, { gzipBytes: 1536, top: 1 }));
    expect(md.split('\n')[0]).toContain('Top 1 modules');
    expect(md).toContain('| big.js | 2 | 1 |');
    expect(md).toContain('| (all other inputs) | 1 | 0.5 |');
    expect(md).toContain('| total of inputs | 3 | 1.5 |');
  });
});

describe('main', () => {
  const quiet = (fn) => {
    const lines = [];
    const spies = [vi.spyOn(console, 'error').mockImplementation((m) => lines.push(String(m))), vi.spyOn(console, 'log').mockImplementation((m) => lines.push(String(m)))];
    try {
      return { code: fn(), text: lines.join('\n') };
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  };
  const withBundle = (bytes, check) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-budget-'));
    try {
      const bundleFile = path.join(dir, 'server.cjs');
      fs.writeFileSync(bundleFile, bytes);
      check(quiet(() => main({}, { bundleFile, exeFile: path.join(dir, 'none.exe') })));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  };

  it('prints the module table when a metafile sits next to the bundle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-budget-'));
    try {
      const bundleFile = path.join(dir, 'server.cjs');
      fs.writeFileSync(bundleFile, 'x'.repeat(2048));
      fs.writeFileSync(path.join(dir, 'metafile.json'), JSON.stringify({ outputs: { o: { bytes: 1, inputs: { 'server/entry.js': { bytesInOutput: 2048 } } } } }));
      const { text } = quiet(() => main({}, { bundleFile, exeFile: path.join(dir, 'none.exe') }));
      expect(text).toContain('| server/entry.js | 2 |');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('answers 1 with the build hint when there is no bundle', () => {
    const { code, text } = quiet(() => main({}, { bundleFile: path.join(os.tmpdir(), 'no-such-bundle.cjs') }));
    expect(code).toBe(1);
    expect(text).toContain('check:sidecar needs a bundle. Run node scripts/desktop/buildSidecar.js --minify --bundle-only first.');
  });

  it('answers 0 for a small bundle, skipping the exe when there is none', () => {
    withBundle('x'.repeat(1024), ({ code, text }) => {
      expect(code).toBe(0);
      expect(text).toContain('### Sidecar size (KiB)');
      expect(text).toContain(`exe: not built or no budget for ${process.platform}-${process.arch}, skipped`);
    });
  });

  it('skips an exe older than the bundle, with a note', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-budget-'));
    try {
      const bundleFile = path.join(dir, 'server.cjs');
      const exeFile = path.join(dir, 'app-server.exe');
      fs.writeFileSync(bundleFile, 'x'.repeat(1024));
      fs.writeFileSync(exeFile, 'y'.repeat(1024));
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(exeFile, old, old);
      const { code, text } = quiet(() => main({}, { bundleFile, exeFile }));
      expect(code).toBe(0);
      expect(text).toContain('exe: older than the bundle, skipped (rebuild without --bundle-only to measure it)');
      expect(text).not.toContain('exeKb');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('checks the runtime limits with --mode or APP_MODE, and fails an unknown mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-budget-'));
    try {
      const bundleFile = path.join(dir, 'server.cjs');
      fs.writeFileSync(bundleFile, Buffer.alloc(3550 * 1024, 7));
      const exeFile = path.join(dir, 'none.exe');
      expect(quiet(() => main({}, { bundleFile, exeFile })).code).toBe(0);
      const viaArg = quiet(() => main({}, { bundleFile, exeFile, argv: ['--mode', 'runtime'] }));
      expect(viaArg.code).toBe(1);
      expect(viaArg.text).toContain('app mode: runtime');
      expect(quiet(() => main({ APP_MODE: 'runtime' }, { bundleFile, exeFile })).code).toBe(1);
      const bad = quiet(() => main({}, { bundleFile, exeFile, argv: ['--mode', 'nope'] }));
      expect(bad.code).toBe(1);
      expect(bad.text).toContain('--mode must be one of studio, runtime');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('fails when the recorded app mode of the bundle differs from the requested one, and notes a missing record', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-budget-'));
    try {
      const bundleFile = path.join(dir, 'server.cjs');
      const metaFile = path.join(dir, 'bundle-meta.json');
      const exeFile = path.join(dir, 'none.exe');
      fs.writeFileSync(bundleFile, 'x'.repeat(1024));
      const missing = quiet(() => main({}, { bundleFile, exeFile }));
      expect(missing.code).toBe(0);
      expect(missing.text).toContain('no bundle-meta.json');
      fs.writeFileSync(metaFile, JSON.stringify({ appMode: 'runtime' }));
      const mismatch = quiet(() => main({}, { bundleFile, exeFile }));
      expect(mismatch.code).toBe(1);
      expect(mismatch.text).toContain('built in runtime mode but studio was requested');
      expect(quiet(() => main({}, { bundleFile, exeFile, argv: ['--mode', 'runtime'] })).code).toBe(0);
      fs.writeFileSync(metaFile, '{ not json');
      expect(quiet(() => main({}, { bundleFile, exeFile })).code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('answers 1 with the over-budget message for a huge bundle', () => {
    withBundle(Buffer.alloc(6 * 1024 * 1024, 7), ({ code, text }) => {
      expect(code).toBe(1);
      expect(text).toContain('check:sidecar failed: the sidecar grew past its budget.');
    });
  });
});

describe('the committed budget', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'checks', 'sidecar-budget.json'), 'utf8'));

  it('has positive whole-number limits for the bundle and its gzip in each mode and for the win32-arm64 exe', () => {
    for (const mode of ['studio', 'runtime']) {
      for (const value of [committed[mode].bundleKb, committed[mode].bundleGzipKb]) {
        expect(Number.isInteger(value), mode).toBe(true);
        expect(value, mode).toBeGreaterThan(0);
      }
    }
    expect(Number.isInteger(committed.exeKb['win32-arm64'])).toBe(true);
  });

  it('is roomier for the bundle than the exe, which is mostly the Node binary', () => {
    for (const mode of ['studio', 'runtime']) {
      expect(committed[mode].bundleGzipKb).toBeLessThan(committed[mode].bundleKb);
      expect(committed.exeKb['win32-arm64']).toBeGreaterThan(committed[mode].bundleKb);
    }
  });

  // Studio was raised on purpose (phase 3, the merge, then phase 8 to 3664 / 1106, phase 11 gzip to 1107, phase 15 to 3807 / 1153, docs/BUDGETS.md); the runtime limits are the kit limits and stay.
  it('keeps the runtime limits at the kit values and the studio limits at the decided ones', () => {
    expect(committed.runtime).toEqual({ bundleKb: 3497, bundleGzipKb: 1053 });
    expect(committed.studio.bundleKb).toBeLessThanOrEqual(3807);
    expect(committed.studio.bundleGzipKb).toBeLessThanOrEqual(1153);
    expect(committed.studio.bundleKb).toBeGreaterThan(committed.runtime.bundleKb);
  });
});

describe('the sidecar exe name follows the package name', () => {
  const quiet = (fn) => {
    const lines = [];
    const spies = [vi.spyOn(console, 'error').mockImplementation((m) => lines.push(String(m))), vi.spyOn(console, 'log').mockImplementation((m) => lines.push(String(m)))];
    try {
      return { code: fn(), text: lines.join('\n') };
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  };
  const pkgRoot = (name) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-name-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name }));
    return root;
  };

  it('derives <package name>-server, with .exe only on win32', async () => {
    const { sidecarBaseName, sidecarExeName } = await import('../../scripts/lib/sidecarName.js');
    const root = pkgRoot('session-ledger');
    try {
      expect(sidecarBaseName(root)).toBe('session-ledger-server');
      expect(sidecarExeName({ root, platform: 'win32' })).toBe('session-ledger-server.exe');
      expect(sidecarExeName({ root, platform: 'linux' })).toBe('session-ledger-server');
      expect(sidecarBaseName(ROOT)).toBe(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name + '-server');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds stray differently named sidecars and ignores the expected one', async () => {
    const { findStraySidecars } = await import('../../scripts/lib/sidecarName.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-stray-'));
    try {
      for (const f of ['session-ledger-server.exe', 'local-app-studio-server.exe', 'server.cjs']) fs.writeFileSync(path.join(dir, f), 'x');
      expect(findStraySidecars(dir, 'session-ledger-server.exe')).toEqual(['local-app-studio-server.exe']);
      expect(findStraySidecars(path.join(dir, 'missing'), 'a-server')).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when package.json has no name', async () => {
    const { sidecarBaseName } = await import('../../scripts/lib/sidecarName.js');
    const root = pkgRoot('');
    try {
      expect(() => sidecarBaseName(root)).toThrow(/no "name"/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('check:sidecar fails loudly when only a differently named exe exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-budget-'));
    try {
      const bundleFile = path.join(dir, 'server.cjs');
      fs.writeFileSync(bundleFile, 'x'.repeat(1024));
      fs.writeFileSync(path.join(dir, 'other-server.exe'), 'y');
      const { code, text } = quiet(() => main({}, { bundleFile, exeFile: path.join(dir, 'session-ledger-server.exe') }));
      expect(code).toBe(1);
      expect(text).toContain('expected session-ledger-server.exe');
      expect(text).toContain('other-server.exe');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
