// The port registry of the phases (phases.json): the owner's ports, the pool the phases draw from and one block per phase.
// cleanup.js reads and frees the same file, so there is one registry.
//
//   node scripts/phase/ports.js [--list] [--live] [--file <phases.json>]
//   node scripts/phase/ports.js --allocate [--phase <N>] [--size <ports>] [--dry-run]
//   node scripts/phase/ports.js --free [--phase <N>] [--dry-run]
//   node scripts/phase/ports.js --check <port>
//
// The phase comes from the folder name or the branch (las-wt-phase27, feat/phase27-...). The file defaults to phases.json in the
// workspace folder; a missing file is created by --allocate. An owner port is never allocated. --dry-run prints and writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_PORTS, freePortBlock } from './lib/cleanupPlan.js';
import { writeFileAtomic } from './lib/gateRun.js';
import { readPortHolders } from './lib/processTable.js';
import { REPO_ROOT, parseFlags, readJsonFile, repoFacts, wholeNumber, workspaceDir } from './common.js';

export const DEFAULT_BLOCK = 100;
export const MAX_BLOCK = 1000;
export const DEFAULT_POOL = Object.freeze([4581, 4780]);
const RESERVED_WHY = Object.freeze({ 4321: 'owner preview (main checkout)', 4791: 'owner port', 5174: 'dev server (strictPort)', 11434: 'Ollama' });
const USAGE = `Usage: node scripts/phase/ports.js [--list] [--live] | --allocate [--phase <N>] [--size <n>] | --free [--phase <N>] | --check <port>
         [--file <phases.json>] [--workspace <dir>] [--dry-run]`;

/** A fresh registry: the owner's ports and the pool, no phase block yet. */
export function seedRegistry() {
  return { v: 1, owner: OWNER_PORTS.map((port) => ({ port, why: RESERVED_WHY[port] ?? 'owner port' })), pool: [...DEFAULT_POOL], phases: [] };
}

/** True when `from..to` meets any owner port. */
export const touchesOwner = (from, to) => OWNER_PORTS.some((p) => p >= from && p <= to);

/** The registry as a clean object: an unknown layout falls back to a seed with the phases that can be read. */
export function normalize(json) {
  const seed = seedRegistry();
  if (!json || typeof json !== 'object') return seed;
  const pool = Array.isArray(json.pool) && json.pool.length === 2 && json.pool.every(Number.isInteger) && json.pool[0] <= json.pool[1] ? json.pool : seed.pool;
  const phases = Array.isArray(json.phases) ? json.phases.filter((e) => e && Number.isInteger(Number(e.phase)) && Array.isArray(e.ports) && e.ports.length === 2) : [];
  return { ...json, v: 1, owner: seed.owner, pool, phases };
}

const isActive = (e) => e.status !== 'free';

/**
 * Gives the phase a block: its active one when it has one, else the lowest block of `size` ports in the pool that meets no
 * active block and no owner port.
 * @param {unknown} json
 * @param {number} phase
 * @param {{ size?: number, now?: Date }} [o]
 * @returns {{ registry: object, entry: object | null, created: boolean, note: string }}
 */
export function allocate(json, phase, { size = DEFAULT_BLOCK, now = new Date() } = {}) {
  const reg = normalize(json);
  const have = reg.phases.find((e) => Number(e.phase) === phase && isActive(e));
  if (have) return { registry: reg, entry: have, created: false, note: `phase ${phase} already has ${have.ports[0]}-${have.ports[1]}` };
  const taken = reg.phases.filter(isActive).map((e) => e.ports);
  for (let from = reg.pool[0]; from + size - 1 <= reg.pool[1]; from += size) {
    const to = from + size - 1;
    if (touchesOwner(from, to) || taken.some(([a, b]) => from <= b && a <= to)) continue;
    const entry = { phase, ports: [from, to], status: 'active', allocatedAt: now.toISOString() };
    const phases = [...reg.phases.filter((e) => Number(e.phase) !== phase || isActive(e)), entry];
    return { registry: { ...reg, phases }, entry, created: true, note: `allocated ${from}-${to} to phase ${phase}` };
  }
  return { registry: reg, entry: null, created: false, note: `no free block of ${size} ports in the pool ${reg.pool[0]}-${reg.pool[1]}` };
}

/**
 * Who holds a port: an owner reservation, a phase block, or nobody.
 * @returns {{ port: number, owner: string | null, free: boolean }}
 */
export function check(json, port) {
  const reg = normalize(json);
  if (OWNER_PORTS.includes(port)) return { port, owner: `owner: ${RESERVED_WHY[port] ?? 'owner port'}`, free: false };
  const e = reg.phases.find((x) => isActive(x) && port >= x.ports[0] && port <= x.ports[1]);
  if (e) return { port, owner: `phase ${e.phase}`, free: false };
  return { port, owner: null, free: true };
}

/** The registry as a table, one line per row. `holders` adds the live listeners of each block. */
export function renderRegistry(json, holders = null) {
  const reg = normalize(json);
  const lines = ['owner ports (never allocated):'];
  for (const o of reg.owner) lines.push(`  ${o.port}  ${o.why}`);
  lines.push(`pool ${reg.pool[0]}-${reg.pool[1]}`);
  if (reg.phases.length === 0) lines.push('no phase block yet');
  for (const e of reg.phases) {
    const listening = holders === null ? [] : holders.filter((h) => h.port >= e.ports[0] && h.port <= e.ports[1]);
    const live = holders === null ? '' : `  listening: ${listening.map((h) => `${h.port}=pid ${h.pid}`).join(', ') || 'none'}`;
    lines.push(`phase ${e.phase}  ${e.ports[0]}-${e.ports[1]}  ${isActive(e) ? 'active' : `free (${e.freedAt ?? 'earlier'})`}${live}`);
  }
  return lines.join('\n');
}

/** The phase's block as `<from>-<to>` text (the `--ports` value of cleanup.js, and the line a brief quotes), or null. */
export function blockText(json, phase) {
  const e = normalize(json).phases.find((x) => Number(x.phase) === phase && isActive(x));
  return e ? `${e.ports[0]}-${e.ports[1]}` : null;
}

const portsOf = (e) => Array.from({ length: e.ports[1] - e.ports[0] + 1 }, (_, i) => e.ports[0] + i);

/**
 * @param {string[]} argv
 * @param {{ out?: (l: string) => void, err?: (l: string) => void, root?: string, homedir?: string, readHolders?: typeof readPortHolders, now?: () => Date }} [deps]
 * @returns {Promise<number>} exit code: 0 done, 1 nothing to give or a port in use, 2 usage
 */
export async function main(argv, deps = {}) {
  const d = { out: (l) => console.log(l), err: (l) => console.error(l), root: REPO_ROOT, homedir: undefined, readHolders: readPortHolders, now: () => new Date(), ...deps };
  const parsed = parseFlags(argv, { list: 'bool', live: 'bool', allocate: 'bool', free: 'bool', check: 'string', phase: 'string', size: 'string', file: 'string', workspace: 'string', 'dry-run': 'bool' });
  if ('error' in parsed) {
    d.err(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const o = parsed.opts;
  if ([o.list, o.allocate, o.free, o.check !== null].filter(Boolean).length > 1) {
    d.err(`pick one of --list, --allocate, --free, --check\n${USAGE}`);
    return 2;
  }
  const file = o.file ?? path.join(o.workspace ?? workspaceDir(d.homedir), 'phases.json');
  const existing = readJsonFile(file);
  const reg = normalize(existing);

  if (o.check !== null) {
    const port = wholeNumber(o.check);
    if (port === null || port < 1 || port > 65535) {
      d.err(`--check needs a port\n${USAGE}`);
      return 2;
    }
    const r = check(reg, port);
    d.out(`${port}: ${r.owner ?? 'free'}`);
    return r.free ? 0 : 1;
  }

  if (o.allocate || o.free) {
    const facts = await repoFacts(d.root);
    const phase = o.phase === null ? facts.phase : wholeNumber(o.phase);
    if (phase === null || phase < 1) {
      d.err(`no phase: pass --phase or run inside las-wt-phase<N>\n${USAGE}`);
      return 2;
    }
    let next = null;
    let note;
    let code = 0;
    if (o.allocate) {
      const size = o.size === null ? DEFAULT_BLOCK : wholeNumber(o.size);
      if (size === null || size < 1 || size > MAX_BLOCK) {
        d.err(`--size needs 1 to ${MAX_BLOCK}\n${USAGE}`);
        return 2;
      }
      const r = allocate(reg, phase, { size, now: d.now() });
      note = r.note;
      if (r.entry === null) code = 1;
      else if (r.created) next = r.registry;
    } else {
      const r = freePortBlock(reg, phase, d.now());
      note = r.note;
      if (r.changed) next = r.json;
    }
    d.out(`${o['dry-run'] ? 'dry run: ' : ''}${note}`);
    if (next !== null && !o['dry-run']) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
      d.out(`wrote ${file}`);
    }
    if (next !== null) d.out(renderRegistry(next));
    return code;
  }

  const live = o.live ? await d.readHolders(reg.phases.filter(isActive).flatMap(portsOf)) : null;
  d.out(`registry ${file}${existing === null ? ' (not created yet; --allocate creates it)' : ''}`);
  d.out(renderRegistry(reg, live === null ? null : live.holders));
  if (live !== null && !live.known) d.out('note: the port listing could not be read');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`ports: ${e.message}`);
      process.exit(1);
    },
  );
}
