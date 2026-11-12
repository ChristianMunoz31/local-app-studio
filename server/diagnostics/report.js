// Diagnostics data and the report ZIP (phase 15, sections 8.3 and 8.4). The ZIP holds only text that went through
// redactText: a README, the summary, versions, the doctor output, the app list as counts (no spec, no description, no
// records) and the log files. It never holds a database, secrets.key, a spec, .env, the audit log, prompts or backups.
// The ZIP is written with fflate's zipSync, the same writer as the export archive.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { isSea } from 'node:sea';
import { strToU8, zipSync } from 'fflate';
import { getChannel } from '../channel.js';
import { debugState, logFiles, RING_SIZE, tail } from '../log.js';
import { lastRecovered } from '../processGuards.js';
import { redactText } from '../redact.js';
import { getAppVersion, isDesktopMode } from '../runtime.js';
import { listApps } from '../studio/apps.js';
import { formatDoctor } from './doctor.js';

export const LOG_BUDGET_BYTES = 8 * 1024 * 1024;
const LOG_LINE_MAX = 4000;
const TEXT_MAX = 2_000_000;

const redact = (text, max = TEXT_MAX) => redactText(text, { max });

const HELPER_SENTENCES = Object.freeze({
  ready: 'Ready',
  down: 'Not running',
  no_tools_model: 'No model that can use tools',
  remote: 'Set to another computer (not checked)',
  off: 'Turned off',
});

let shaCache = null;

/**
 * sha256 of the running executable (SEA mode only), streamed once and cached.
 * @returns {Promise<string | null>}
 */
export function bundleSha256() {
  if (!isSea()) return Promise.resolve(null);
  shaCache ??= new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(process.execPath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', () => resolve(null));
  });
  return shaCache;
}

/**
 * The `GET /api/studio/diagnostics` payload.
 * @param {{ dataDir: string, appPort?: number | null, previewPort?: number | null,
 *   helper: import('./doctor.js').OllamaState, sha256Of?: () => Promise<string | null>, sea?: boolean }} opts
 */
export async function collectInfo({ dataDir, appPort = null, previewPort = null, helper, sha256Of = bundleSha256, sea = isSea() }) {
  const recovered = lastRecovered();
  return {
    versions: { studio: getAppVersion(), node: process.versions.node, bundle: { sea, sha256: sea ? await sha256Of() : null } },
    mode: { app: 'studio', channel: getChannel(), desktop: isDesktopMode() },
    dataFolder: dataDir,
    ports: { app: appPort, preview: previewPort },
    helper: { state: helper.state, host: helper.host, models: helper.models, sentence: HELPER_SENTENCES[helper.state] ?? HELPER_SENTENCES.down },
    debug: debugState(),
    log: { files: logFiles().map(({ name, bytes }) => ({ name, bytes })), ring: tail({ limit: RING_SIZE }).length },
    recovered: recovered ? { at: recovered, code: 'server_error' } : null,
  };
}

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * The Copy summary text (section 8.4).
 * @param {{ info: Awaited<ReturnType<typeof collectInfo>>, doctor: import('./doctor.js').DoctorReport, lines?: object[] }} opts
 * @returns {string}
 */
export function summaryText({ info, doctor, lines = tail({ limit: 200 }) }) {
  const { versions, mode, helper } = info;
  const missing = doctor.lines.filter((l) => l.status === 'missing').map((l) => l.label.replace(/ \(.*\)$/, ''));
  const channel = mode.channel === 'dev' ? 'Dev build' : 'stable';
  const sha = versions.bundle.sha256 ? `server bundle sha256 ${versions.bundle.sha256.slice(0, 12)}` : 'running from source';
  const errors = lines.filter((l) => l.level === 'error' || l.level === 'fatal');
  const last = errors[errors.length - 1];
  const logLine = last
    ? `${errors.length} error${errors.length === 1 ? '' : 's'} in the last ${lines.length} lines (latest ${last.code ?? last.event}${hhmm(last.time) ? ` at ${hhmm(last.time)}` : ''})`
    : `no errors in the last ${lines.length} lines`;
  const text = [
    `Local App Studio ${versions.studio}, Studio, ${channel}, ${mode.desktop ? 'desktop' : 'browser'}`,
    `Node ${versions.node}, ${sha}`,
    `Data folder: ${redactText(info.dataFolder, { dataDir: '', max: 500 })}`,
    `The helper: ${helper.state === 'ready' ? `ready, ${helper.models.join(', ')}` : helper.sentence.toLowerCase()}`,
    `Checks: ${doctor.counts.found} found, ${doctor.counts.missing} missing${missing.length ? ` (${missing.join(', ')})` : ''}, ${doctor.counts.problem} problem${doctor.counts.problem === 1 ? '' : 's'}`,
    `Debug mode: ${info.debug.on ? 'on' : 'off'}`,
    `Log: ${logLine}`,
    '',
  ].join('\n');
  return redact(text);
}

/** @returns {Array<{ name: string, text: string }>} the log files, current first, then the rotated ones */
function readLogSources() {
  const out = [];
  for (const f of logFiles()) {
    try {
      out.push({ name: f.name, text: fs.readFileSync(f.path, 'utf8') });
    } catch {
      // rotated away while reading
    }
  }
  if (out.length === 0) {
    const ring = tail({ limit: RING_SIZE });
    if (ring.length > 0) out.push({ name: 'server.jsonl', text: ring.map((r) => JSON.stringify(r)).join('\n') });
  }
  return out;
}

/**
 * Redacts every line and keeps the newest lines that fit `budget` bytes (oldest dropped first).
 * @param {Array<{ name: string, text: string }>} sources newest file first
 * @param {number} budget
 * @returns {Array<{ name: string, text: string }>}
 */
export function limitLogs(sources, budget = LOG_BUDGET_BYTES) {
  let left = budget;
  const out = [];
  // One lookup of the home folder for every line (redactText would ask the OS each time) and the folder patterns are cached.
  const opts = { max: LOG_LINE_MAX, home: os.homedir() };
  for (const src of sources) {
    if (left <= 0) break;
    const lines = src.text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => redactText(l, opts));
    const kept = [];
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const size = Buffer.byteLength(lines[i]) + 1;
      if (size > left) break;
      kept.unshift(lines[i]);
      left -= size;
    }
    if (kept.length > 0) out.push({ name: src.name, text: `${kept.join('\n')}\n` });
  }
  return out;
}

/** @param {Date} now @returns {string} local-app-studio-report-YYYYMMDD-HHMM.zip */
export function reportFilename(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `local-app-studio-report-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
}

function redactDoctor(doctor) {
  return {
    checkedAt: doctor.checkedAt,
    lines: doctor.lines.map((l) => ({ id: l.id, label: redact(l.label, 200), status: l.status, detail: redact(l.detail, 600), action: redact(l.action, 600) })),
    counts: { ...doctor.counts },
  };
}

/** Counts only: never the spec, the description or any record. */
function appRows(apps) {
  return apps.map((a) => ({
    id: String(a.id),
    name: redact(a.name, 120),
    slug: redact(a.slug, 120),
    revision: a.revision,
    tables: a.tableCount,
    pages: a.pageCount,
    updatedAt: a.updatedAt,
    hasInstaller: a.hasInstaller === true,
    problems: a.issueCount,
  }));
}

/**
 * Builds the report ZIP. `info` and `doctor` are the route's payloads; `apps`, `logs` and `lines` default to the live ones.
 * @param {{ now?: Date, info: Awaited<ReturnType<typeof collectInfo>>, doctor: import('./doctor.js').DoctorReport,
 *   apps?: object[], logs?: Array<{ name: string, text: string }>, lines?: object[] }} opts
 * @returns {Uint8Array}
 */
export function buildReport({ now = new Date(), info, doctor, apps = listApps(), logs = readLogSources(), lines }) {
  const safeDoctor = redactDoctor(doctor);
  const files = {
    'README.txt': strToU8(
      redact(
        [
          'Local App Studio report',
          `Made ${now.toISOString()}.`,
          '',
          'This file helps someone work out what went wrong. Nothing is sent anywhere: you choose whether to share it.',
          'No app designs, records, keys or passwords are in this file.',
          '',
        ].join('\n'),
      ),
    ),
    'summary.txt': strToU8(summaryText({ info, doctor: safeDoctor, lines })),
    'versions.json': strToU8(redact(JSON.stringify({ versions: info.versions, mode: info.mode }, null, 2))),
    'doctor.txt': strToU8(redact(formatDoctor(safeDoctor))),
    'doctor.json': strToU8(JSON.stringify(safeDoctor, null, 2)),
    'apps.json': strToU8(JSON.stringify(appRows(apps), null, 2)),
  };
  for (const entry of limitLogs(logs)) files[`logs/${entry.name}`] = strToU8(entry.text);
  // Level 1: a log is already small after the line cap, and the zip is built on the request path.
  return zipSync(files, { level: 1 });
}
