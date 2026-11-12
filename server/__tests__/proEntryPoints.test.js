// Every `node <file>` launch in package.json scripts and .github/workflows whose static import graph reaches a pro seam
// (a stub with a twin, PRO_SEAMS) must go through scripts/lib/proHook.js (`--import`) or scripts/lib/proRun.js, or it runs
// the stubs in a pro checkout while the bundled and served builds use the twins. Entries that pick the seam in their own
// way are listed in SELF_RESOLVING with the reason.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRO_SEAMS, REPO_ROOT } from '../../scripts/lib/proDir.js';

/** Entry (repo-relative) to why it is allowed to run without the hook. */
const SELF_RESOLVING = Object.freeze({
  'scripts/desktop/buildSidecar.js': 'bundles through proSeamEsbuildPlugin; it reads only resolveBuildCloudAi and FeatureUnavailableError from server/buildFeatures.js, never PRO_PARTS',
  'scripts/desktop/buildDev.js': 'reads the overlay from the open studioOverlay.js and calls resolveBuildCloudAi, never PRO_PARTS; its npm and sidecar children resolve the build themselves',
});

const EXTS = ['', '.js', '.mjs', '.cjs', '/index.js'];
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/g;
const SEAMS = new Set(PRO_SEAMS);
const rel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

/** @param {string} from absolute importing file @param {string} spec relative specifier @returns {string | null} */
function resolveRelative(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const ext of EXTS) {
    const candidate = base + ext;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next extension
    }
  }
  return null;
}

/**
 * The seams a file's static (and literal dynamic) relative imports reach, never entering pro/.
 * @param {string} entry absolute path
 * @returns {string[]} sorted repo-relative seam paths
 */
export function reachedSeams(entry) {
  const seen = new Set();
  const found = new Set();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const r = rel(file);
    if (SEAMS.has(r)) found.add(r);
    if (r.startsWith('pro/') || !/\.(?:m?js|cjs)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(SPEC_RE)) {
      const target = resolveRelative(file, m[2]);
      if (target) stack.push(target);
    }
  }
  return [...found].sort();
}

/**
 * Every `node [flags] <file> ...` in a text: the file (repo-relative) and whether the hook flag is present.
 * @param {string} text
 * @returns {{ file: string, hooked: boolean }[]}
 */
export function nodeLaunches(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\w./-])node((?:[ \t]+\S+)+)/g)) {
    const tokens = m[1].trim().split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ''));
    let hooked = false;
    let i = 0;
    for (; i < tokens.length && tokens[i].startsWith('-'); i += 1) {
      if (/^--(?:eval|print)$|^-[pe]$/.test(tokens[i])) {
        i = tokens.length;
        break;
      }
      if (tokens[i] === '--import' && /(?:^|\/)proHook\.js$/.test(tokens[i + 1] ?? '')) hooked = true;
      if (tokens[i] === '--import') i += 1;
    }
    const file = tokens[i];
    if (file && /^[\w./-]+\.(?:m?js|cjs)$/.test(file)) out.push({ file: file.replace(/^\.\//, ''), hooked });
  }
  return out;
}

function sources() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const list = Object.entries(pkg.scripts).map(([name, cmd]) => ({ where: `package.json "${name}"`, text: String(cmd) }));
  const dir = path.join(REPO_ROOT, '.github', 'workflows');
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    list.push({ where: `.github/workflows/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf8') });
  }
  return list;
}

describe('the import walker', () => {
  it('finds a seam reached through a relative import chain and not one that is not reached', () => {
    expect(reachedSeams(path.join(REPO_ROOT, 'server', 'diagnostics', 'doctor.js'))).toContain('src/proParts.js');
    expect(reachedSeams(path.join(REPO_ROOT, 'scripts', 'lib', 'proDir.js'))).toEqual([]);
  });

  it('reads node launches with flags, quotes and the hook', () => {
    expect(nodeLaunches('node --import ./scripts/lib/proHook.js server.js')).toEqual([{ file: 'server.js', hooked: true }]);
    expect(nodeLaunches('  run: node scripts/a.js --x "$y"\n  run: node -p "1+1"')).toEqual([{ file: 'scripts/a.js', hooked: false }]);
    expect(nodeLaunches('echo node_arch=1; # node and Rust host')).toEqual([]);
  });
});

describe('every node launch that reaches a pro seam goes through the hook', () => {
  const launches = sources().flatMap(({ where, text }) => nodeLaunches(text).map((l) => ({ where, ...l })));

  it('found the launches it is meant to check', () => {
    expect(launches.length).toBeGreaterThan(30);
  });

  it.each(launches.map((l) => [`${l.where}: node ${l.file}`, l]))('%s', (_name, launch) => {
    const abs = path.join(REPO_ROOT, launch.file);
    expect(fs.existsSync(abs), `${launch.file} is not there`).toBe(true);
    if (launch.hooked || launch.file === 'scripts/lib/proRun.js' || SELF_RESOLVING[launch.file]) return;
    expect(reachedSeams(abs), `${launch.file} reaches a pro seam without proHook or proRun`).toEqual([]);
  });
});

describe('the backup worker thread', () => {
  // `new Worker(new URL('./backupWorker.js', ...))` under devServer.js (which registers the hook in code, so a worker does not
  // inherit it as an --import flag) is safe only while the worker's imports reach no seam. This keeps that true.
  it('reaches no pro seam, so it needs no hook', () => {
    expect(reachedSeams(path.join(REPO_ROOT, 'server', 'backup', 'worker', 'backupWorker.js'))).toEqual([]);
  });
});
