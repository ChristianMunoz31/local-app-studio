// Structural validator for the nine workflow files (DESIGN-phase15 section 3.1). No YAML dependency: an indentation based
// reader for the subset these files use (top-level keys, `jobs.<id>.<key>`, `steps` lists, block scalars `|` and `>`).
// Runs in `npm run check` (check:workflows). Vendored actionlint is not available here (phase 11 could not fetch a pinned,
// checksummed binary) and is not fetched; this validator and the pins in ciPipeline.test.js are the check.
//   node scripts/ci/workflowCheck.js                         check every file in .github/workflows
//   node scripts/ci/workflowCheck.js --graph <workflow file> print the jobs in run order with their needs (and check that file)
// Rules: WF-1 top-level keys, no tabs or dashes, balanced expressions. WF-2 job ids, runs-on or uses, unique names, `verify`.
// WF-3 needs graph. WF-4 pinned `uses`. WF-5 scripts and npm scripts exist. WF-6 no secret in an `if`. WF-7 steps. WF-8 dry run
// jobs. WF-9 reusable workflows declare workflow_call.
// The public export swaps in a two file set whose first line is PUBLIC_MARKER; when ci.yml carries it and the private
// overlay folder (scripts/release/public-overlay) is absent, checkAll applies checkPublicWorkflow (the structural rules plus
// the public rules) instead of the nine file rules above. The marker in the private ci.yml is a problem, never a skip.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../checks/gitFiles.js'

export const WORKFLOW_DIR = '.github/workflows'
/** Workflows with a `graph_check` dry run (3.2). desktop-windows.yml is workflow_call only; pr-bot.yml runs with write tokens. */
export const DRY_RUN_FILES = ['ci.yml', 'flaky.yml', 'release.yml', 'release-please.yml', 'dev-build.yml', 'branch-cleanup.yml', 'desktop-check.yml']
export const NPX_BINS = ['vitest', 'playwright', 'vite', 'tauri', 'eslint', 'tsc']

const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`)
const JOB_ID = /^[a-z][a-z0-9-]*$/
const SHA40 = /^[0-9a-f]{40}$/
const indentOf = (line) => /^ */.exec(line)[0].length
const isBlank = (line) => line.trim() === ''
const isComment = (line) => /^\s*#/.test(line)
const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2')

/**
 * Reads `key: value` pairs at exactly `indent` out of `lines`. The value is the rest of the line plus every deeper line
 * (a block scalar keeps its lines, a plain value joins them with spaces). Comment lines are skipped.
 * @param {string[]} lines
 * @param {number} indent
 * @param {number} firstLine 1 based line number of lines[0]
 * @returns {Map<string, { value: string, line: number, cont: string[], block: boolean }>}
 */
export function readFields(lines, indent, firstLine = 1) {
  const fields = new Map()
  const re = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):[ \\t]*(.*)$`)
  let current = null
  lines.forEach((line, i) => {
    if (isComment(line) || isBlank(line)) {
      if (current && isBlank(line)) current.cont.push(line)
      return
    }
    const m = indentOf(line) === indent ? re.exec(line) : null
    if (m) {
      current = { value: m[2].trim(), line: firstLine + i, cont: [], block: /^[|>][+-]?\d*\s*(#.*)?$/.test(m[2].trim()) }
      fields.set(m[1], current)
    } else if (current && indentOf(line) > indent) current.cont.push(line)
    else current = null
  })
  for (const f of fields.values()) {
    while (f.cont.length > 0 && isBlank(f.cont.at(-1))) f.cont.pop()
    f.text = f.block ? f.cont.map((l) => l.trim()).join('\n') : [f.value, ...f.cont.map((l) => l.trim())].join(' ').trim()
  }
  return fields
}

/** Splits a workflow into its triggers and jobs. Pure. */
export function parseWorkflow(text) {
  const lines = text.split(/\r?\n/)
  const top = new Map()
  lines.forEach((line, i) => {
    const m = /^([A-Za-z_][\w-]*|"on"):[ \t]*(.*)$/.exec(line)
    if (m) top.set(m[1].replaceAll('"', ''), { value: m[2].trim(), line: i + 1 })
  })
  const sectionOf = (key) => {
    const start = top.get(key)
    if (!start) return { lines: [], first: 0 }
    const out = []
    for (let i = start.line; i < lines.length; i += 1) {
      if (/^\S/.test(lines[i]) && !isComment(lines[i])) break
      out.push(lines[i])
    }
    return { lines: out, first: start.line + 1 }
  }

  const on = sectionOf('on')
  const triggers = new Set()
  if (top.get('on')?.value) for (const t of top.get('on').value.matchAll(/[a-z_]+/g)) triggers.add(t[0])
  for (const l of on.lines) {
    const m = /^ {2}([a-z_]+):/.exec(l) ?? /^ {2}- ([a-z_]+)/.exec(l)
    if (m) triggers.add(m[1])
  }
  const onText = on.lines.join('\n')

  const jobsSection = sectionOf('jobs')
  const jobs = []
  let cur = null
  jobsSection.lines.forEach((line, i) => {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line)
    if (m) {
      cur = { id: m[1], line: jobsSection.first + i, lines: [], first: jobsSection.first + i + 1 }
      jobs.push(cur)
    } else if (cur) cur.lines.push(line)
  })
  for (const job of jobs) {
    job.fields = readFields(job.lines, 4, job.first)
    const g = (k) => job.fields.get(k)
    job.name = g('name') ? unquote(g('name').text) : null
    job.uses = g('uses') ? g('uses').text : null
    job.runsOn = g('runs-on') ? g('runs-on').text : null
    job.ifText = g('if') ? g('if').text : null
    job.needs = g('needs') ? [...g('needs').text.matchAll(/[A-Za-z0-9_-]+/g)].map((x) => x[0]).filter((x) => !/^-+$/.test(x)) : []
    job.steps = []
    const steps = g('steps')
    if (steps) {
      const items = []
      steps.cont.forEach((l, i) => {
        if (/^ {6}- ?/.test(l)) items.push({ line: steps.line + 1 + i, lines: [l.replace(/^ {6}- ?/, '        ')] })
        else if (items.length > 0) items.at(-1).lines.push(l)
      })
      for (const item of items) {
        const fields = readFields(item.lines, 8, item.line)
        const f = (k) => fields.get(k)?.text ?? null
        job.steps.push({ line: item.line, id: f('id'), name: f('name') ? unquote(f('name')) : null, run: f('run'), uses: f('uses'), ifText: f('if'), text: item.lines.join('\n'), fields })
      }
    }
    job.text = job.lines.join('\n')
  }
  return { lines, top, triggers, onText, jobs }
}

const problem = (line, message) => ({ line, message })

/** Jobs in run order (needs first), declaration order otherwise; cycle members are left out. */
export function topoOrder(jobs) {
  const ids = new Set(jobs.map((j) => j.id))
  const done = new Set()
  const order = []
  let progress = true
  while (progress && order.length < jobs.length) {
    progress = false
    for (const job of jobs) {
      if (done.has(job.id)) continue
      if (job.needs.filter((n) => ids.has(n)).every((n) => done.has(n))) {
        done.add(job.id)
        order.push(job)
        progress = true
      }
    }
  }
  return order
}

/**
 * Checks one workflow file.
 * @param {string} text
 * @param {{ file?: string, exists?: (relative: string) => boolean, readWorkflow?: (name: string) => string | null, scripts?: string[] }} [ctx]
 * @returns {{ line: number, message: string }[]}
 */
export function checkWorkflow(text, { file = '', exists = () => true, readWorkflow = () => null, scripts = null } = {}) {
  const out = []
  const wf = parseWorkflow(text)
  // WF-1
  if (!/^name: \S/m.test(text)) out.push(problem(1, 'no top-level name'))
  for (const key of ['on', 'permissions', 'jobs']) if (!wf.top.has(key)) out.push(problem(1, `no top-level ${key}`))
  wf.lines.forEach((line, i) => {
    if (line.includes('\t')) out.push(problem(i + 1, 'tab'))
    if (DASHES.test(line)) out.push(problem(i + 1, 'em or en dash'))
    if ((line.match(/\$\{\{/g) ?? []).length !== (line.match(/\}\}/g) ?? []).length) out.push(problem(i + 1, 'unbalanced expression'))
  })
  // WF-2 and WF-3
  const seen = new Set()
  const names = new Map()
  const ids = new Set(wf.jobs.map((j) => j.id))
  for (const job of wf.jobs) {
    if (!JOB_ID.test(job.id)) out.push(problem(job.line, `job ${job.id}: the id must be lowercase letters, digits and hyphens`))
    if (seen.has(job.id)) out.push(problem(job.line, `duplicate job ${job.id}`))
    seen.add(job.id)
    if (!job.runsOn && !job.uses) out.push(problem(job.line, `job ${job.id}: no runs-on or uses`))
    if (job.name) {
      if (names.has(job.name)) out.push(problem(job.line, `job ${job.id}: the name "${job.name}" is also used by job ${names.get(job.name)}`))
      names.set(job.name, job.id)
    }
    for (const n of job.needs) {
      if (n === job.id) out.push(problem(job.line, `job ${job.id}: needs itself`))
      else if (!ids.has(n)) out.push(problem(job.line, `job ${job.id}: needs "${n}" which does not exist`))
    }
  }
  if (file === 'ci.yml' && !wf.jobs.some((j) => j.id === 'verify' && j.name === 'verify')) out.push(problem(1, 'the job verify must keep the id and the name verify (the PR bot and branch protection read it)'))
  const ordered = topoOrder(wf.jobs)
  for (const job of wf.jobs) if (!ordered.includes(job) && job.needs.every((n) => ids.has(n))) out.push(problem(job.line, `job ${job.id}: is part of a needs cycle`))

  for (const job of wf.jobs) {
    // WF-4 on the job and its steps
    const usesList = [{ line: job.fields.get('uses')?.line ?? job.line, value: job.uses, where: `job ${job.id}`, job: true }, ...job.steps.map((s) => ({ line: s.line, value: s.uses, where: `job ${job.id}`, job: false }))]
    for (const u of usesList) {
      if (!u.value) continue
      const m = /^(\S+)(?:\s+#\s*(.*))?$/.exec(u.value.trim())
      const ref = m?.[1] ?? ''
      const comment = m?.[2] ?? ''
      if (ref.startsWith('./')) {
        if (/^\.\/\.github\/workflows\/[\w.-]+\.yml$/.test(ref)) {
          const name = path.posix.basename(ref)
          if (!exists(ref.slice(2))) out.push(problem(u.line, `${u.where}: uses ${ref} but that file does not exist`))
          else {
            // WF-9
            const called = readWorkflow(name)
            if (called !== null && !parseWorkflow(called).triggers.has('workflow_call')) out.push(problem(u.line, `${u.where}: ${name} is called but does not declare on: workflow_call`))
          }
        } else if (!exists(`${ref.slice(2)}/action.yml`) && !exists(`${ref.slice(2)}/action.yaml`)) out.push(problem(u.line, `${u.where}: uses ${ref} but there is no action.yml there`))
      } else if (ref.startsWith('docker://')) {
        if (!/@sha256:[0-9a-f]{64}$/.test(ref)) out.push(problem(u.line, `${u.where}: ${ref} is not pinned by sha256`))
      } else {
        const [name, sha] = ref.split('@')
        if (!/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?$/.test(name ?? '') || !SHA40.test(sha ?? '')) out.push(problem(u.line, `${u.where}: uses ${ref} must be pinned to a 40 character commit`))
        else if (!/^v\d/.test(comment)) out.push(problem(u.line, `${u.where}: uses ${ref} needs a "# v<version>" comment after the sha`))
      }
    }
    // WF-6
    for (const [text2, line] of [[job.ifText, job.fields.get('if')?.line ?? job.line], ...job.steps.map((s) => [s.ifText, s.line])]) {
      if (text2 && /\bsecrets\./.test(text2)) out.push(problem(line, `job ${job.id}: a secret is used inside an if (the value is not available there)`))
    }
    // WF-7
    const stepIds = []
    for (const step of job.steps) {
      if (!step.run && !step.uses) out.push(problem(step.line, `job ${job.id}: a step has neither run nor uses: ${step.text.trim().split('\n')[0].trim()}`))
      if (step.id) stepIds.push(step.id)
      // WF-5
      if (step.run) {
        for (const message of runProblems(step.run, exists, scripts)) out.push(problem(step.line, `job ${job.id}: ${message}`))
      }
    }
    if (new Set(stepIds).size !== stepIds.length) out.push(problem(job.line, `job ${job.id}: duplicate step id`))
    for (const m of job.text.matchAll(/\bsteps\.([A-Za-z0-9_-]+)\./g)) {
      if (!stepIds.includes(m[1])) out.push(problem(job.line, `job ${job.id}: refers to steps.${m[1]} which is not a step id in this job`))
    }
    if (job.steps.length === 0 && !job.uses && job.runsOn) out.push(problem(job.line, `job ${job.id}: no steps`))
  }
  // WF-8
  if (DRY_RUN_FILES.includes(file)) out.push(...dryRunProblems(wf, file))
  return out.sort((a, b) => a.line - b.line)
}

/** WF-5 for one `run:` text. */
export function runProblems(run, exists, scripts) {
  const out = []
  const cleaned = run.split('\n').filter((l) => !isComment(l))
  for (const raw of cleaned) {
    const line = raw.trim()
    for (const m of line.matchAll(/(?:^|[\s;&|(])node\s+((?:-{1,2}[\w-]+(?:=\S+)?\s+)*)([^\s"'$;&|<>()`{}]+)/g)) {
      if (/\.(?:js|mjs|cjs)$/.test(m[2]) && !exists(m[2].replace(/^\.\//, ''))) out.push(`run calls node ${m[2]} but that file does not exist`)
    }
    for (const m of line.matchAll(/(?:^|[\s;&|(])(?:bash|sh)\s+(?:-\w+\s+)*([\w./-]+\.sh)\b/g)) {
      if (!exists(m[1].replace(/^\.\//, ''))) out.push(`run calls ${m[1]} but that file does not exist`)
    }
    for (const m of line.matchAll(/(?:^|&&|\|\||;|\|)\s*\.\/([\w./-]+)/g)) {
      if (!exists(m[1])) out.push(`run calls ./${m[1]} but that file does not exist`)
    }
    if (scripts) {
      for (const m of line.matchAll(/\bnpm run ([\w:.-]+)/g)) if (!scripts.includes(m[1])) out.push(`run calls npm run ${m[1]} but package.json has no such script`)
    }
    for (const m of line.matchAll(/(?:^|[\s;&|(])npx\s+(?:--?[\w-]+(?:=\S+)?\s+)*([\w@/.-]+)/g)) {
      if (!NPX_BINS.includes(m[1])) out.push(`run calls npx ${m[1]}, which is not one of ${NPX_BINS.join(', ')}`)
    }
  }
  return out
}

/** WF-8: the `graph_check` input and job of a dispatchable workflow, and the guard on every other job. */
function dryRunProblems(wf, file) {
  const out = []
  if (!wf.triggers.has('workflow_dispatch')) return [problem(1, 'WF-8: the workflow has no workflow_dispatch trigger for its graph check')]
  if (!/graph_check:\s*\n(?:[ \t]+.*\n)*?[ \t]+type: boolean/.test(`${wf.onText}\n`)) out.push(problem(1, 'WF-8: workflow_dispatch needs a boolean input graph_check'))
  const check = wf.jobs.find((j) => j.id === 'graph-check')
  if (!check) out.push(problem(1, 'WF-8: the job graph-check is missing'))
  else {
    if (!check.ifText || !/inputs\.graph_check/.test(check.ifText) || /!\s*inputs\.graph_check/.test(check.ifText)) out.push(problem(check.line, 'WF-8: graph-check must run only when inputs.graph_check is true'))
    if (!check.steps.some((s) => s.run?.includes(`node scripts/ci/workflowCheck.js --graph ${WORKFLOW_DIR}/${file}`))) out.push(problem(check.line, `WF-8: graph-check must run node scripts/ci/workflowCheck.js --graph ${WORKFLOW_DIR}/${file}`))
  }
  for (const job of wf.jobs) {
    if (job.id === 'graph-check') continue
    if (!job.ifText || !/!\s*inputs\.graph_check/.test(job.ifText)) out.push(problem(job.line, `WF-8: job ${job.id} must have !inputs.graph_check in its if`))
  }
  return out
}

const makeContext = (root, file) => ({
  file,
  exists: (rel) => existsSync(path.join(root, rel)),
  readWorkflow: (name) => (existsSync(path.join(root, WORKFLOW_DIR, name)) ? readFileSync(path.join(root, WORKFLOW_DIR, name), 'utf8') : null),
  scripts: (() => {
    try {
      return Object.keys(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {})
    } catch {
      return null
    }
  })(),
})

/** The first line of every workflow of the public set (the export swaps these in for the private nine). */
export const PUBLIC_MARKER = '# las-workflow-set: public'
/** The workflows the public set may hold. */
export const PUBLIC_FILES = ['ci.yml', 'desktop-check.yml']
/** Names that belong to the private pipeline and must not appear in a public workflow. */
// The private repository name is built from fragments so the public export does not contain it as a literal.
const PRIVATE_REPO = ['local', 'app', 'studio', 'pro'].join('-')
const PRIVATE_NAMES = new RegExp(`${PRIVATE_REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|[\\w.-]+-releases\\b|RELEASES_TOKEN|PERSONAL_DENYLIST`)
/** A job that runs any of these is heavy: it may only run on a manual dispatch. */
const HEAVY = /playwright|runE2e\.js|\bcargo\b|\btauri\b|desktop:build|desktop:sidecar|buildSidecar\.js/i
const FORBIDDEN_TRIGGERS = ['pull_request_target', 'workflow_run', 'schedule', 'workflow_call']

/** The folder that exists only in the private repo (the public export excludes it). */
export const OVERLAY_DIR = 'scripts/release/public-overlay'
export const MARKER_IN_PRIVATE_MESSAGE = 'the public workflow marker is in the private ci.yml'

/** True when the first non blank line of ci.yml under `root` is the public marker. */
function hasPublicMarker(root) {
  const file = path.join(root, WORKFLOW_DIR, 'ci.yml')
  if (!existsSync(file)) return false
  const first = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.trim() !== '')
  return first?.trim() === PUBLIC_MARKER
}

/** `public` only when ci.yml carries the public marker and the private-only overlay folder is absent, else `private`. */
export function detectWorkflowSet(root = REPO_ROOT) {
  return hasPublicMarker(root) && !existsSync(path.join(root, OVERLAY_DIR)) ? 'public' : 'private'
}

/**
 * The rules of one workflow of the public set, on top of the structural ones (checkWorkflow): the marker, pinned actions,
 * least permissions, concurrency, no secret, no pro path, no private name, node 24, and heavy jobs on manual dispatch only.
 * @param {string} text
 * @param {{ file?: string, exists?: (relative: string) => boolean, scripts?: string[] | null }} [ctx]
 * @returns {{ line: number, message: string }[]}
 */
export function checkPublicWorkflow(text, { file = '', exists = () => true, scripts = null } = {}) {
  const out = checkWorkflow(text, { file: '', exists, scripts })
  const wf = parseWorkflow(text)
  const lines = text.split(/\r?\n/)
  const lineOf = (re) => Math.max(1, lines.findIndex((l) => re.test(l)) + 1)
  if (lines.find((l) => l.trim() !== '')?.trim() !== PUBLIC_MARKER) out.push(problem(1, `the first line must be ${PUBLIC_MARKER}`))
  // permissions: the top level grants contents: read and nothing more; no job widens it.
  const topPerms = wf.top.get('permissions')
  if (!topPerms || topPerms.value !== '') out.push(problem(topPerms?.line ?? 1, 'permissions must be a block with contents: read'))
  else {
    const section = []
    for (let i = topPerms.line; i < lines.length; i += 1) {
      if (/^\S/.test(lines[i]) && !isComment(lines[i])) break
      section.push(lines[i])
    }
    const perms = readFields(section, 2, topPerms.line + 1)
    if (perms.size !== 1 || perms.get('contents')?.text !== 'read') out.push(problem(topPerms.line, 'the top level permissions must be exactly contents: read'))
  }
  for (const job of wf.jobs) if (job.fields.has('permissions')) out.push(problem(job.fields.get('permissions').line, `job ${job.id}: a job must not set its own permissions (the top level contents: read is all a public job needs)`))
  lines.forEach((l, i) => {
    if (/^\s+[a-z-]+:\s*write\s*$/.test(l)) out.push(problem(i + 1, 'a write permission'))
  })
  // concurrency per ref, cancelling older runs
  const conc = wf.top.get('concurrency')
  const concBlock = conc ? lines.slice(conc.line, conc.line + 4).join('\n') : ''
  if (!conc || !/group:.*\$\{\{[^}]*github\.ref\b[^}]*\}\}/.test(concBlock) || !/cancel-in-progress:\s*true\b/.test(concBlock)) out.push(problem(conc?.line ?? 1, 'concurrency needs a group per github.ref and cancel-in-progress: true'))
  // no secret but the token, no pro path, no private name
  lines.forEach((l, i) => {
    if (/^\s*#/.test(l)) return
    for (const m of l.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)) if (m[1] !== 'GITHUB_TOKEN') out.push(problem(i + 1, `secrets.${m[1]} is not available in a public workflow`))
    if (/(^|[^\w])pro\//.test(l)) out.push(problem(i + 1, 'a pro/ path in a public workflow'))
    if (PRIVATE_NAMES.test(l)) out.push(problem(i + 1, 'a private repository, token or secret name in a public workflow'))
  })
  for (const t of FORBIDDEN_TRIGGERS) if (wf.triggers.has(t)) out.push(problem(lineOf(new RegExp(`^\\s+${t}:`)), `the trigger ${t} is not allowed in a public workflow`))
  // node 24 everywhere
  lines.forEach((l, i) => {
    const m = /node-version:\s*['"]?([^'"\s#]+)/.exec(l)
    if (m && m[1] !== '24') out.push(problem(i + 1, `node-version must be 24 (got ${m[1]})`))
  })
  // heavy jobs run on a manual dispatch only
  for (const job of wf.jobs) {
    const code = job.lines.filter((l) => !isComment(l)).join('\n')
    if (HEAVY.test(code) &&!(job.ifText && /github\.event_name\s*==\s*'workflow_dispatch'/.test(job.ifText))) out.push(problem(job.line, `job ${job.id}: a heavy job needs if: github.event_name == 'workflow_dispatch'`))
  }
  // per file
  if (file === 'ci.yml') {
    for (const t of ['pull_request', 'push', 'workflow_dispatch']) if (!wf.triggers.has(t)) out.push(problem(1, `ci.yml must run on ${t}`))
    if (!wf.jobs.some((j) => j.id === 'verify' && j.name === 'verify')) out.push(problem(1, 'the job verify must keep the id and the name verify'))
  }
  if (file === 'desktop-check.yml' && [...wf.triggers].join() !== 'workflow_dispatch') out.push(problem(1, 'desktop-check.yml must run on workflow_dispatch only'))
  return out.sort((a, b) => a.line - b.line)
}

/** Every workflow file under `root`: `{ file, problems }[]`. The public set (marker in ci.yml) gets the public rules. */
export function checkAll(root = REPO_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR)
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml')).sort()
  if (detectWorkflowSet(root) === 'public') {
    return files.map((file) => {
      const problems = PUBLIC_FILES.includes(file) ? checkPublicWorkflow(readFileSync(path.join(dir, file), 'utf8'), { ...makeContext(root, file) }) : [problem(1, `${file} is not part of the public workflow set (${PUBLIC_FILES.join(', ')})`)]
      return { file, problems }
    })
  }
  const stray = hasPublicMarker(root)
  return files.map((file) => {
    const problems = checkWorkflow(readFileSync(path.join(dir, file), 'utf8'), makeContext(root, file))
    if (stray && file === 'ci.yml') problems.unshift(problem(1, MARKER_IN_PRIVATE_MESSAGE))
    return { file, problems }
  })
}

/** The jobs of a workflow in run order, one line each, called workflows indented below their job. */
export function graphLines(file, root = REPO_ROOT, indent = '') {
  const text = readFileSync(path.join(root, file), 'utf8')
  const wf = parseWorkflow(text)
  const out = [`${indent}${path.posix.basename(file)}`]
  for (const job of topoOrder(wf.jobs)) {
    out.push(`${indent}  ${job.id}${job.needs.length > 0 ? ` (needs: ${job.needs.join(', ')})` : ''}${job.uses ? ` -> ${job.uses}` : ''}`)
    const called = job.uses && /^\.\/\.github\/workflows\/[\w.-]+\.yml$/.test(job.uses) ? job.uses.slice(2) : null
    if (called && existsSync(path.join(root, called))) out.push(...graphLines(called, root, `${indent}    `))
  }
  return out
}

export function main(argv = process.argv.slice(2), root = REPO_ROOT) {
  const at = argv.indexOf('--graph')
  if (at !== -1) {
    const file = argv[at + 1]
    if (!file || !/^\.github\/workflows\/[\w.-]+\.yml$/.test(file) || !existsSync(path.join(root, file))) {
      console.error('--graph needs a workflow file such as .github/workflows/ci.yml')
      return 2
    }
    const problems = checkWorkflow(readFileSync(path.join(root, file), 'utf8'), makeContext(root, path.posix.basename(file)))
    console.log(graphLines(file, root).join('\n'))
    for (const p of problems) console.error(`${path.posix.basename(file)}:${p.line} ${p.message}`)
    return problems.length > 0 ? 1 : 0
  }
  const results = checkAll(root)
  const lines = results.flatMap((r) => r.problems.map((p) => `${r.file}:${p.line} ${p.message}`))
  for (const l of lines) console.error(l)
  console.log(`workflowCheck: ${results.length} workflows, ${lines.length} problems`)
  return lines.length > 0 ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main()
}
