// Port holder lookups: netstat and lsof fixtures, self detection, redaction, and the rule that nothing here ends a process.
import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseLsof, parseNetstat, portHolder } from '../../diagnostics/ports.js';

const NETSTAT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1040',
  '  TCP    127.0.0.1:4321         0.0.0.0:0              LISTENING       5678',
  '  TCP    127.0.0.1:43210        0.0.0.0:0              LISTENING       9999',
  '  TCP    [::1]:5174             [::]:0                 LISTENING       4242',
  '  TCP    192.168.1.5:7000       0.0.0.0:0              LISTENING       7777',
  '  TCP    127.0.0.1:4321         127.0.0.1:50000        ESTABLISHED     5678',
].join('\r\n');

const fake = ({ platform = 'win32', pid = 1, netstat = NETSTAT, cmd = '', lsof = { code: 0, stdout: '' } } = {}) => {
  const calls = [];
  return {
    calls,
    platform,
    pid,
    exec: async (c, args) => {
      calls.push([c, ...args]);
      if (c === 'netstat.exe') return { code: 0, stdout: netstat };
      if (c === 'powershell.exe') return { code: 0, stdout: cmd };
      if (c === 'lsof') return lsof;
      if (c === 'ps') return { code: 0, stdout: cmd };
      return { code: null, stdout: '' };
    },
  };
};

describe('parsers', () => {
  it('reads only LISTENING lines on a loopback or wildcard address for the exact port', () => {
    expect(parseNetstat(NETSTAT, 4321)).toBe(5678);
    expect(parseNetstat(NETSTAT, 5174)).toBe(4242);
    expect(parseNetstat(NETSTAT, 7000)).toBeNull();
    expect(parseNetstat(NETSTAT, 432)).toBeNull();
    expect(parseNetstat('', 4321)).toBeNull();
  });

  it('reads the pid from lsof -Fp output', () => {
    expect(parseLsof('p1234\nf5\n')).toBe(1234);
    expect(parseLsof('')).toBeNull();
  });
});

describe('portHolder', () => {
  it('reports a free port', async () => {
    expect(await portHolder(4999, fake())).toEqual({ port: 4999, checked: true, free: true, pid: null, command: '', self: false });
  });

  it('reports pid and a redacted, shortened command line on Windows', async () => {
    const home = os.homedir();
    const f = fake({ cmd: `"C:\\Program Files\\nodejs\\node.exe" ${home}\\other\\server.js sk-test1234567890abcdef ${'x'.repeat(400)}\r\n` });
    const h = await portHolder(4321, f);
    expect(h).toMatchObject({ port: 4321, checked: true, free: false, pid: 5678, self: false });
    expect(h.command).not.toContain(home);
    expect(h.command).not.toContain('sk-test1234567890abcdef');
    expect(h.command).toContain('<home>');
    expect(h.command.length).toBeLessThanOrEqual(303);
    const ps = f.calls.find((c) => c[0] === 'powershell.exe');
    expect(ps.slice(1, 3)).toEqual(['-NoProfile', '-NonInteractive']);
    expect(ps[4]).toContain('ProcessId=5678');
  });

  it('marks this process as self', async () => {
    expect((await portHolder(4321, fake({ pid: 5678, cmd: 'node server.js' }))).self).toBe(true);
  });

  it('uses lsof and ps elsewhere', async () => {
    const f = fake({ platform: 'linux', lsof: { code: 0, stdout: 'p321\n' }, cmd: 'node /srv/server.js\n' });
    const h = await portHolder(4321, f);
    expect(h).toMatchObject({ free: false, pid: 321, command: 'node /srv/server.js' });
    expect(f.calls[0]).toEqual(['lsof', '-nP', '-iTCP:4321', '-sTCP:LISTEN', '-Fp']);
    expect(f.calls[1]).toEqual(['ps', '-o', 'command=', '-p', '321']);
  });

  it('treats lsof exit 1 with no output as free and any other failure as unknown', async () => {
    expect((await portHolder(4321, fake({ platform: 'linux', lsof: { code: 1, stdout: '' } }))).free).toBe(true);
    const unknown = await portHolder(4321, fake({ platform: 'linux', lsof: { code: null, stdout: '' } }));
    expect(unknown).toMatchObject({ checked: false, free: false });
  });

  it('says unknown when netstat cannot run', async () => {
    const f = { platform: 'win32', pid: 1, exec: async () => ({ code: null, stdout: '' }) };
    expect(await portHolder(4321, f)).toMatchObject({ checked: false, free: false, pid: null });
  });

  it('never contains anything that ends a process', () => {
    const src = fs.readFileSync(new URL('../../diagnostics/ports.js', import.meta.url), 'utf8');
    for (const word of ['kill', 'taskkill', 'Stop-Process', 'process.kill']) expect(src).not.toContain(word);
  });
});
