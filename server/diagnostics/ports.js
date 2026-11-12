// Who holds a TCP port (phase 15, section 4). Read only: it lists listeners and reads a command line, it never ends a process.
// Windows: `netstat -ano -p TCP`, then a CIM query for the command line. Elsewhere: `lsof` and `ps`.
// Every child process goes through execFile with an argument array, no shell and a 5 second timeout.
import { execFile } from 'node:child_process';
import { redactText } from '../redact.js';

const EXEC_TIMEOUT_MS = 5000;
const COMMAND_MAX = 300;
const LOCAL_HOSTS = new Set(['127.0.0.1', '0.0.0.0', '[::1]', '[::]']);

/**
 * @typedef {object} PortsFacade
 * @property {string} platform
 * @property {number} pid this process id
 * @property {(cmd: string, args: string[]) => Promise<{ code: number | null, stdout: string }>} exec
 */

/**
 * @typedef {object} PortHolder
 * @property {number} port
 * @property {boolean} checked false when the listing command could not run (the answer is unknown)
 * @property {boolean} free
 * @property {number | null} pid
 * @property {string} command redacted and cut to 300 characters, empty when unknown
 * @property {boolean} self true when the holder is this process
 */

/** @returns {PortsFacade} the real process facade */
export function defaultPortsFacade() {
  return {
    platform: process.platform,
    pid: process.pid,
    exec: (cmd, args) =>
      new Promise((resolve) => {
        try {
          execFile(cmd, args, { shell: false, windowsHide: true, timeout: EXEC_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout) => {
            const code = err === null ? 0 : typeof err.code === 'number' ? err.code : null;
            resolve({ code, stdout: typeof stdout === 'string' ? stdout : '' });
          });
        } catch {
          resolve({ code: null, stdout: '' });
        }
      }),
  };
}

/**
 * The PID that listens on `port` in `netstat -ano -p TCP` output (loopback and wildcard addresses only), or null.
 * @param {string} text
 * @param {number} port
 * @returns {number | null}
 */
export function parseNetstat(text, port) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (m && Number(m[2]) === port && LOCAL_HOSTS.has(m[1])) return Number(m[3]);
  }
  return null;
}

/**
 * The PID in `lsof -Fp` output (lines such as `p1234`), or null.
 * @param {string} text
 * @returns {number | null}
 */
export function parseLsof(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^p(\d+)$/.exec(line.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

const clean = (text) => redactText(String(text).replace(/\s+/g, ' ').trim(), { max: COMMAND_MAX });

async function commandLine(pid, f) {
  if (f.platform === 'win32') {
    const r = await f.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`]);
    return r.code === 0 ? clean(r.stdout) : '';
  }
  const r = await f.exec('ps', ['-o', 'command=', '-p', String(pid)]);
  return r.code === 0 ? clean(r.stdout) : '';
}

/**
 * Who listens on a port. Never throws.
 * @param {number} port
 * @param {PortsFacade} [facade]
 * @returns {Promise<PortHolder>}
 */
export async function portHolder(port, facade = defaultPortsFacade()) {
  const f = facade;
  try {
    let pid = null;
    if (f.platform === 'win32') {
      const r = await f.exec('netstat.exe', ['-ano', '-p', 'TCP']);
      if (r.code !== 0) return { port, checked: false, free: false, pid: null, command: '', self: false };
      pid = parseNetstat(r.stdout, port);
    } else {
      const r = await f.exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
      // lsof exits 1 with no output when nothing listens; any other failure with no output is unknown
      if (r.code !== 0 && !(r.code === 1 && r.stdout.trim() === '')) return { port, checked: false, free: false, pid: null, command: '', self: false };
      pid = parseLsof(r.stdout);
    }
    if (pid === null) return { port, checked: true, free: true, pid: null, command: '', self: false };
    const self = pid === f.pid;
    return { port, checked: true, free: false, pid, command: await commandLine(pid, f), self };
  } catch {
    return { port, checked: false, free: false, pid: null, command: '', self: false };
  }
}
