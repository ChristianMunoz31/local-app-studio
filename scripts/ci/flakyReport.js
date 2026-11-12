// Tally and report for the weekly flaky hunt (flaky.yml).
//   node scripts/ci/flakyReport.js tally   (env RUN_DIR, OUT_DIR, RUNS, FAILED_RUNS, PROJECT, RUNNER_OS_INPUT, GITHUB_SHA)
//     reads run-<n>.json (vitest json reporter), writes OUT_DIR/report.json and the step summary
//   node scripts/ci/flakyReport.js report  (env GH_TOKEN, GITHUB_REPOSITORY, REPORT_FILE, RUN_URL, FLAKY_RESULT)
//     creates or updates the open issue "Flaky tests on main" (labelled flaky, authored by github-actions[bot])
//   node scripts/ci/flakyReport.js quarantine-issues   (env GH_TOKEN, GITHUB_REPOSITORY; reads .gate/flaky.json)
//     opens one issue per test quarantined in the last 8 days (label quarantine) unless an open issue has that exact title;
//     with no token or no repository (any local run) it only prints the list and does nothing else
//   node scripts/ci/flakyReport.js list [--file <path>] [--json]   (read only; default file .gate/flaky.json)
//     the tests quarantined now, and the ones that were flaky or failed once and are not quarantined yet
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../checks/gitFiles.js'
import { BOT_LOGIN } from './prBot.js'
import { GhError, createApi } from './ghApi.js'
import { FAIL_RUNS_TO_RELEASE, FLAKY_RUNS_TO_QUARANTINE, STATE_FILE, readState } from './gateState.js'
import { escapeMd } from './markdown.js'

export const ISSUE_TITLE = 'Flaky tests on main'
export const ISSUE_LABEL = 'flaky'
export const QUARANTINE_LABEL = 'quarantine'
export const QUARANTINE_WINDOW_DAYS = 8
const TITLE_MAX = 200

/** Failing test lines (`<file> :: <full name>`) from one vitest JSON result. */
export function collectFailures(result, cwd = '') {
  const lines = []
  for (const file of result.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      if (t.status === 'failed') lines.push(`${String(file.name).replace(cwd, '').replace(/\\/g, '/')} :: ${t.fullName}`)
    }
  }
  return lines
}

/** Counts how many runs each test failed in, most frequent first. */
export function tally(lines) {
  const counts = new Map()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  return [...counts.entries()].map(([test, count]) => ({ test, count })).sort((a, b) => b.count - a.count || a.test.localeCompare(b.test))
}

export const isHardFailure = (report) => report.runs > 0 && report.failedRuns === report.runs

export function summaryMarkdown(report) {
  const lines = [`### Flaky hunt: ${report.failedRuns} of ${report.runs} runs failed (${escapeMd(report.project)}, ${escapeMd(report.os)})`, '']
  if (report.rows.length === 0) return [...lines, 'No failing tests recorded.'].join('\n')
  lines.push('| Failures | Test |', '| ---: | --- |')
  for (const r of report.rows) lines.push(`| ${r.count} | ${escapeMd(r.test, 200)} |`)
  return lines.join('\n')
}

/** Issue body: date, run link, verdict and the failure table. */
export function buildReportBody({ date, runUrl, report }) {
  const verdict = isHardFailure(report)
    ? `Failing on main, not flaky: all ${report.runs} runs failed.`
    : `${report.failedRuns} of ${report.runs} runs failed.`
  const lines = [`Last updated: ${date}`, `Run: ${runUrl}`, `Commit: \`${String(report.sha ?? '').slice(0, 7).replace(/[^0-9a-f]/g, '')}\``, '', `**${verdict}**`, '']
  if (report.rows.length === 0) lines.push('No failing tests were recorded (the run failed outside the tests).')
  else {
    lines.push('| Failures | Test |', '| ---: | --- |')
    for (const r of report.rows) lines.push(`| ${r.count} | ${escapeMd(r.test, 200)} |`)
  }
  return lines.join('\n')
}

export function buildComment({ date, runUrl, report }) {
  if (!report) return `${date}: the flaky run failed before it produced a report. ${runUrl}`
  if (report.failedRuns === 0) return `${date}: clean run, ${report.runs} of ${report.runs} passed. ${runUrl}`
  return `${date}: ${isHardFailure(report) ? 'failing on main, not flaky' : `${report.failedRuns} of ${report.runs} runs failed`}. ${runUrl}`
}

const ISSUE_PAGES = 10

export function findFlakyIssue(issues) {
  return issues.find((i) => !i.pull_request && i.user?.login === BOT_LOGIN && i.title === ISSUE_TITLE) ?? null
}

/** Entries quarantined within the last 8 days: `[{ key, entry }]`, newest first. */
export function newlyQuarantined(state, now = Date.now()) {
  const since = now - QUARANTINE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return Object.entries(state.tests ?? {})
    .filter(([, e]) => e.quarantine && Date.parse(e.quarantine.since) >= since)
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => b.entry.quarantine.since.localeCompare(a.entry.quarantine.since))
}

/** `Quarantined test: <file> :: <title>`, cut to 200 characters. */
export function quarantineIssueTitle(entry) {
  return `Quarantined test: ${entry.file} :: ${entry.title}`.slice(0, TITLE_MAX)
}

export function quarantineIssueBody(entry) {
  const q = entry.quarantine
  const history = (entry.history ?? []).map((h) => `- ${h.at}: ${h.outcome}`)
  return [
    `Quarantined since ${q.since} until ${q.until}.`,
    `Run: ${q.runId}`,
    `Reason: ${q.reason}`,
    '',
    'History (newest last):',
    ...(history.length > 0 ? history : ['- none']),
    '',
    'Fix the race at its root cause, then remove the entry from .gate/flaky.json or let it expire.',
  ].join('\n')
}

/**
 * Opens one issue per newly quarantined test, skipping a title that has an open issue or a closed one made for this quarantine
 * (all pages of the labelled issues are read, up to 1000).
 * @param {Record<string, string | undefined>} env
 * @param {{ api?: { get: Function, post: Function }, state?: object, now?: number, log?: (line: string) => void }} [seams]
 * @returns {Promise<number>}
 */
export async function runQuarantineIssues(env, { api, state = readState(), now = Date.now(), log = console.log } = {}) {
  const list = newlyQuarantined(state, now)
  if (!env.GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) {
    log(`No GitHub remote or token, so no issue was opened. Newly quarantined: ${list.length}.`)
    for (const { entry } of list) log(`- ${quarantineIssueTitle(entry)}`)
    return 0
  }
  const repo = env.GITHUB_REPOSITORY
  const client = api ?? createApi({ token: env.GH_TOKEN })
  const seen = new Map()
  for (let page = 1; page <= ISSUE_PAGES; page += 1) {
    const batch = await client.get(`/repos/${repo}/issues?state=all&labels=${QUARANTINE_LABEL}&per_page=100&page=${page}`)
    const rows = Array.isArray(batch) ? batch : []
    for (const i of rows.filter((x) => !x.pull_request)) {
      const prev = seen.get(i.title)
      seen.set(i.title, { open: Boolean(prev?.open) || i.state !== 'closed', createdAt: [prev?.createdAt, i.created_at].filter(Boolean).sort().at(-1) ?? null })
    }
    if (rows.length < 100) break
  }
  let created = 0
  for (const { entry } of list) {
    const title = quarantineIssueTitle(entry)
    const prior = seen.get(title)
    // An open issue is enough. A closed one counts only when it was opened for this quarantine, so a closed issue is not
    // reopened by the next run and an old one does not hide a new quarantine of the same test.
    if (prior && (prior.open || (prior.createdAt && Date.parse(prior.createdAt) >= Date.parse(entry.quarantine.since)))) continue
    await client.post(`/repos/${repo}/issues`, { title, body: quarantineIssueBody(entry), labels: [QUARANTINE_LABEL] })
    seen.set(title, { open: true, createdAt: null })
    created += 1
  }
  log(`Newly quarantined: ${list.length}. Issues opened: ${created}.`)
  return 0
}

const withKey = (key, entry) => ({ key, ...entry })

/**
 * The quarantine list: `active` has a quarantine that has not ended (oldest `since` first); `watch` has none and a flaky or
 * failing streak of at least 1 (newest run first).
 * @param {{ tests?: Record<string, object> }} state
 * @param {number} [now] ms timestamp
 */
export function listQuarantine(state, now = Date.now()) {
  const all = Object.entries(state.tests ?? {})
  const active = all
    .filter(([, e]) => e.quarantine && Date.parse(e.quarantine.until) > now)
    .map(([k, e]) => withKey(k, e))
    .sort((a, b) => a.quarantine.since.localeCompare(b.quarantine.since) || a.key.localeCompare(b.key))
  const watch = all
    .filter(([, e]) => !e.quarantine && (e.flakyStreak >= 1 || e.failStreak >= 1))
    .map(([k, e]) => withKey(k, e))
    .sort((a, b) => String(b.lastRunAt ?? '').localeCompare(String(a.lastRunAt ?? '')) || a.key.localeCompare(b.key))
  return { active, watch }
}

const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
const shown = (e) => (e.kind === 'e2e' && e.project ? `[${e.project}] ${e.title}` : e.title)

/**
 * The text of `list`. A `null` or missing state file is the "no file yet" line.
 * @param {{ active: object[], watch: object[] } | null} list
 * @param {{ file?: string, now?: number }} [o]
 */
export function renderList(list, { file = STATE_FILE, now = Date.now() } = {}) {
  if (!list) return `No ${file} yet: no gate run here has classified a test.`
  if (list.active.length === 0 && list.watch.length === 0) return `No quarantined tests in ${file}.`
  const out = []
  if (list.active.length === 0) out.push(`No quarantined tests in ${file}.`)
  else {
    out.push(`Quarantined tests in ${file} (${list.active.length}, read ${utc(now)}):`)
    for (const e of list.active) {
      out.push(`- ${e.kind} | ${e.file} | ${shown(e)} | since ${utc(Date.parse(e.quarantine.since))} | until ${utc(Date.parse(e.quarantine.until))} | failing runs in a row: ${e.failStreak} of ${FAIL_RUNS_TO_RELEASE}`)
    }
  }
  if (list.watch.length > 0) {
    out.push(`Flaky once, not quarantined yet (${list.watch.length}):`)
    for (const e of list.watch) {
      const last = e.lastRunAt ? `last ${utc(Date.parse(e.lastRunAt))}` : 'last unknown'
      const streak = e.flakyStreak >= 1 ? `flaky runs in a row: ${e.flakyStreak} of ${FLAKY_RUNS_TO_QUARANTINE}` : `failing runs in a row: ${e.failStreak} of ${FAIL_RUNS_TO_RELEASE}`
      out.push(`- ${e.kind} | ${e.file} | ${shown(e)} | ${last} | ${streak}`)
    }
  }
  return out.join('\n')
}

/** `list`: read only, exit 0; an unknown flag is exit 2. */
function runList(argv, { now = Date.now(), log = console.log } = {}) {
  const known = ['--file', '--json']
  const at = argv.indexOf('--file')
  const fileArg = at === -1 ? undefined : argv[at + 1]
  const bad = argv.find((a) => a.startsWith('--') && !known.includes(a))
  if (bad || (at !== -1 && (!fileArg || fileArg.startsWith('--')))) {
    console.error(bad ? `Unknown flag ${bad}. Usage: flakyReport.js list [--file <path>] [--json]` : '--file needs a path')
    return 2
  }
  const file = fileArg ? path.resolve(fileArg) : path.join(REPO_ROOT, STATE_FILE)
  const label = fileArg ?? STATE_FILE
  const list = existsSync(file) ? listQuarantine(readState(file, now), now) : null
  if (argv.includes('--json')) log(JSON.stringify({ file: label, at: new Date(now).toISOString(), active: list?.active ?? [], watch: list?.watch ?? [] }, null, 2))
  else log(renderList(list, { file: label, now }))
  return 0
}

function runTally(env) {
  const dir = env.RUN_DIR
  const lines = []
  for (const name of readdirSync(dir).filter((n) => /^run-\d+\.json$/.test(n))) {
    lines.push(...collectFailures(JSON.parse(readFileSync(path.join(dir, name), 'utf8')), process.cwd()))
  }
  const report = {
    runs: Number(env.RUNS),
    failedRuns: Number(env.FAILED_RUNS),
    project: env.PROJECT ?? 'all',
    os: env.RUNNER_OS_INPUT ?? 'ubuntu-latest',
    sha: env.GITHUB_SHA ?? '',
    rows: tally(lines),
  }
  mkdirSync(env.OUT_DIR, { recursive: true })
  writeFileSync(path.join(env.OUT_DIR, 'report.json'), JSON.stringify(report))
  const md = summaryMarkdown(report)
  console.log(md)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`)
  return 0
}

async function runReport(env) {
  const { GH_TOKEN, GITHUB_REPOSITORY: repo, REPORT_FILE, RUN_URL } = env
  const api = createApi({ token: GH_TOKEN })
  const report = REPORT_FILE && existsSync(REPORT_FILE) ? JSON.parse(readFileSync(REPORT_FILE, 'utf8')) : null
  const failed = report ? report.failedRuns > 0 : env.FLAKY_RESULT !== 'success'
  const date = new Date().toISOString().slice(0, 10)
  const issues = await api.get(`/repos/${repo}/issues?state=open&labels=${ISSUE_LABEL}&per_page=100`)
  const issue = findFlakyIssue(issues)
  if (!failed) {
    if (issue) await api.post(`/repos/${repo}/issues/${issue.number}/comments`, { body: buildComment({ date, runUrl: RUN_URL, report }) })
    return 0
  }
  const body = report ? buildReportBody({ date, runUrl: RUN_URL, report }) : `Last updated: ${date}\nRun: ${RUN_URL}\n\nThe flaky run failed before it produced a report.`
  let number = issue?.number
  if (issue) await api.patch(`/repos/${repo}/issues/${number}`, { body })
  else number = (await api.post(`/repos/${repo}/issues`, { title: ISSUE_TITLE, body, labels: [ISSUE_LABEL] })).number
  await api.post(`/repos/${repo}/issues/${number}/comments`, { body: buildComment({ date, runUrl: RUN_URL, report }) })
  return 0
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv[0] === 'tally') return runTally(env)
  if (argv[0] === 'report') {
    if (!env.GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') || !env.RUN_URL) {
      console.error('report needs GH_TOKEN, GITHUB_REPOSITORY and RUN_URL.')
      return 1
    }
    return runReport(env)
  }
  if (argv[0] === 'quarantine-issues') return runQuarantineIssues(env)
  if (argv[0] === 'list') return runList(argv.slice(1))
  console.error('Usage: flakyReport.js tally | report | quarantine-issues')
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main().catch((err) => {
    console.error(err instanceof GhError ? err.message : 'flakyReport failed unexpectedly.')
    return 1
  })
}
