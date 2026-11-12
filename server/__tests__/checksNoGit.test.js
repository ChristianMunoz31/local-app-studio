import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isGitCheckout, listStagedFiles, listTrackedFiles, walkFiles } from '../../scripts/checks/gitFiles.js';

let dir;
const write = (base, rel, text = 'x\n') => {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  write(dir, 'package.json', '{}\n');
  write(dir, 'src/App.jsx', 'export const A = () => null;\n');
  write(dir, 'src/deep/B.jsx', 'export const B = () => null;\n');
  write(dir, 'node_modules/pkg/index.js');
  write(dir, 'dist/index.html');
  write(dir, 'dist-kit/a.txt');
  write(dir, 'coverage/c.txt');
  write(dir, 'data/secret.db');
  write(dir, 'src-tauri/target/x.rlib');
  write(dir, 'src-tauri/src/main.rs');
  write(dir, '.env', 'SECRET=1\n');
  write(dir, '.env.local', 'SECRET=1\n');
  write(dir, '.env.example', 'A=\n');
  write(dir, '.personal-denylist', 'term\n');
  write(dir, 'vite.config.js.local');
  write(dir, 'exports/transactions.csv', 'a,b\n');
  write(dir, 'exports/report.tsv');
  write(dir, 'exports/sheet.xlsx');
  write(dir, 'debug.log');
  write(dir, 'server/run.log');
  write(dir, 'logs/app.txt');
  write(dir, 'server/logs/app.txt');
  write(dir, '.idea/workspace.xml');
  write(dir, '.vscode/settings.json');
  write(dir, '.vscode/extensions.json', '{}\n');
  write(dir, 'local.db');
  write(dir, 'local.db-wal');
  write(dir, 'local.db-shm');
  write(dir, 'notes.bak');
  write(dir, 'secrets.key');
  write(dir, 'src-tauri/tauri.dev.build.json');
  write(dir, 'nul');
  write(dir, 'app.suo');
  write(dir, 'app.sln');
  write(dir, 'THIRD_PARTY_NOTICES.md', 'Author <author@example.com>\n');
  write(dir, 'docs/THIRD_PARTY_NOTICES.md', 'kept\n');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('checks without a git checkout', () => {
  it('the temp dir is not a git checkout', () => {
    expect(isGitCheckout(dir)).toBe(false);
  });

  it('walk lists the right files with forward-slash relative paths', () => {
    const expected = ['.env.example', '.vscode/extensions.json', 'docs/THIRD_PARTY_NOTICES.md', 'package.json', 'src-tauri/src/main.rs', 'src/App.jsx', 'src/deep/B.jsx'];
    expect(walkFiles(dir)).toEqual(expected);
    expect(listTrackedFiles(dir)).toEqual(expected);
  });

  it('skips CSV and log files, the logs folder and the other data files the .gitignore keeps out', () => {
    const files = walkFiles(dir);
    for (const skipped of ['exports/transactions.csv', 'exports/report.tsv', 'exports/sheet.xlsx', 'debug.log', 'server/run.log', 'logs/app.txt', 'server/logs/app.txt',
      '.idea/workspace.xml', '.vscode/settings.json', 'local.db', 'local.db-wal', 'local.db-shm', 'notes.bak', 'secrets.key', 'src-tauri/tauri.dev.build.json', 'nul', 'app.suo', 'app.sln']) {
      expect(files, skipped).not.toContain(skipped);
    }
    expect(files).toContain('.vscode/extensions.json');
  });

  it('skips the generated THIRD_PARTY_NOTICES.md at the root only', () => {
    const files = walkFiles(dir);
    expect(files).not.toContain('THIRD_PARTY_NOTICES.md');
    expect(files).toContain('docs/THIRD_PARTY_NOTICES.md');
  });
});

describe('check entry points in a git-free copy', () => {
  const run = (root, args) =>
    spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(root) },
    });

  const makeCopy = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-run-'));
    fs.cpSync(path.resolve('scripts/checks'), path.join(root, 'scripts', 'checks'), { recursive: true });
    write(root, 'package.json', '{"type":"module"}\n');
    write(root, 'src/App.jsx', 'export const A = () => <p>hi</p>\n');
    write(root, 'node_modules/p/i.js');
    return root;
  };

  it.each(['noEmDash.js', 'personalData.js', 'noPrivateKeys.js'])('%s runs and scans files', (name) => {
    const root = makeCopy();
    try {
      const res = run(root, [path.join(root, 'scripts', 'checks', name)]);
      expect(res.stderr).toContain('scanned the folder');
      expect(res.stderr).not.toMatch(/\bat .*\(/);
      expect(res.status).toBe(0);
      expect(Number(/\((\d+) files/.exec(res.stdout)?.[1])).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('--staged without git exits 1 with a one-line message', () => {
    const root = makeCopy();
    try {
      const res = run(root, [path.join(root, 'scripts', 'checks', 'noEmDash.js'), '--staged']);
      expect(res.status).toBe(1);
      expect(res.stderr.trim().split(/\r?\n/)).toHaveLength(1);
      expect(res.stderr).toContain('--staged needs a git checkout');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('checks in a git checkout skip the generated THIRD_PARTY_NOTICES.md', () => {
  // Built with fromCharCode so this file itself holds no em dash.
  const NOTICE = `Author <person@${'gmail'}.com>\nlicense text ${String.fromCharCode(0x2014)} verbatim\n`;
  const gitIn = (root, ...args) =>
    spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });

  const makeRepo = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-run-'));
    fs.cpSync(path.resolve('scripts/checks'), path.join(root, 'scripts', 'checks'), { recursive: true });
    write(root, 'package.json', '{"type":"module"}\n');
    write(root, 'THIRD_PARTY_NOTICES.md', NOTICE);
    write(root, 'docs/THIRD_PARTY_NOTICES.md', NOTICE);
    write(root, 'other.md', NOTICE.replace(String.fromCharCode(0x2014), '-'));
    gitIn(root, 'init', '-q');
    gitIn(root, 'add', '-A');
    return root;
  };

  const runCheck = (root, name, ...args) =>
    spawnSync(process.execPath, [path.join(root, 'scripts', 'checks', name), ...args], { cwd: root, encoding: 'utf8' });

  it('drops the root notices file from tracked and staged lists but keeps the same name in a subfolder', () => {
    const root = makeRepo();
    try {
      expect(isGitCheckout(root)).toBe(true);
      for (const list of [listStagedFiles(root), listTrackedFiles(root)]) {
        expect(list).not.toContain('THIRD_PARTY_NOTICES.md');
        expect(list).toContain('docs/THIRD_PARTY_NOTICES.md');
        expect(list).toContain('other.md');
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('personalData.js flags other files but not the root notices file (tracked and --staged)', () => {
    const root = makeRepo();
    try {
      for (const args of [[], ['--staged']]) {
        const res = runCheck(root, 'personalData.js', ...args);
        const out = res.stdout + res.stderr;
        expect(res.status, out).toBe(1);
        expect(out).toContain('other.md');
        expect(out).toContain('docs/THIRD_PARTY_NOTICES.md');
        expect(out.replace('docs/THIRD_PARTY_NOTICES.md', '')).not.toMatch(/(^|[^/])THIRD_PARTY_NOTICES\.md/m);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('noEmDash.js and noPrivateKeys.js pass with the notices (em dash in the license text) tracked', () => {
    const root = makeRepo();
    try {
      for (const name of ['noEmDash.js', 'noPrivateKeys.js']) {
        for (const args of [[], ['--staged']]) {
          const res = runCheck(root, name, ...args);
          expect(res.status, res.stdout + res.stderr).toBe(0);
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
