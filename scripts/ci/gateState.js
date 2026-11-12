// The quarantine state of the gate: `.gate/flaky.json` (ignored by git). Pure transitions plus a little file and CI
// artifact plumbing. Rules (DESIGN-phase15 section 2.3):
//  - a test that failed, then passed when rerun alone, is "flaky"; flaky in 2 runs in a row quarantines it for 7 days;
//  - a quarantined test still runs, but its failure does not fail the gate;
//  - a quarantined test that fails 3 runs in a row is released (unquarantined) and fails the gate;
//  - nothing is quarantined on a protected gate, and the file is never written there.
// CLI (CI only): `node scripts/ci/gateState.js restore --branch <ref> | --any-branch` downloads the newest `gate-state`
// artifact of this repository (never a fork's) into `.gate/`; `--any-branch` is for jobs with a read-only token only; `save` checks that the files to upload exist. Neither ever fails the job.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { REPO_ROOT } from '../checks/gitFiles.js'
import { GhError, createApi } from './ghApi.js'

export const QUARANTINE_DAYS = 7
export const FLAKY_RUNS_TO_QUARANTINE = 2
export const FAIL_RUNS_TO_RELEASE = 3
export const MAX_ENTRIES = 500
export const HISTORY = 10
export const STATE_FILE = '.gate/flaky.json'
export const ARTIFACT_NAME = 'gate-state'

const DAY_MS = 24 * 60 * 60 * 1000
const toMs = (now) => (now instanceof Date ? now.getTime() : Number(now))
const iso = (ms) => new Date(ms).toISOString()

/** A fresh, empty state. */
export function emptyState() {
  return { version: 1, updatedAt: null, tests: {} }
}

const OUTCOMES = ['pass', 'flaky', 'fail']
const STRING_MAX = 500
const hasControl = (v) => [...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const isText = (v) => typeof v === 'string' && v.length > 0 && v.length <= STRING_MAX && !hasControl(v)
const isStreak = (v) => Number.isInteger(v) && v >= 0 && v <= FAIL_RUNS_TO_RELEASE
const isTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v))

/** One saved entry in its trusted shape, or null when any field is off. `now` is a ms timestamp. */
function cleanEntry(key, entry, now) {
  if (!isText(key) || !entry || typeof entry !== 'object') return null
  const { kind, file, title, project, flakyStreak, failStreak, lastOutcome, lastRunId, lastRunAt, history, quarantine } = entry
  if (kind !== 'unit' && kind !== 'e2e') return null
  if (!isText(file) || !isText(title) || !(project === null || project === undefined || isText(project))) return null
  if (!isStreak(flakyStreak) || !isStreak(failStreak)) return null
  if (!(lastOutcome === null || OUTCOMES.includes(lastOutcome))) return null
  if (!(lastRunId === null || isText(lastRunId)) || !(lastRunAt === null || isTime(lastRunAt))) return null
  if (!Array.isArray(history) || history.length > HISTORY) return null
  const cleanHistory = []
  for (const h of history) {
    if (!h || !isText(h.runId) || !isTime(h.at) || !OUTCOMES.includes(h.outcome)) return null
    cleanHistory.push({ runId: h.runId, at: h.at, outcome: h.outcome })
  }
  let q = null
  if (quarantine !== null && quarantine !== undefined) {
    if (typeof quarantine !== 'object' || !isTime(quarantine.since) || !isTime(quarantine.until) || !isText(quarantine.runId) || !isText(quarantine.reason)) return null
    const since = Date.parse(quarantine.since)
    const until = Date.parse(quarantine.until)
    if (since > now || until < since || until - since > QUARANTINE_DAYS * DAY_MS) return null
    q = { since: quarantine.since, until: quarantine.until, runId: quarantine.runId, reason: quarantine.reason }
  }
  return { kind, file, title, project: project ?? null, flakyStreak, failStreak, lastOutcome, lastRunId, lastRunAt, history: cleanHistory, quarantine: q }
}

/**
 * The state file, or an empty state when it is missing or not valid JSON (the second case sets `note`). The file can come
 * from a CI artifact, so every entry is checked (types, streaks 0 to 3, a quarantine that began in the past and lasts at
 * most 7 days) and an entry that fails any check is dropped; `note` then says how many.
 * @param {string} [file]
 * @param {number | Date} [now]
 * @returns {{ version: 1, updatedAt: string | null, tests: Record<string, object> } & { note?: string }}
 */
export function readState(file = path.join(REPO_ROOT, STATE_FILE), now = Date.now()) {
  if (!existsSync(file)) return emptyState()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || parsed.version !== 1 || !parsed.tests || typeof parsed.tests !== 'object' || Array.isArray(parsed.tests)) {
      return { ...emptyState(), note: 'The quarantine file had an unknown layout, so it was ignored.' }
    }
    const t = toMs(now)
    const tests = {}
    let dropped = 0
    for (const [key, entry] of Object.entries(parsed.tests)) {
      const clean = Object.keys(tests).length < MAX_ENTRIES ? cleanEntry(key, entry, t) : null
      if (clean) tests[key] = clean
      else dropped += 1
    }
    const state = { version: 1, updatedAt: isTime(parsed.updatedAt) ? parsed.updatedAt : null, tests }
    return dropped > 0 ? { ...state, note: `${dropped} entr${dropped === 1 ? 'y' : 'ies'} of the quarantine file looked wrong and ${dropped === 1 ? 'was' : 'were'} ignored.` } : state
  } catch {
    return { ...emptyState(), note: 'The quarantine file could not be read, so it was ignored.' }
  }
}

/**
 * Entries whose quarantine ended (`until <= now`) lose it and their streaks. A quarantine is never extended.
 * @returns {{ state: ReturnType<typeof emptyState>, expired: string[] }}
 */
export function expire(state, now) {
  const t = toMs(now)
  const tests = {}
  const expired = []
  for (const [key, entry] of Object.entries(state.tests)) {
    if (entry.quarantine && Date.parse(entry.quarantine.until) <= t) {
      tests[key] = { ...entry, quarantine: null, flakyStreak: 0, failStreak: 0 }
      expired.push(key)
    } else tests[key] = entry
  }
  return { state: { ...state, tests }, expired }
}

const blank = (o) => ({
  kind: o.kind,
  file: o.file,
  title: o.title,
  project: o.project ?? null,
  flakyStreak: 0,
  failStreak: 0,
  lastOutcome: null,
  lastRunId: null,
  lastRunAt: null,
  history: [],
  quarantine: null,
})

/** Keeps at most MAX_ENTRIES: the oldest `lastRunAt` go first, quarantined entries never. */
function capEntries(tests) {
  const keys = Object.keys(tests)
  if (keys.length <= MAX_ENTRIES) return tests
  const droppable = keys.filter((k) => !tests[k].quarantine).sort((a, b) => String(tests[a].lastRunAt).localeCompare(String(tests[b].lastRunAt)))
  const drop = new Set(droppable.slice(0, keys.length - MAX_ENTRIES))
  return Object.fromEntries(keys.filter((k) => !drop.has(k)).map((k) => [k, tests[k]]))
}

/**
 * Applies one run's outcomes. `outcomes`: `[{ key, kind, file, title, project, outcome: 'pass' | 'flaky' | 'fail' }]`.
 * Tests that did not run this time are untouched. On a protected gate the state is returned unchanged and every flaky
 * or failed test fails the step.
 * @returns {{ state: object, newlyQuarantined: string[], released: string[], failing: string[], quarantinedFailures: string[] }}
 */
export function applyOutcomes(state, outcomes, { now, runId, protectedGate = false }) {
  const t = toMs(now)
  const at = iso(t)
  const failing = []
  const quarantinedFailures = []
  const newlyQuarantined = []
  const released = []
  const tests = { ...state.tests }
  for (const o of outcomes) {
    const was = state.tests[o.key]
    if (protectedGate) {
      if (o.outcome !== 'pass') failing.push(o.key)
      continue
    }
    if (o.outcome === 'pass') {
      if (!was) continue
      if (!was.quarantine) {
        delete tests[o.key]
        continue
      }
      tests[o.key] = { ...was, flakyStreak: 0, failStreak: 0, lastOutcome: 'pass', lastRunId: runId, lastRunAt: at, history: [...was.history, { runId, at, outcome: 'pass' }].slice(-HISTORY) }
      continue
    }
    const entry = { ...(was ?? blank(o)) }
    entry.lastOutcome = o.outcome
    entry.lastRunId = runId
    entry.lastRunAt = at
    entry.history = [...(was?.history ?? []), { runId, at, outcome: o.outcome }].slice(-HISTORY)
    if (entry.quarantine) {
      if (o.outcome === 'flaky') {
        entry.failStreak = 0
        quarantinedFailures.push(o.key)
      } else {
        entry.failStreak += 1
        if (entry.failStreak >= FAIL_RUNS_TO_RELEASE) {
          entry.quarantine = null
          entry.flakyStreak = 0
          entry.failStreak = 0
          released.push(o.key)
          failing.push(o.key)
        } else quarantinedFailures.push(o.key)
      }
    } else if (o.outcome === 'flaky') {
      entry.flakyStreak += 1
      entry.failStreak = 0
      if (entry.flakyStreak >= FLAKY_RUNS_TO_QUARANTINE) {
        entry.quarantine = { since: at, until: iso(t + QUARANTINE_DAYS * DAY_MS), runId, reason: 'flaky in 2 runs in a row' }
        newlyQuarantined.push(o.key)
        quarantinedFailures.push(o.key)
      } else failing.push(o.key)
    } else {
      entry.flakyStreak = 0
      entry.failStreak = 0
      failing.push(o.key)
    }
    tests[o.key] = entry
  }
  if (protectedGate) return { state, newlyQuarantined, released, failing, quarantinedFailures }
  return { state: { ...state, updatedAt: at, tests: capEntries(tests) }, newlyQuarantined, released, failing, quarantinedFailures }
}

/** Writes the state atomically (one temp file per process). Refuses on a protected gate; writes nothing for a GATE_LIGHT_CHILD. */
export function writeState(state, file = path.join(REPO_ROOT, STATE_FILE), { protectedGate = false, env = process.env, rename = renameSync } = {}) {
  if (protectedGate) throw new Error('A protected gate never writes the quarantine file.')
  // The light child of a phase gate pair leaves the shared file to the other step (GATE_LIGHT_CHILD=1).
  if (env.GATE_LIGHT_CHILD === '1') return
  mkdirSync(path.dirname(file), { recursive: true })
  const clean = { ...state }
  delete clean.note
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`)
  try {
    rename(tmp, file)
  } catch (e) {
    // Windows answers EPERM while another process has the target open for a moment: one retry.
    if (e?.code !== 'EPERM') throw e
    rename(tmp, file)
  }
}

/** `<ISO time>-<short head sha>` locally, `<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>` in CI. */
export function makeRunId({ env = process.env, now = Date.now(), head = '' } = {}) {
  if (env.GITHUB_RUN_ID) return `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT ?? '1'}`
  return `${iso(toMs(now))}-${String(head).slice(0, 7) || 'nohead'}`
}

/** Entries with a quarantine that is still active at `now`. */
export function activeQuarantine(state, now) {
  const t = toMs(now)
  return Object.entries(state.tests).filter(([, e]) => e.quarantine && Date.parse(e.quarantine.until) > t)
}

const noRemote = (env) => !env.GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')

/**
 * Picks the newest unexpired `gate-state` artifact, from `branch` when given. Only an artifact made by a run of this very
 * repository (`workflow_run.repository_id` and `head_repository_id` both equal `repoId`) is trusted: a fork can name its
 * branch anything and upload any file. Without a `repoId` nothing is picked.
 * @param {{ artifacts?: { id: number, expired: boolean, created_at: string, workflow_run?: { head_branch?: string, repository_id?: number, head_repository_id?: number } }[] }} listing
 * @param {string} [branch]
 * @param {number | string} [repoId]
 */
export function pickArtifact(listing, branch, repoId) {
  const id = Number(repoId)
  if (!Number.isInteger(id) || id <= 0) return null
  const list = (listing.artifacts ?? []).filter((a) => !a.expired && a.workflow_run?.repository_id === id && a.workflow_run?.head_repository_id === id && (!branch || a.workflow_run?.head_branch === branch))
  return list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null
}

/** Unzips a `gate-state` artifact into `outDir`; only the two known file names are written. */
export function extractArtifact(zip, outDir) {
  const files = unzipSync(new Uint8Array(zip))
  const written = []
  mkdirSync(outDir, { recursive: true })
  for (const name of ['flaky.json', 'ledger.jsonl']) {
    const data = files[name] ?? files[`.gate/${name}`]
    if (!data) continue
    writeFileSync(path.join(outDir, name), data)
    written.push(name)
  }
  return written
}

async function restore(argv, env, outDir, createApiImpl) {
  if (noRemote(env)) {
    console.log('No GitHub remote or token, so no saved gate state was restored.')
    return 0
  }
  const at = argv.indexOf('--branch')
  const branches = at === -1 ? [] : [argv[at + 1], env.GITHUB_BASE_REF].filter(Boolean)
  const repo = env.GITHUB_REPOSITORY
  try {
    const api = createApiImpl({ token: env.GH_TOKEN })
    const listing = await api.get(`/repos/${repo}/actions/artifacts?name=${ARTIFACT_NAME}&per_page=100`)
    const repoId = env.GITHUB_REPOSITORY_ID
    const found = branches.map((b) => pickArtifact(listing, b, repoId)).find(Boolean) ?? (argv.includes('--any-branch') ? pickArtifact(listing, undefined, repoId) : null)
    if (!found) {
      console.log('No saved gate state found, starting empty.')
      return 0
    }
    const zip = await api.getBinary(`/repos/${repo}/actions/artifacts/${found.id}/zip`)
    console.log(`Restored gate state from artifact ${found.id}: ${extractArtifact(zip, outDir).join(', ') || 'no files'}.`)
  } catch (err) {
    console.log(`Could not restore the saved gate state (${err instanceof GhError ? err.message : 'unexpected error'}), starting empty.`)
  }
  return 0
}

function save(outDir) {
  const file = path.join(outDir, 'flaky.json')
  if (!existsSync(file)) writeState(emptyState(), file)
  console.log(`Gate state ready to upload from ${path.relative(REPO_ROOT, outDir) || '.'}.`)
  return 0
}

export async function main(argv = process.argv.slice(2), env = process.env, { outDir = path.join(REPO_ROOT, '.gate'), createApiImpl = createApi } = {}) {
  if (argv[0] === 'restore') return restore(argv, env, outDir, createApiImpl)
  if (argv[0] === 'save') return save(outDir)
  console.error('Usage: gateState.js restore (--branch <ref> | --any-branch) | save')
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main()
}
