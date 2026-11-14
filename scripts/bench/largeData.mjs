/* global window, document, addEventListener, removeEventListener, requestAnimationFrame, MutationObserver */
// Large-data bench (phase 31, WP-1): is a built app slow on 10 000 rows, and is the Design canvas slow on a page of 60+ parts?
// Measure only; it changes no product code. Synthetic data, temp folders only, real Chromium (Playwright), a production build.
//
//   1. Build the UI to a folder of your own (never the repo's dist/, other jobs read its sizes):
//        npx vite build --outDir <dir> --emptyOutDir
//   2. node scripts/bench/largeData.mjs --dist <dir> [--rows 10000] [--runs 5] [--port 4650] [--port-max 4680] [--only lists|design|scroll] [--headed]
//                                       [--channel chrome|msedge] [--json]
//        --dist      built UI folder (default: <os temp>/p31-bench-dist); APP_DIST_DIR points the servers at it
//        --port      first loopback port tried (default 4650); two servers are started on free ports from there up to --port-max
//        --port-max  last loopback port tried (default 4680 without --port; with --port, --port + 30). A phase that owns another block of
//                    ports passes both, for example --port 4881 --port-max 4980. assertSafePort still refuses the live dev ports.
//        --only      run just the built-app list part (lists), just the Design part (design), or just the RecordList wheel scroll (scroll:
//                    the Preview of the list app with 200 rows, no list API timing, no DataTable Next, no diagnostics, no floor page)
//        --headed    show the browser window (chromium.launch headless:false) for a real GPU measurement; default is headless
//        --channel   use an installed browser through Playwright's channel (chrome or msedge) instead of the bundled Chromium, so a run
//                    can use that browser and the real GPU; default is the bundled Chromium
//        --json      also print every sample as one JSON line at the end
//      The first lines say which browser it got, headed or headless, and the WebGL renderer string (UNMASKED_RENDERER_WEBGL), so a
//      recording says whether paint was software (SwiftShader, llvmpipe, Basic Render Driver) or hardware.
//
// What it starts: a built-app server (APP_MODE=runtime, a generated spec, a temp data folder) and a Studio server (temp data folder), both on
// 127.0.0.1 and both stopped by PID at the end. The 10 000 rows go in through the CSV import route, POST /api/data/:table/import, the route
// the Import rows dialog calls. It never touches the real data folder, Ollama or the dev ports.
//
// Measured, median of --runs with the min and max beside it:
//   built app: list API at offset 0 and 9 950; navigation to the DataTable and RecordList rows on screen (cold context, so JS parse counts);
//              DataTable Next page (click to new rows painted, long tasks, React commits and component renders); wheel scroll of the 200 row
//              RecordList (frame gaps, dropped frames, long tasks).
//   Design:    on a page of 60+ parts and on a 5 part page, one drag of a part to another place and one width-handle resize: pointerdown
//              to the second frame after the drop, pointerup to the second frame, the per pointermove time to the next frame, long tasks
//              (over 50 ms) inside the gesture, and React commits and component renders (counted through a minimal devtools hook that reads
//              the PerformedWork flag of the fibers a commit touched, the way React DevTools does and without counting subtrees that bailed out;
//              it works on a production build).
// Notes: headless Chromium paints in software, so frame figures are a pessimistic floor, not a GPU number. "pointerdown to frame" includes the
// mouse steps the test driver sends (a few ms each); the pointerup and per move figures do not.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { REAL_OLLAMA_PORT } from '../lib/fakeOllamaServer.js';
import { SandboxSafetyError, assertSafeDataDir, assertSafePort, assertUnderTmp, buildChildEnv, samePath } from '../lib/sandboxSafety.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const START_TIMEOUT_MS = 40_000;
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const DIST = path.resolve(opt('--dist', path.join(os.tmpdir(), 'p31-bench-dist')));
const ROWS = Number(opt('--rows', '10000'));
const RUNS = Number(opt('--runs', '5'));
const PORT_GIVEN = argv.includes('--port');
const PORT_START = Number(opt('--port', '4650'));
// Without --port the range is 4650 to 4680; with --port it is --port up to --port-max (default --port + 30).
const PORT_FLOOR = PORT_GIVEN ? PORT_START : Math.max(4581, PORT_START);
const PORT_CEIL = Number(opt('--port-max', PORT_GIVEN ? String(PORT_START + 30) : '4680'));
const ONLY = opt('--only', 'all');
const HEADED = argv.includes('--headed');
const CHANNEL = opt('--channel', null);
const AS_JSON = argv.includes('--json');
if (!Number.isInteger(ROWS) || ROWS < 1 || !Number.isInteger(RUNS) || RUNS < 1) throw new Error('--rows and --runs need whole numbers of 1 or more');
if (!['all', 'lists', 'design', 'scroll'].includes(ONLY)) throw new Error('--only is lists, design or scroll');
if (!Number.isInteger(PORT_START) || !Number.isInteger(PORT_CEIL) || PORT_CEIL < PORT_FLOOR) throw new Error('--port and --port-max need whole port numbers, --port-max not below --port');
if (PORT_FLOOR < 1024 || PORT_CEIL > 65535 || PORT_CEIL - PORT_FLOOR > 1000) throw new Error('--port and --port-max must lie in 1024 to 65535 and span at most 1000 ports');
if (CHANNEL !== null && !['chrome', 'msedge'].includes(CHANNEL)) throw new Error('--channel is chrome or msedge');
if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error(`No index.html in ${DIST}. Build first: npx vite build --outDir <dir> --emptyOutDir`);
if (path.resolve(DIST) === path.join(ROOT, 'dist')) throw new Error('Point --dist at a folder of your own, not the repo dist/.');

// ---------------------------------------------------------------------------------------------------------------- small helpers

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => {
  const s = sorted(xs);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stat = (xs) => ({ med: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length });
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : 'n/a');
const results = [];
function row(group, name, unit, xs) {
  const s = stat(xs);
  results.push({ group, name, unit, ...s, samples: xs });
  console.log(`${group.padEnd(10)} ${name.padEnd(58)} ${f1(s.med).padStart(9)} ${unit.padEnd(6)} (min ${f1(s.min)}, max ${f1(s.max)}, n ${s.n})`);
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}
const taken = new Set();
// Ports that belong to something else: the owner preview (4321), the dev server (5174), the Voice/app port 4791 and the real Ollama.
// assertSafePort refuses only some of them and throws, so they are skipped here and assertSafePort stays the last check.
const NEVER_PORTS = new Set([4321, 5174, 4791, REAL_OLLAMA_PORT]);
async function pickPort() {
  for (let p = PORT_FLOOR; p <= PORT_CEIL; p += 1) {
    if (NEVER_PORTS.has(p) || taken.has(p) || !(await portIsFree(p))) continue;
    taken.add(p);
    return assertSafePort(p);
  }
  throw new Error(`No free port between ${PORT_FLOOR} and ${PORT_CEIL}.`);
}

const tempRoots = [];
const servers = [];
function stopServer(s) {
  if (s.child.exitCode !== null || s.child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(s.child.pid), '/T', '/F'], { stdio: 'ignore' });
  else s.child.kill();
}

/** Starts server.js on a port with a temp data folder. mode 'runtime' serves the generated spec as a built app; 'studio' is Studio. */
async function startServer({ mode, specPath }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `p31-bench-${mode}-`));
  assertUnderTmp(root);
  tempRoots.push(root);
  const dataDir = assertSafeDataDir(path.join(root, 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await pickPort();
  const extra = { APP_NO_DOTENV: '1', APP_DATA_DIR: dataDir, APP_HOST: '127.0.0.1', APP_PORT: String(port), APP_SCHEDULER: '0', APP_AI: '0', APP_DIST_DIR: DIST };
  if (mode === 'runtime') Object.assign(extra, { APP_MODE: 'runtime', APP_SPEC_PATH: specPath });
  const env = buildChildEnv({ homeDir: path.join(root, 'home'), extra });
  const hook = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'proHook.js')).href;
  const child = spawn(process.execPath, ['--import', hook, path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  const server = { child, url: `http://127.0.0.1:${port}`, port, dataDir };
  servers.push(server);
  const dbFile = path.join(dataDir, 'app.db');
  await new Promise((resolve, reject) => {
    const log = [];
    const timer = setTimeout(() => reject(new Error(`The ${mode} server did not start in ${START_TIMEOUT_MS} ms.\n${log.join('\n')}`)), START_TIMEOUT_MS);
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      log.push(line);
      if (line.startsWith('Local App Studio running at ')) {
        const reported = new URL(line.slice('Local App Studio running at '.length).trim());
        if (Number(reported.port) !== port) reject(new SandboxSafetyError(`The server reported a different address: ${line}`));
      } else if (line.startsWith('Data: ')) {
        if (!samePath(line.slice('Data: '.length).trim(), dbFile)) reject(new SandboxSafetyError(`The server reported a different data file: ${line}`));
        clearTimeout(timer);
        resolve();
      }
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => log.push(`stderr: ${line}`));
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`The ${mode} server exited early (code ${code}).\n${log.join('\n')}`)));
  });
  child.removeAllListeners('exit');
  return server;
}

// ---------------------------------------------------------------------------------------------------------------- specs and data

const THEME = { preset: 'aurora', radius: 'md' };
const APP = (name, slug) => ({ name, slug, identifier: `com.example.${slug.replaceAll('-', '')}`, version: '1.0.0', description: 'Large data bench', icon: 'users' });

/** The built app: one table, one page with a DataTable (page size 50) and a RecordList (source limit 200). */
function listSpec() {
  return {
    specVersion: 1,
    app: APP('Bench Orders', 'bench-orders'),
    tables: [
      {
        id: 'orders',
        label: 'Orders',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'status', label: 'Status', type: 'select', options: ['new', 'packed', 'shipped', 'late'], default: 'new' },
          { id: 'qty', label: 'Qty', type: 'integer', default: 1 },
          { id: 'amount', label: 'Amount', type: 'real' },
          { id: 'city', label: 'City', type: 'text' },
        ],
      },
    ],
    pages: [
      {
        id: 'home',
        title: 'Home',
        route: '/',
        sources: [
          { id: 'dt_src', table: 'orders', orderBy: [{ field: 'name', dir: 'asc' }], limit: 50 },
          { id: 'rl_src', table: 'orders', orderBy: [{ field: 'name', dir: 'asc' }], limit: 200 },
        ],
        layout: {
          id: 'root',
          type: 'Page',
          props: {},
          children: [
            { id: 'h_table', type: 'Heading', props: { size: 'lg' }, children: 'All orders' },
            { id: 'dt', type: 'DataTable', props: { source: 'dt_src', columns: ['name', 'status', 'qty', 'amount', 'city'], pageSize: 50 }, children: [] },
            { id: 'h_list', type: 'Heading', props: { size: 'lg' }, children: 'Order list' },
            { id: 'rl', type: 'RecordList', props: { source: 'rl_src', titleField: 'name', subtitleField: 'city', badgeField: 'status' }, children: [] },
          ],
        },
      },
    ],
    nav: [{ pageId: 'home', label: 'Home', icon: 'home' }],
    theme: THEME,
  };
}

/** Synthetic CSV, names zero padded so the ascending order is the row order. No personal data. */
function ordersCsv(first, last) {
  const status = ['new', 'packed', 'shipped', 'late'];
  const city = ['Northfield', 'Eastvale', 'Southport', 'Westbrook', 'Midtown', 'Lakeside', 'Hillcrest'];
  const lines = ['Name,Status,Qty,Amount,City'];
  for (let i = first; i <= last; i += 1) {
    lines.push(`Order ${String(i).padStart(6, '0')},${status[i % 4]},${(i % 9) + 1},${((i % 997) + 0.25).toFixed(2)},${city[i % 7]}`);
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** A Studio spec: the Crew Roster tables and one page. `big` is 60+ parts, else 5. Ids are fixed so the gestures find the same parts. */
function designSpec(big) {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json'), 'utf8'));
  const name = big ? 'Bench Big Page' : 'Bench Small Page';
  base.app = APP(name, big ? 'bench-big-page' : 'bench-small-page');
  const stat = (id, label) => ({ id, type: 'StatCard', sizing: { width: 'half', grow: false }, props: { source: 'open_crews', stat: 'count', label }, children: [] });
  const text = (id, words) => ({ id, type: 'Text', props: {}, children: words });
  const heading = (id, words) => ({ id, type: 'Heading', props: { size: 'md' }, children: words });
  const button = (id, label) => ({ id, type: 'Button', props: { action: { action: 'navigate', pageId: 'home', withRecord: false } }, children: label });
  const children = [heading('top_heading', 'Overview'), text('top_text', 'A short line to move.'), stat('top_stat_a', 'Open crews'), stat('top_stat_b', 'Open crews again')];
  if (big) {
    for (let s = 1; s <= 8; s += 1) {
      const parts = [heading(`s${s}_h`, `Section ${s}`), text(`s${s}_t`, `Notes for section ${s}.`), stat(`s${s}_a`, `Tile ${s}a`), stat(`s${s}_b`, `Tile ${s}b`), button(`s${s}_btn`, `Go ${s}`)];
      if (s % 3 === 0) parts.push({ id: `s${s}_dt`, type: 'DataTable', props: { source: 'open_crews', columns: ['name', 'size', 'status'], pageSize: 10 }, children: [] });
      children.push({ id: `sec${s}`, type: 'Section', props: { title: `Group ${s}` }, children: parts });
    }
    children.push({ id: 'rl_big', type: 'RecordList', props: { source: 'open_crews', titleField: 'name', badgeField: 'status' }, children: [] });
    children.push({ id: 'dt_big', type: 'DataTable', props: { source: 'open_crews', columns: ['name', 'size', 'status'], pageSize: 10 }, children: [] });
    for (let d = 1; d <= 3; d += 1) children.push({ id: `div${d}`, type: 'Divider', props: {}, children: [] });
    children.push({
      id: 'free_grid',
      type: 'Grid',
      props: { columns: 12, gap: 'md', placement: 'free', rows: 2 },
      children: [
        { ...heading('g_h', 'In the grid'), grid: { col: 1, span: 4, row: 1, rowSpan: 1 } },
        { ...text('g_t', 'Placed text'), grid: { col: 5, span: 4, row: 1, rowSpan: 1 } },
        { ...button('g_b', 'Placed button'), grid: { col: 9, span: 4, row: 1, rowSpan: 1 } },
        { ...stat('g_s1', 'Grid tile 1'), sizing: undefined, grid: { col: 1, span: 4, row: 2, rowSpan: 1 } },
        { ...stat('g_s2', 'Grid tile 2'), sizing: undefined, grid: { col: 5, span: 4, row: 2, rowSpan: 1 } },
        { ...text('g_t2', 'More placed text'), grid: { col: 9, span: 4, row: 2, rowSpan: 1 } },
      ],
    });
  } else {
    children.push(button('top_btn', 'Go'));
  }
  base.pages = [
    {
      id: 'home',
      title: 'Home',
      route: '/',
      sources: [{ id: 'open_crews', table: 'crews', where: [{ field: 'status', op: 'eq', value: 'active' }], orderBy: [{ field: 'name', dir: 'asc' }], limit: 50 }],
      layout: { id: 'root', type: 'Page', props: {}, children },
    },
  ];
  base.nav = [{ pageId: 'home', label: 'Home', icon: 'home' }];
  return base;
}
const countParts = (layer) => 1 + (Array.isArray(layer.children) ? layer.children.reduce((n, c) => n + countParts(c), 0) : 0);

// ---------------------------------------------------------------------------------------------------------------- in-page instrumentation

// Runs before the app. Long tasks (over 50 ms), a minimal devtools hook that counts commits and component renders from the PerformedWork
// flag (production safe), and a gesture recorder the driver arms around a pointer gesture.
const INIT = () => {
  const bench = { commits: 0, renders: 0, longtasks: [] };
  window.__bench = bench;
  const COMPONENT_TAGS = new Set([0, 11, 14, 15]); // function, forwardRef, memo, simple memo
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(_id, root) {
      bench.commits += 1;
      // The rule of React DevTools: a fiber drew in this commit when it carries PerformedWork, and a subtree is entered only when its
      // first child is not the one of the previous tree. A subtree that bailed out keeps the flags of its last render, which must not count again.
      const visit = (node, prev) => {
        if (COMPONENT_TAGS.has(node.tag) && (node.flags & 1) === 1) bench.renders += 1;
        if (prev !== null && node.child === prev.child) return;
        for (let child = node.child; child; child = child.sibling) visit(child, child.alternate);
      };
      visit(root.current, root.current.alternate);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    on() {},
    off() {},
    emit() {},
    sub: () => () => {},
  };
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) bench.longtasks.push({ start: e.startTime, dur: e.duration });
  });
  po.observe({ type: 'longtask', buffered: true });
  bench.take = () => {
    for (const e of po.takeRecords()) bench.longtasks.push({ start: e.startTime, dur: e.duration });
  };
  // Time after the second frame following `from` (a performance.now() value): rAF, rAF, then a message task, which runs after the paint.
  bench.afterFrames = (frames = 2) =>
    new Promise((resolve) => {
      const step = (left) => requestAnimationFrame(() => (left > 1 ? step(left - 1) : void setTimeout(() => resolve(performance.now()), 0)));
      step(frames);
    });
  // Gesture recorder: arm() before the mouse goes down; finish() after it is up.
  bench.arm = (watch) => {
    const g = { downAt: null, upAt: null, moves: [], c0: bench.commits, r0: bench.renders, pending: [], watched: null };
    // With watch ({ sel, before }) the gesture ends at the second frame after `sel` first reads differently from `before`, not at finish().
    if (watch) {
      g.watched = new Promise((resolve) => {
        const check = () => {
          const text = document.querySelector(watch.sel)?.innerText;
          if (text === undefined || text === watch.before) return;
          obs.disconnect();
          bench.afterFrames(2).then(resolve);
        };
        const obs = new MutationObserver(check);
        obs.observe(document.body, { subtree: true, childList: true, characterData: true });
      });
    }
    bench.g = g;
    const onDown = (e) => {
      if (g.downAt === null) g.downAt = e.timeStamp;
    };
    const onMove = (e) => {
      if (g.downAt === null) return;
      const at = e.timeStamp;
      g.pending.push(bench.afterFrames(1).then((t) => g.moves.push(t - at)));
    };
    const onUp = (e) => {
      if (g.downAt !== null && g.upAt === null) g.upAt = e.timeStamp;
    };
    g.off = () => {
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('pointermove', onMove, true);
      removeEventListener('pointerup', onUp, true);
    };
    addEventListener('pointerdown', onDown, true);
    addEventListener('pointermove', onMove, true);
    addEventListener('pointerup', onUp, true);
  };
  bench.finish = async () => {
    const g = bench.g;
    const end = g.watched ? await g.watched : await bench.afterFrames(2);
    await Promise.all(g.pending);
    g.off();
    bench.take();
    const inside = bench.longtasks.filter((t) => t.start + t.dur >= g.downAt && t.start <= end);
    const moves = [...g.moves].sort((a, b) => a - b);
    return {
      downToFrame: end - g.downAt,
      upToFrame: end - g.upAt,
      moveMedian: moves.length ? moves[moves.length >> 1] : 0,
      moveMax: moves.length ? moves[moves.length - 1] : 0,
      moves: moves.length,
      longTaskMs: inside.reduce((n, t) => n + t.dur, 0),
      longTaskMax: inside.reduce((n, t) => Math.max(n, t.dur), 0),
      longTasks: inside.length,
      commits: bench.commits - g.c0,
      renders: bench.renders - g.r0,
    };
  };
};

// ---------------------------------------------------------------------------------------------------------------- built app: lists

async function importCsv(base, from, to) {
  const csv = ordersCsv(from, to);
  const t0 = performance.now();
  const res = await fetch(`${base}/data/orders/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, dryRun: false }) });
  const body = await res.json();
  const ms = performance.now() - t0;
  if (!res.ok || body.data?.added !== to - from + 1 || body.data?.complete !== true) throw new Error(`The CSV import did not add its rows: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  console.log(`imported ${body.data.added} rows through POST ${base.replace(/^http:\/\/127\.0\.0\.1:\d+/, '')}/data/orders/import in ${f1(ms)} ms (${(csv.length / 1024).toFixed(0)} KiB CSV)`);
}

/** Frame gap at rest: the median requestAnimationFrame gap over one second, the cadence this headless browser paints at. */
async function idleGap(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const gaps = [];
        let last = performance.now();
        const t0 = last;
        const loop = (t) => {
          gaps.push(t - last);
          last = t;
          if (t - t0 < 1000) requestAnimationFrame(loop);
          else resolve(gaps.slice(1).sort((a, b) => a - b)[gaps.length >> 1]);
        };
        requestAnimationFrame(loop);
      }),
  );
}

/** 40 wheel events of 200 px, one every 16 ms, with the mouse already over the list; frame gaps and long tasks while it runs. */
async function scrollRun(page) {
  await page.evaluate(() => {
    const b = window.__bench;
    b.take();
    b.sc = { frames: [], last: performance.now(), t0: performance.now(), c0: b.commits, r0: b.renders, run: true };
    const loop = (t) => {
      if (!b.sc.run) return;
      b.sc.frames.push(t - b.sc.last);
      b.sc.last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  for (let w = 0; w < 40; w += 1) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const b = window.__bench;
    b.sc.run = false;
    b.take();
    const frames = b.sc.frames.slice(1).sort((a, c) => a - c);
    const long = b.longtasks.filter((t) => t.start >= b.sc.t0);
    return {
      frames: frames.length,
      dropped: frames.filter((d) => d > 25).length,
      p95: frames[Math.floor(frames.length * 0.95)] ?? 0,
      max: frames[frames.length - 1] ?? 0,
      long: long.reduce((n, t) => n + t.dur, 0),
      longMax: long.reduce((n, t) => Math.max(n, t.dur), 0),
      commits: b.commits - b.sc.c0,
      renders: b.renders - b.sc.r0,
      scrolled: (window.__scroller ? window.__scroller.scrollTop : window.scrollY) - window.__scrollStart,
    };
  });
}

async function listsBench(browser, studio, specPath) {
  const scrollOnly = ONLY === 'scroll'; // RecordList wheel scroll alone: 200 rows (the source limit), no list API, no Next page, no diagnostics, no floor page
  // Part 1, the built-app server (the data routes a built app serves): the whole file in one import, then the list API.
  if (!scrollOnly) {
    const app = await startServer({ mode: 'runtime', specPath });
    console.log(`built-app server ${app.url} (pid ${app.child.pid}), data in a temp folder`);
    await importCsv(`${app.url}/api`, 1, ROWS);

    const listUrl = (source, limit, offset) => `${app.url}/api/data/orders?page=home&source=${source}&limit=${limit}&offset=${offset}`;
    const timeGet = async (url) => {
      const t = performance.now();
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(`list failed: ${r.status}`);
      return { ms: performance.now() - t, total: j.data.total, rows: j.data.rows.length };
    };
    await timeGet(listUrl('dt_src', 50, 0)); // warm the connection and the statement cache; not counted
    for (const [label, source, limit, offset] of [
      ['list API GET offset 0, limit 50', 'dt_src', 50, 0],
      [`list API GET offset ${ROWS - 50}, limit 50`, 'dt_src', 50, ROWS - 50],
      ['list API GET offset 0, limit 200', 'rl_src', 200, 0],
    ]) {
      const xs = [];
      let seen = null;
      for (let i = 0; i < RUNS; i += 1) {
        const r = await timeGet(listUrl(source, limit, offset));
        xs.push(r.ms);
        seen = r;
      }
      row('lists', `${label} (rows ${seen.rows}, total ${seen.total ?? 'none'})`, 'ms', xs);
    }
  }

  // Part 2, the page: the same app in Studio's Preview (the UI bundle is the Studio one; a built app draws the same parts through the same
  // SpecRenderer, only the menu and frame around them differ). Preview takes up to 5 000 rows a file, so the rows go in as 5 000 row files.
  const res = await fetch(`${studio.url}/api/studio/apps/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec: listSpec() }) });
  const imported = await res.json();
  if (res.status !== 201) throw new Error(`Import of the list app failed: ${res.status} ${JSON.stringify(imported).slice(0, 300)}`);
  const appId = imported.data.id;
  const started = await fetch(`${studio.url}/api/studio/preview/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId }) });
  const startedBody = await started.json();
  if (!started.ok || startedBody.data?.state !== 'running') throw new Error(`Preview did not start: ${started.status} ${JSON.stringify(startedBody).slice(0, 300)}`);
  const previewRows = scrollOnly ? 200 : ROWS;
  for (let from = 1; from <= previewRows; from += 5000) await importCsv(`${studio.url}/api/preview`, from, Math.min(previewRows, from + 4999));
  const uiUrl = `${studio.url}/apps/${appId}/preview`;
  const DT = '[data-testid="preview-theme-scope"] [data-testid="dt"]';
  const RL = '[data-testid="preview-theme-scope"] [data-testid="rl"]';

  const m = { nextPaintOff: [], nextLongOff: [], variants: {}, idleGap: [], scrolled: [], dtVisible: [], dtPainted: [], rlVisible: [], rlPainted: [], dtFetchEnd: [], rlFetchEnd: [], loadLong: [], nodes: [], heapMb: [], nextPaint: [], nextLong: [], nextCommits: [], nextRenders: [], scrollFrames: [], scrollDropped: [], scrollP95: [], scrollMax: [], scrollLong: [], scrollLongMax: [], scrollCommits: [], scrollRenders: [] };
  for (let i = 0; i < RUNS; i += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(INIT);
    await page.addInitScript(
      ({ rows, listRows, dtSel, rlSel }) => {
        const mark = (window.__marks = { dt: null, rl: null });
        const tick = () => {
          const dt = document.querySelectorAll(`${dtSel} tbody tr`).length;
          const rl = document.querySelectorAll(`${rlSel} li`).length;
          if (mark.dt === null && dt >= rows) mark.dt = performance.now();
          if (mark.rl === null && rl >= listRows) mark.rl = performance.now();
          if (mark.dt === null || mark.rl === null) requestAnimationFrame(tick);
          else window.__bench.afterFrames(2).then((t) => (mark.painted = t));
        };
        requestAnimationFrame(tick);
      },
      { rows: 50, listRows: 200, dtSel: DT, rlSel: RL },
    );
    const problems = [];
    page.on('pageerror', (e) => problems.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text().slice(0, 200)));
    await page.goto(uiUrl, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__marks && window.__marks.painted !== undefined, undefined, { timeout: 30_000, polling: 100 }).catch(async (e) => {
      throw new Error(`The lists never showed: ${e.message}
Browser errors: ${problems.join(' | ')}
Page text: ${(await page.locator('body').innerText()).slice(0, 300)}`);
    });
    const load = await page.evaluate(() => {
      window.__bench.take();
      const fetches = performance.getEntriesByType('resource').filter((e) => e.name.includes('/data/orders?'));
      const end = (src) => fetches.find((e) => e.name.includes(`source=${src}`))?.responseEnd ?? NaN;
      return {
        dt: window.__marks.dt,
        rl: window.__marks.rl,
        painted: window.__marks.painted,
        dtFetchEnd: end('dt_src'),
        rlFetchEnd: end('rl_src'),
        long: window.__bench.longtasks.filter((t) => t.start < window.__marks.painted).reduce((n, t) => n + t.dur, 0),
        nodes: document.querySelectorAll('*').length,
        heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : NaN,
      };
    });
    m.dtVisible.push(load.dt);
    m.rlVisible.push(load.rl);
    m.dtPainted.push(load.painted);
    m.dtFetchEnd.push(load.dtFetchEnd);
    m.rlFetchEnd.push(load.rlFetchEnd);
    m.loadLong.push(load.long);
    m.nodes.push(load.nodes);
    m.heapMb.push(load.heap);

    // DataTable Next page: pointerdown to the new rows painted.
    if (!scrollOnly) {
      await page.waitForTimeout(500);
      const firstBefore = await page.locator(`${DT} tbody tr`).first().innerText();
      await page.evaluate((watch) => window.__bench.arm(watch), { sel: `${DT} tbody tr`, before: firstBefore });
      await page.locator(DT).getByRole('button', { name: 'Next', exact: true }).click();
      await page.waitForFunction(({ sel, before }) => document.querySelector(`${sel} tbody tr`)?.innerText !== before, { sel: DT, before: firstBefore }, { timeout: 15_000, polling: 'raf' });
      const next = await page.evaluate(() => window.__bench.finish());
      m.nextPaint.push(next.downToFrame);
      m.nextLong.push(next.longTaskMs);
      m.nextCommits.push(next.commits);
      m.nextRenders.push(next.renders);

      // Diagnostic: the same Next press again with the glass blur and background layer off (a different page of rows, so the table text changes).
      const blurOff = await page.addStyleTag({ content: '#bg-layer{display:none!important}*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' });
      // The pager ignores a click while a page is loading: wait until the first Next is settled (group not busy) before the second.
      await page.waitForFunction((sel) => document.querySelector(`${sel} [role="group"]`)?.getAttribute('aria-busy') === 'false', DT, { timeout: 15_000, polling: 'raf' });
      await page.waitForTimeout(500);
      const secondBefore = await page.locator(`${DT} tbody tr`).first().innerText();
      await page.evaluate((watch) => window.__bench.arm(watch), { sel: `${DT} tbody tr`, before: secondBefore });
      await page.locator(DT).getByRole('button', { name: 'Next', exact: true }).click();
      await page.waitForFunction(({ sel, before }) => document.querySelector(`${sel} tbody tr`)?.innerText !== before, { sel: DT, before: secondBefore }, { timeout: 15_000, polling: 'raf' });
      const nextOff = await page.evaluate(() => window.__bench.finish());
      m.nextPaintOff.push(nextOff.downToFrame);
      m.nextLongOff.push(nextOff.longTaskMs);
      await blurOff.evaluate((el) => el.remove());
    }

    // RecordList scroll: 40 wheel events of 200 px at about 60 per second over the 200 row list.
    await page.locator(`${RL} li`).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await page.locator(`${RL} li`).first().boundingBox();
    await page.mouse.move(box.x + 50, Math.min(Math.max(box.y + 10, 150), 800));
    await page.evaluate((sel) => {
      // Studio scrolls inside a frame, a built app scrolls the window: remember the scrolling element and where it stands.
      let el = document.querySelector(`${sel} li`);
      while (el && el !== document.body && el.scrollHeight <= el.clientHeight) el = el.parentElement;
      window.__scroller = el && el !== document.body ? el : null;
      window.__scrollStart = window.__scroller ? window.__scroller.scrollTop : window.scrollY;
    }, RL);
    m.idleGap.push(await idleGap(page));
    const sc = await scrollRun(page);
    if (sc.scrolled < 1000) {
      const why = await page.evaluate(({ x, y }) => ({ under: document.elementFromPoint(x, y)?.outerHTML.slice(0, 120), scroller: window.__scroller?.outerHTML.slice(0, 120) ?? 'window', winY: window.scrollY, docH: document.documentElement.scrollHeight }), { x: box.x + 50, y: Math.min(Math.max(box.y + 10, 150), 800) });
      throw new Error(`The scroll did not move the list enough (moved ${sc.scrolled} px): ${JSON.stringify(why)}`);
    }
    m.scrolled.push(sc.scrolled);
    m.scrollFrames.push(sc.frames);
    m.scrollDropped.push(sc.dropped);
    m.scrollP95.push(sc.p95);
    m.scrollMax.push(sc.max);
    m.scrollLong.push(sc.long);
    m.scrollLongMax.push(sc.longMax);
    m.scrollCommits.push(sc.commits);
    m.scrollRenders.push(sc.renders);
    // Diagnostics, same script, to see what the dropped frames are made of: the glass blur and background layer off, rows skipping paint
    // while off screen (content-visibility, a CSS way to what windowing does), and both. These are not product changes.
    for (const [name, css] of scrollOnly ? [] : [
      ['blur and background off', `#bg-layer{display:none!important}*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`],
      ['off-screen rows skip paint', `${RL} li{content-visibility:auto;contain-intrinsic-size:auto 44px}`],
      ['both', `#bg-layer{display:none!important}*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}${RL} li{content-visibility:auto;contain-intrinsic-size:auto 44px}`],
    ]) {
      const style = await page.addStyleTag({ content: css });
      await page.locator(`${RL} li`).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.evaluate((sel) => {
        let el = document.querySelector(`${sel} li`);
        while (el && el !== document.body && el.scrollHeight <= el.clientHeight) el = el.parentElement;
        window.__scroller = el && el !== document.body ? el : null;
        window.__scrollStart = window.__scroller ? window.__scroller.scrollTop : window.scrollY;
      }, RL);
      const v = await scrollRun(page);
      (m.variants[name] ??= { dropped: [], p95: [], max: [] });
      m.variants[name].dropped.push(v.dropped);
      m.variants[name].p95.push(v.p95);
      m.variants[name].max.push(v.max);
      await style.evaluate((el) => el.remove());
    }
    await context.close();
  }
  // The floor of this headless browser: the same wheel script over a plain page of 200 static rows of the same height, no framework.
  const floor = { idleGap: [], frames: [], dropped: [], p95: [], max: [] };
  for (let i = 0; i < (scrollOnly ? 0 : RUNS); i += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(INIT);
    const items = Array.from({ length: 200 }, (_, n) => `<li>Order ${n}<br><small>Northfield</small></li>`).join('');
    const html = `<style>body{margin:0;font:14px sans-serif}li{list-style:none;height:40px;padding:2px 8px;border-bottom:1px solid #ccc}</style><ul style="margin:0;padding:0">${items}</ul>`;
    await page.goto(`data:text/html,${encodeURIComponent(html)}`);
    await page.waitForTimeout(500);
    await page.mouse.move(100, 400);
    await page.evaluate(() => {
      window.__scroller = null;
      window.__scrollStart = window.scrollY;
    });
    floor.idleGap.push(await idleGap(page));
    const sc = await scrollRun(page);
    floor.frames.push(sc.frames);
    floor.dropped.push(sc.dropped);
    floor.p95.push(sc.p95);
    floor.max.push(sc.max);
    await context.close();
  }
  if (!scrollOnly) {
    row('floor', 'plain 200 row page, idle frame gap', 'ms', floor.idleGap);
    row('floor', 'plain 200 row page, scroll: frames', 'count', floor.frames);
    row('floor', 'plain 200 row page, scroll: dropped frames (gap over 25 ms)', 'count', floor.dropped);
    row('floor', 'plain 200 row page, scroll: p95 frame gap', 'ms', floor.p95);
    row('floor', 'plain 200 row page, scroll: max frame gap', 'ms', floor.max);
  }
  row('lists', 'Preview page at rest: idle frame gap (both lists shown)', 'ms', m.idleGap);
  row('lists', 'navigation to 50 DataTable rows in the DOM (cold)', 'ms', m.dtVisible);
  row('lists', 'navigation to 200 RecordList rows in the DOM (cold)', 'ms', m.rlVisible);
  row('lists', 'navigation to both lists painted (cold)', 'ms', m.dtPainted);
  row('lists', 'DataTable list fetch finished at (from navigation start)', 'ms', m.dtFetchEnd);
  row('lists', 'RecordList list fetch finished at (from navigation start)', 'ms', m.rlFetchEnd);
  row('lists', 'long task total until both lists painted', 'ms', m.loadLong);
  row('lists', 'DOM nodes with both lists shown', 'nodes', m.nodes);
  row('lists', 'JS heap with both lists shown', 'MiB', m.heapMb);
  if (!scrollOnly) {
    row('lists', 'DataTable Next: pointerdown to new rows painted', 'ms', m.nextPaint);
    row('lists', 'DataTable Next: long task total', 'ms', m.nextLong);
    row('diagnostic', 'DataTable Next with blur and background off: pointerdown to new rows painted', 'ms', m.nextPaintOff);
    row('diagnostic', 'DataTable Next with blur and background off: long task total', 'ms', m.nextLongOff);
    row('lists', 'DataTable Next: React commits', 'count', m.nextCommits);
    row('lists', 'DataTable Next: component renders', 'count', m.nextRenders);
  }
  row('lists', 'RecordList scroll (40 wheel events): frames', 'count', m.scrollFrames);
  console.log(`lists      scrolled ${f1(m.scrolled[0])} px of the list in each run (first run shown)`);
  row('lists', 'RecordList scroll: dropped frames (gap over 25 ms)', 'count', m.scrollDropped);
  row('lists', 'RecordList scroll: p95 frame gap', 'ms', m.scrollP95);
  row('lists', 'RecordList scroll: max frame gap', 'ms', m.scrollMax);
  row('lists', 'RecordList scroll: long task total', 'ms', m.scrollLong);
  row('lists', 'RecordList scroll: longest long task', 'ms', m.scrollLongMax);
  for (const [name, v] of Object.entries(m.variants)) {
    row('diagnostic', `RecordList scroll with ${name}: dropped frames`, 'count', v.dropped);
    row('diagnostic', `RecordList scroll with ${name}: p95 frame gap`, 'ms', v.p95);
  }
  row('lists', 'RecordList scroll: React commits', 'count', m.scrollCommits);
  row('lists', 'RecordList scroll: component renders', 'count', m.scrollRenders);
}

// ---------------------------------------------------------------------------------------------------------------- Design

async function lit(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('span.bg-slate-brand')].filter((el) => /^Drop (here|beside)$/.test(el.textContent ?? '')).length === 1, undefined, { timeout: 10_000 });
}

/** One drag of the top Text to the first drop place well below it. Returns the in-page gesture figures. */
async function dragGesture(page) {
  const canvas = page.getByRole('region', { name: 'Page layout' });
  await canvas.locator('[data-canvas-block][data-layer-id="top_text"]').focus();
  const grip = page.getByRole('button', { name: 'Drag to move Text', exact: true });
  await grip.hover();
  const from = await grip.boundingBox();
  await page.evaluate(() => window.__bench.arm());
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 40, from.y + from.height / 2 + 40, { steps: 5 });
  await page.waitForSelector('[data-zone^="root:"]', { state: 'attached' });
  const target = await page.evaluate((fromY) => {
    const vh = window.innerHeight;
    const boxes = [...document.querySelectorAll('[data-zone^="root:"]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.top > fromY + 120 && r.top + r.height / 2 < vh - 100)
      .sort((a, b) => a.top - b.top);
    const r = boxes[0];
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, from.y);
  if (!target) throw new Error('No drop place in view below the dragged part.');
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await lit(page);
  await page.mouse.up();
  return page.evaluate(() => window.__bench.finish());
}

/** One drag of the width handle between the first two number tiles by two twelfths of the row. */
async function resizeGesture(page) {
  const canvas = page.getByRole('region', { name: 'Page layout' });
  const grip = page.getByRole('separator', { name: /^Resize Number tile and /, exact: false }).first();
  await grip.hover();
  const from = await grip.boundingBox();
  const rowWidth = await canvas.locator('[data-canvas-block][data-layer-id="top_stat_a"]').evaluate((el) => el.closest('[data-sizing-row]').getBoundingClientRect().width);
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.evaluate(() => window.__bench.arm());
  await page.mouse.down();
  await page.waitForFunction((el) => document.activeElement === el, await grip.elementHandle(), { timeout: 5000 });
  await page.mouse.move(x + (rowWidth * 2) / 12, y, { steps: 10 });
  await page.mouse.up();
  return page.evaluate(() => window.__bench.finish());
}

async function designBench(browser, studio) {
  const pages = {};
  for (const [label, big] of [
    ['big', true],
    ['small', false],
  ]) {
    const spec = designSpec(big);
    const parts = countParts(spec.pages[0].layout) - 1;
    const res = await fetch(`${studio.url}/api/studio/apps/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec }) });
    const body = await res.json();
    if (res.status !== 201) throw new Error(`Import of the ${label} page failed: ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
    pages[label] = { id: body.data.id, parts };
    console.log(`Design page "${label}": ${parts} parts below the page root`);
  }
  for (const label of ['small', 'big']) {
    const acc = { drag: {}, resize: {} };
    for (let i = 0; i < RUNS; i += 1) {
      for (const [gesture, run] of [
        ['drag', dragGesture],
        ['resize', resizeGesture],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        await page.addInitScript(INIT);
        await page.goto(`${studio.url}/apps/${pages[label].id}/design`);
        await page.getByRole('region', { name: 'Page layout' }).waitFor();
        await page.getByRole('region', { name: 'Page layout' }).locator('[data-canvas-block]').first().waitFor();
        await page.waitForTimeout(800); // let the first render settle
        const r = await run(page);
        for (const [k, v] of Object.entries(r)) (acc[gesture][k] ??= []).push(v);
        await context.close();
      }
    }
    for (const gesture of ['drag', 'resize']) {
      const a = acc[gesture];
      const tag = `${pages[label].parts} parts, ${gesture}`;
      row('design', `${tag}: pointerdown to 2nd frame after drop (incl. driver steps)`, 'ms', a.downToFrame);
      row('design', `${tag}: pointerup to 2nd frame after drop`, 'ms', a.upToFrame);
      row('design', `${tag}: pointermove to next frame, median per gesture`, 'ms', a.moveMedian);
      row('design', `${tag}: pointermove to next frame, worst per gesture`, 'ms', a.moveMax);
      row('design', `${tag}: long task total in gesture (tasks over 50 ms)`, 'ms', a.longTaskMs);
      row('design', `${tag}: longest long task`, 'ms', a.longTaskMax);
      row('design', `${tag}: React commits`, 'count', a.commits);
      row('design', `${tag}: component renders (all commits of the gesture)`, 'count', a.renders);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- main

const GB = 1024 ** 3;
const startFree = os.freemem();
console.log(`machine: ${os.cpus().length} x ${os.cpus()[0]?.model.trim()}, ${f1(os.totalmem() / GB)} GiB RAM, ${f1(startFree / GB)} GiB free at start, node ${process.version}, ${process.platform} ${process.arch}`);
console.log(`dist: ${DIST}, rows ${ROWS}, runs ${RUNS}`);
let browser = null;
try {
  browser = await chromium.launch({ headless: !HEADED, ...(CHANNEL ? { channel: CHANNEL } : {}) });
  const probe = await browser.newPage();
  const gpu = await probe
    .evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return 'no WebGL context';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : `${gl.getParameter(gl.RENDERER)} (renderer info hidden)`;
    })
    .catch((e) => `unknown (${String(e.message).slice(0, 80)})`);
  await probe.close();
  console.log(`browser: ${CHANNEL ?? 'bundled chromium'} ${browser.version()}, ${HEADED ? 'headed' : 'headless'}, WebGL renderer: ${gpu}`);
  const studio = await startServer({ mode: 'studio' });
  console.log(`Studio server ${studio.url} (pid ${studio.child.pid}), data in a temp folder`);
  // Mark the first-run welcome as done, as a person does once, so its dialog does not sit over the page.
  const onboarded = await fetch(`${studio.url}/api/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onboarded: true }) });
  if (!onboarded.ok) throw new Error(`Could not mark onboarding done: ${onboarded.status}`);
  if (ONLY !== 'design') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p31-bench-spec-'));
    assertUnderTmp(dir);
    tempRoots.push(dir);
    const specPath = path.join(dir, 'app-spec.json');
    fs.writeFileSync(specPath, JSON.stringify(listSpec()));
    await listsBench(browser, studio, specPath);
  }
  if (ONLY === 'all' || ONLY === 'design') await designBench(browser, studio);
  console.log(`free memory at end: ${f1(os.freemem() / GB)} GiB`);
  if (AS_JSON) console.log(JSON.stringify({ startFreeGiB: startFree / GB, results }));
} finally {
  await browser?.close().catch(() => {});
  for (const s of servers) stopServer(s);
  await new Promise((r) => setTimeout(r, 1000));
  for (const dir of tempRoots) {
    try {
      fs.rmSync(assertUnderTmp(dir), { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
    } catch {
      // Windows EBUSY: the OS temp cleaner takes it
    }
  }
}
