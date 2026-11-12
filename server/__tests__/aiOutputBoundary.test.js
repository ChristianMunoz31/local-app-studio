// P5 (A-G6): a grep-level pin that model output flows only into the spec validator and into words shown to the person.
// The files that handle a model's reply (the helper pipeline and route, the waiting store, the Assistant loop and its
// tools) import no file, process, socket or http module, make no fetch, start no process, and call no settings or
// netPolicy writer. A model string therefore cannot become a path, a command, a URL or a setting in these files.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const jsIn = (dir) => {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => `${dir}/${e.name}`);
};

const OPEN_FILES = [
  'server/studio/describeRoute.js',
  'server/studio/waiting.js',
  ...jsIn('server/agents'),
  'packages/runtime/server/assistantTools.js',
  'packages/runtime/server/toolNames.js',
];
// pro/ files exist only in a pro tree; a public build skips them with the reason below.
const PRO_FILES = jsIn('pro/server/studio/describe');

const FORBIDDEN_MODULES = ['fs', 'fs/promises', 'child_process', 'net', 'http', 'https', 'node-fetch'];
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** Every import or require specifier, `node:` prefix removed. */
function specifiers(src) {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  return [...src.matchAll(re)].map((m) => m[2].replace(/^node:/, ''));
}

// One-line reasons: an allowlisted file and the exact import it may keep. Empty today; read every entry before adding one.
const ALLOWED_IMPORTS = new Map([]);

/** Violations in one source text, as readable strings. */
function violations(file, source) {
  const src = stripComments(source);
  const out = [];
  for (const spec of specifiers(src)) {
    if (FORBIDDEN_MODULES.includes(spec) && !ALLOWED_IMPORTS.get(file)?.includes(spec)) out.push(`imports ${spec}`);
  }
  const calls = [
    [/(?<![.\w])fetch\s*\(/, 'calls fetch('],
    [/(?<![.\w])(?:spawn|spawnSync|execFile|execFileSync|execSync|exec|fork)\s*\(/, 'starts a process'],
    [/\b(?:updateAiSettings|setNetworkFeature|setState|sendBeacon)\s*\(/, 'calls a settings or netPolicy writer'],
    [/\b(?:XMLHttpRequest|WebSocket)\b/, 'uses a network object'],
  ];
  for (const [re, what] of calls) if (re.test(src)) out.push(what);
  return out.map((v) => `${file} ${v}`);
}

const scan = (files) => files.flatMap((f) => violations(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));

describe('model output only flows into the validator and into words (P5)', () => {
  it('the detector flags each forbidden shape (the pin is not vacuous)', () => {
    expect(violations('x.js', "import fs from 'node:fs';")).toEqual(['x.js imports fs']);
    expect(violations('x.js', "const cp = require('child_process');")).toEqual(['x.js imports child_process']);
    expect(violations('x.js', "import { request } from 'node:https';")).toEqual(['x.js imports https']);
    expect(violations('x.js', 'await fetch(url);')).toEqual(['x.js calls fetch(']);
    expect(violations('x.js', 'spawn("a");')).toEqual(['x.js starts a process']);
    expect(violations('x.js', 'await updateAiSettings({});')).toEqual(['x.js calls a settings or netPolicy writer']);
    expect(violations('x.js', 'await setNetworkFeature("cloudAi", true);')).toEqual(['x.js calls a settings or netPolicy writer']);
    expect(violations('x.js', '/^a/.exec(s); // fetch(x) in a comment')).toEqual([]);
  });

  it('scans a real file set', () => {
    for (const f of ['server/studio/describeRoute.js', 'server/studio/waiting.js', 'server/agents/assistantAgent.js', 'server/agents/toolCalls.js', 'packages/runtime/server/assistantTools.js', 'packages/runtime/server/toolNames.js']) {
      expect(OPEN_FILES, f).toContain(f);
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
    }
    expect(OPEN_FILES.length).toBeGreaterThanOrEqual(10);
  });

  it('the open files (route, waiting store, agents, runtime assistant tools) are clean', () => {
    expect(scan(OPEN_FILES)).toEqual([]);
  });

  it('the helper pipeline files are clean', (ctx) => {
    ctx.skip(PUBLIC_BUILD || PRO_FILES.length === 0, 'needs pro/server/studio/describe, which is not in a public build');
    expect(PRO_FILES.map((f) => toRel(path.join(ROOT, f)))).toEqual(expect.arrayContaining(['pro/server/studio/describe/pipeline.js', 'pro/server/studio/describe/prompts.js']));
    expect(scan(PRO_FILES)).toEqual([]);
  });

  it('every allowlist entry names a scanned file', () => {
    for (const file of ALLOWED_IMPORTS.keys()) expect([...OPEN_FILES, ...PRO_FILES]).toContain(file);
  });
});
