// scripts/phase/lib/cwdScan.ps1 (Windows only): finds a process by its current directory with -Root and never stops anything.
// The test spawns its own sleeping child and ends only that child.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CWD_SCAN_SCRIPT, gitExe, parseScanOutput, powershellExe, readPortHolders, readProcess, runFile, scanArgv } from '../../scripts/phase/lib/processTable.js';
import { removeDir } from '../../scripts/phase/lib/removeDir.js';

const win = process.platform === 'win32';

describe('scanArgv and parseScanOutput', () => {
  it('passes the script with -File and each parameter as its own entry', () => {
    expect(scanArgv('S.ps1', { root: 'C:\\a b\\[x]', processId: 12 })).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'S.ps1',
      '-Root',
      'C:\\a b\\[x]',
      '-ProcessId',
      '12',
    ]);
    expect(scanArgv('S.ps1')).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'S.ps1']);
  });
  it('parses rows and tolerates a BOM and an empty answer', () => {
    expect(parseScanOutput('\uFEFF[{"pid":5,"ppid":1,"name":"a.exe","cwd":null,"cmd":"x","created":null}]')).toEqual([
      { pid: 5, ppid: 1, name: 'a.exe', cwd: null, cmd: 'x', created: null },
    ]);
    expect(parseScanOutput('')).toEqual([]);
    expect(() => parseScanOutput('{"pid":1}')).toThrow();
  });
});

describe.skipIf(!win)('cwdScan.ps1', () => {
  const dirs = [];
  let child = null;
  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  it('finds a child by its cwd with -Root (brackets mean nothing) and re-reads it by pid', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwdscan [x]-'));
    dirs.push(dir);
    child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 60'], { cwd: dir, shell: false, stdio: 'ignore', windowsHide: true });
    await new Promise((r) => setTimeout(r, 1500));
    const r = await runFile('powershell.exe', scanArgv(CWD_SCAN_SCRIPT, { root: dir }));
    expect(r.code).toBe(0);
    const mine = parseScanOutput(r.stdout).find((p) => p.pid === child.pid);
    expect(mine).toBeTruthy();
    expect(mine.cwd.toLowerCase().replace(/\\+$/, '')).toBe(dir.toLowerCase());
    expect(mine.name.toLowerCase()).toBe('powershell.exe');
    expect(typeof mine.ppid).toBe('number');
    expect(mine.created).toMatch(/^\d{4}-\d\d-\d\dT/);
    const one = await readProcess(child.pid);
    expect(one).toHaveLength(1);
    expect(one[0].cmd).toBe(mine.cmd);
    const none = await runFile('powershell.exe', scanArgv(CWD_SCAN_SCRIPT, { root: `${dir}-no-such-folder-zz` }));
    expect(parseScanOutput(none.stdout).some((p) => p.pid === child.pid)).toBe(false);
    child.kill();
  }, 60000);
});

describe('port holders over IPv4 and IPv6', () => {
  const v4 = 'Active Connections\r\n  TCP    127.0.0.1:4481   0.0.0.0:0   LISTENING   111\r\n';
  const v6 = '  TCP    [::1]:5174   [::]:0   LISTENING   222\r\n  TCP    [::]:4482   [::]:0   LISTENING   333\r\n';
  const facade = (results) => ({ exec: async (_cmd, args) => results[args[2]] });
  it('reads both families and accepts [::1] and [::]', async () => {
    const r = await readPortHolders([4481, 4482, 5174], facade({ TCP: { code: 0, stdout: v4 }, TCPv6: { code: 0, stdout: v6 } }));
    expect(r).toEqual({ known: true, holders: [{ port: 4481, pid: 111 }, { port: 4482, pid: 333 }, { port: 5174, pid: 222 }] });
  });
  it('is unknown when either read fails', async () => {
    expect((await readPortHolders([5174], facade({ TCP: { code: 0, stdout: v4 }, TCPv6: { code: 1, stdout: '' } }))).known).toBe(false);
  });
});

describe('absolute tool paths', () => {
  it('calls PowerShell by its System32 path and resolves git from an absolute PATH entry only', () => {
    expect(path.isAbsolute(powershellExe())).toBe(true);
    expect(powershellExe().toLowerCase()).toMatch(/system32.windowspowershell.v1\.0.powershell\.exe$/);
    const tools = path.resolve('/Tools');
    const seen = [];
    const exists = (p) => {
      seen.push(p);
      return p === path.join(tools, 'git.exe');
    };
    expect(gitExe({ PATH: ['.', 'bin', tools].join(path.delimiter) }, exists)).toBe(path.join(tools, 'git.exe'));
    expect(seen).toEqual([path.join(tools, 'git.exe')]);
  });

  it('skips PATH entries inside the repo root and returns null when nothing absolute is found', () => {
    const root = path.resolve('/Repo');
    const bin = path.join(root, 'node_modules', '.bin');
    const exists = (p) => p.startsWith(root) || p === path.join(path.resolve('/Elsewhere'), 'git.exe');
    expect(gitExe({ PATH: [bin, root].join(path.delimiter), ProgramFiles: root }, exists, root)).toBeNull();
    expect(gitExe({ PATH: [bin, path.resolve('/Elsewhere')].join(path.delimiter) }, exists, root)).toBe(path.join(path.resolve('/Elsewhere'), 'git.exe'));
    expect(gitExe({ PATH: '' }, () => false, root)).toBeNull();
  });
});

describe('removeDir', () => {
  const busy = (code) => Object.assign(new Error(code), { code });
  it('retries EPERM until the holder lets go', async () => {
    let calls = 0;
    const rm = () => {
      calls += 1;
      if (calls < 3) throw busy('EPERM');
    };
    await removeDir('x', { rm, sleep: async () => {}, now: () => 0 });
    expect(calls).toBe(3);
  });
  it('gives up at the deadline and does not retry another code', async () => {
    let t = 0;
    const sleep = async () => {
      t += 200;
    };
    const rm = () => {
      throw busy('EBUSY');
    };
    await expect(removeDir('x', { rm, sleep, now: () => t, deadlineMs: 1000 })).rejects.toMatchObject({ code: 'EBUSY' });
    let n = 0;
    const denied = () => {
      n += 1;
      throw busy('EACCES');
    };
    await expect(removeDir('x', { rm: denied, sleep, now: () => 0 })).rejects.toMatchObject({ code: 'EACCES' });
    expect(n).toBe(1);
  });
});
