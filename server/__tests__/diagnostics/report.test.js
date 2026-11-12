// The report ZIP: the exact entry list, and proof that no secret, no spec and no absolute user path end up in it.
import os from 'node:os';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildReport, collectInfo, limitLogs, reportFilename, summaryText } from '../../diagnostics/report.js';
import { createApp, listApps, saveSpec } from '../../studio/apps.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

const KEY = 'sk-test1234567890abcdef';
const HOME = os.homedir();
const DESCRIPTION = 'A very private crew roster description';
const TABLE_ID = 'secret_crew_table_zq';

let db;
beforeAll(() => {
  db = createTestDb();
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

const doctor = () => ({
  checkedAt: '2026-11-04T10:12:00.000Z',
  lines: [
    { id: 'node', label: 'Node.js', status: 'found', detail: `24.15.0, ${HOME}\\node.exe`, action: '' },
    { id: 'rustc', label: 'Rust', status: 'missing', detail: '', action: 'Install Rust with rustup.' },
    { id: 'cargo', label: 'Cargo (comes with Rust)', status: 'missing', detail: '', action: 'Install Rust with rustup.' },
    { id: 'data-folder', label: 'Data folder', status: 'found', detail: `${HOME}\\AppData\\Roaming\\Local App Studio`, action: '' },
  ],
  counts: { found: 2, missing: 2, problem: 0 },
});

const info = () =>
  collectInfo({
    dataDir: `${HOME}\\AppData\\Roaming\\Local App Studio`,
    appPort: 4321,
    previewPort: null,
    helper: { state: 'ready', host: 'http://127.0.0.1:11434', models: ['llama3.2:3b'] },
    sea: false,
  });

const logLine = (extra) => JSON.stringify({ level: 'error', time: '2026-11-04T10:02:00.000Z', requestId: 'abc12345', event: 'http.request', code: 'preview_failed', ...extra });

function seedApp() {
  const rec = createApp({ name: 'Crew Roster' });
  const spec = {
    ...rec.spec,
    app: { ...rec.spec.app, description: `${DESCRIPTION} ${KEY}` },
    tables: [{ id: TABLE_ID, label: 'Crew', fields: [{ id: 'name', label: 'Name', type: 'text', required: false }] }],
  };
  saveSpec(rec.id, spec, rec.revision);
  return rec;
}

describe('buildReport', () => {
  it('holds exactly the documented entries and nothing sensitive', async () => {
    const rec = seedApp();
    const logs = [
      { name: 'server.jsonl', text: `${logLine({ message: `failed at ${HOME}\\work\\file.js with ${KEY}` })}\n${logLine({ route: 'GET /x' })}\n` },
      { name: 'server.1.jsonl', text: `${logLine({ note: `old ${HOME}/x` })}\n` },
    ];
    // an app name cannot hold a path today, so a row with one proves the report redacts names anyway
    const odd = { id: 'odd-1', name: `Crew at ${HOME}`, slug: 'odd', revision: 1, tableCount: 0, pageCount: 0, updatedAt: 'x', hasInstaller: true, issueCount: 2 };
    const zip = buildReport({ now: new Date(2026, 10, 4, 10, 12), info: await info(), doctor: doctor(), logs, apps: [...listApps(), odd] });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(
      ['README.txt', 'apps.json', 'doctor.json', 'doctor.txt', 'logs/server.1.jsonl', 'logs/server.jsonl', 'summary.txt', 'versions.json'].sort(),
    );
    const everything = Object.values(files).map((b) => strFromU8(b)).join('\n');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(TABLE_ID);
    expect(everything).not.toContain(DESCRIPTION);
    expect(everything).not.toContain(HOME);
    expect(everything).not.toContain(HOME.replace(/\\/g, '/'));
    expect(everything).not.toContain(HOME.replace(/\\/g, '\\\\'));
    expect(strFromU8(files['README.txt'])).toContain('No app designs, records, keys or passwords are in this file.');
    const apps = JSON.parse(strFromU8(files['apps.json']));
    expect(apps).toEqual([
      { id: rec.id, name: 'Crew Roster', slug: 'crew-roster', revision: 2, tables: 1, pages: 1, updatedAt: expect.any(String), hasInstaller: false, problems: 0 },
      { id: 'odd-1', name: 'Crew at <home>', slug: 'odd', revision: 1, tables: 0, pages: 0, updatedAt: 'x', hasInstaller: true, problems: 2 },
    ]);
    expect(Object.keys(apps[0]).sort()).toEqual(['hasInstaller', 'id', 'name', 'pages', 'problems', 'revision', 'slug', 'tables', 'updatedAt']);
  });

  it('writes the doctor output in both layouts and the versions', async () => {
    const files = unzipSync(buildReport({ now: new Date(), info: await info(), doctor: doctor(), apps: [], logs: [] }));
    expect(strFromU8(files['doctor.txt'])).toContain('Missing  Rust');
    expect(JSON.parse(strFromU8(files['doctor.json'])).counts).toEqual({ found: 2, missing: 2, problem: 0 });
    const versions = JSON.parse(strFromU8(files['versions.json']));
    expect(Object.keys(versions).sort()).toEqual(['mode', 'versions']);
    expect(versions.mode.app).toBe('studio');
    expect(JSON.parse(strFromU8(files['apps.json']))).toEqual([]);
  });

  it('names the file by local date and time', () => {
    expect(reportFilename(new Date(2026, 10, 4, 9, 5))).toBe('local-app-studio-report-20261104-0905.zip');
  });
});

describe('limitLogs', () => {
  it('redacts every line and drops the oldest lines first when over budget', () => {
    const lines = Array.from({ length: 10 }, (_, i) => JSON.stringify({ n: i, pad: 'x'.repeat(20), key: KEY }));
    const out = limitLogs([{ name: 'server.jsonl', text: lines.join('\n') }, { name: 'server.1.jsonl', text: lines.join('\n') }], 150);
    expect(out).toHaveLength(1);
    const kept = out[0].text.trim().split('\n');
    expect(kept.length).toBeLessThan(10);
    expect(kept[kept.length - 1]).toContain('"n":9');
    expect(kept[0]).not.toContain('"n":0');
    expect(out[0].text).not.toContain(KEY);
    expect(Buffer.byteLength(out[0].text)).toBeLessThanOrEqual(150);
  });
});

describe('summaryText', () => {
  it('matches the documented layout', async () => {
    const lines = [{ level: 'error', time: '2026-11-04T10:02:00.000Z', event: 'http.request', code: 'preview_failed' }, { level: 'info', time: '2026-11-04T10:03:00.000Z', event: 'x' }];
    const text = summaryText({ info: await info(), doctor: doctor(), lines });
    const rows = text.trimEnd().split('\n');
    expect(rows[0]).toMatch(/^Local App Studio \S+, Studio, (stable|Dev build), (desktop|browser)$/);
    expect(rows[1]).toMatch(/^Node \d+\.\d+\.\d+, running from source$/);
    expect(rows[2]).toBe('Data folder: <home>\\AppData\\Roaming\\Local App Studio');
    expect(rows[3]).toBe('The helper: ready, llama3.2:3b');
    expect(rows[4]).toBe('Checks: 2 found, 2 missing (Rust, Cargo), 0 problems');
    expect(rows[5]).toBe('Debug mode: off');
    expect(rows[6]).toMatch(/^Log: 1 error in the last 2 lines \(latest preview_failed at \d\d:\d\d\)$/);
    expect(text).not.toContain(HOME);
  });
});
