// Static architecture guard (fs + regex over the source tree, no server started): server/ai/ is
// the only AI module boundary. Outside code imports server/ai/index.js only, speaks no provider
// wire protocol, names no hosted vendor, and every AI route goes through the shared gate.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanModelCalls } from './helpers/modelCallScan.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const CODE = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/;
const isTest = (p) => /(?:^|\/)__tests__\//.test(p) || /\.test\.[jt]sx?$/.test(p);
const read = (abs) => fs.readFileSync(abs, 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// pro/server, pro/src and pro/scripts hold the real cloud provider, the helper and the installer (docs/ARCHITECTURE.md, 'The pro
// seam'); every rule below covers them with the same rules as open code. walk() skips a folder that is not there.
const serverFiles = [...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'packages', 'runtime', 'server')), ...walk(path.join(ROOT, 'pro', 'server'))].filter((f) => CODE.test(f) && !isTest(rel(f)));
const rootServer = path.join(ROOT, 'server.js');
const backendFiles = [...serverFiles, rootServer].filter((f) => fs.existsSync(f));
const srcFiles = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'packages', 'runtime', 'src')), ...walk(path.join(ROOT, 'pro', 'src'))].filter((f) => /\.(?:js|jsx|ts|tsx)$/.test(f) && !isTest(rel(f)));
const sqlFiles = [...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'packages', 'runtime'))].filter((f) => f.endsWith('.sql'));
const scriptFiles = [...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'pro', 'scripts'))].filter((f) => CODE.test(f) && !isTest(rel(f)));
const insideAi = (relPath) => relPath.startsWith('server/ai/') || relPath.startsWith('pro/server/ai/');
// Files the import-boundary rules scan: the open backend and the pro server. The twin path is allowed only under pro/server/ai/.
const boundaryFiles = backendFiles;

/** Every static/dynamic import specifier and require() in a file. */
function specifiers(source) {
  const out = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  for (const m of source.matchAll(re)) out.push(m[2]);
  return out;
}

const resolvedImports = (abs) =>
  specifiers(read(abs))
    .filter((s) => s.startsWith('.'))
    .map((s) => ({ spec: s, target: rel(path.resolve(path.dirname(abs), s)) }));

const AI_INDEX = /^server\/ai\/index(?:\.js)?$/;

describe('AI module boundary', () => {
  it('scans a non-trivial file set (the guard is not vacuous)', () => {
    expect(backendFiles.length).toBeGreaterThan(20);
    expect(srcFiles.length).toBeGreaterThan(20);
    expect(backendFiles.map(rel)).toContain('server.js');
    expect(fs.existsSync(path.join(ROOT, 'server/ai/index.js'))).toBe(true);
  });

  it('nothing outside server/ai/ imports providers/*, llmClient or llmErrors', () => {
    const offenders = [];
    for (const abs of boundaryFiles) {
      if (insideAi(rel(abs))) continue;
      for (const { spec, target } of resolvedImports(abs)) {
        if (/^(?:pro\/)?server\/ai\/providers(?:\/|$)/.test(target) || /(?:^|\/)llm(?:Client|Errors)(?:\.js)?$/.test(target) || /(?:^|\/)llm(?:Client|Errors)(?:\.js)?$/.test(spec)) {
          offenders.push(`${rel(abs)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('outside code imports only server/ai/index.js from the AI module', () => {
    const offenders = [];
    for (const abs of boundaryFiles) {
      if (insideAi(rel(abs))) continue;
      for (const { spec, target } of resolvedImports(abs)) {
        if (/^(?:pro\/)?server\/ai(?:\/|$)/.test(target) && !AI_INDEX.test(target)) offenders.push(`${rel(abs)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the frontend never reaches into server/', () => {
    const offenders = [];
    for (const abs of srcFiles) {
      for (const { spec, target } of resolvedImports(abs)) if (/^server\//.test(target)) offenders.push(`${rel(abs)} -> ${spec}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the provider modules are imported from inside server/ai only (and are imported at all)', () => {
    const importers = [];
    for (const abs of boundaryFiles) {
      for (const { target } of resolvedImports(abs)) if (/^(?:pro\/)?server\/ai\/providers\//.test(target)) importers.push(rel(abs));
    }
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) expect(insideAi(f), f).toBe(true);
  });
});

describe('wire protocol stays inside the providers', () => {
  it("'/api/chat' and 'chat/completions' appear only in server/ai/providers/", () => {
    const hits = [];
    const scripts = [...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'pro', 'scripts'))].filter((f) => CODE.test(f));
    for (const abs of [...boundaryFiles, ...srcFiles, ...scripts]) {
      const r = rel(abs);
      if (r.startsWith('server/ai/providers/') || r.startsWith('pro/server/ai/providers/')) continue;
      // The bundled fake Ollama (sandbox, previews, Playwright) is a wire-protocol stub by design.
      if (r === 'scripts/lib/fakeOllamaServer.js') continue;
      if (/\/api\/chat\b|chat\/completions/.test(read(abs))) hits.push(r);
    }
    expect(hits).toEqual([]);
  });

  it('the providers do own their endpoints', () => {
    expect(read(path.join(ROOT, 'server/ai/providers/ollama.js'))).toContain('/api/chat');
  });

  it.skipIf(PUBLIC_BUILD)('the cloud provider owns its endpoint (the provider is pro, which is not in a public build)', () => {
    expect(read(path.join(ROOT, 'pro/server/ai/providers/openaiCompat.js'))).toContain('chat/completions');
  });
});

describe('no hosted vendor names in product code', () => {
  // Explicit and minimal: credential-shape redaction must still recognize vendor key prefixes.
  const REDACTION = ['src/utils/assistantRedact.js', 'server/assistant/validateAdvice.js', 'server/redact.js'];
  const ALLOW = new Set(REDACTION);
  const VENDOR = /\b(bedrock|groq|anthropic)\b/i;

  it('matches nothing in server/, server.js or src/ outside the allowlist', () => {
    const hits = [];
    for (const abs of [...backendFiles, ...srcFiles, ...sqlFiles]) {
      const r = rel(abs);
      if (ALLOW.has(r) || isTest(r)) continue;
      read(abs)
        .split('\n')
        .forEach((line, i) => {
          if (VENDOR.test(line)) hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('the redaction files name vendors only as credential prefixes', () => {
    for (const r of REDACTION) {
      const lines = read(path.join(ROOT, r)).split('\n').filter((l) => VENDOR.test(l));
      expect(lines.length, r).toBeGreaterThan(0);
      for (const line of lines) expect(line, r).toMatch(/bedrock-api-key-|gsk_|ABSK/);
    }
  });

});

describe('retired modules are gone', () => {
  it.each(['server/agents/providers', 'server/aiGate.js', 'server/agents/llmClient.js', 'server/agents/llmErrors.js', 'server/assistantRoutes.js'])('%s does not exist', (p) => {
    expect(fs.existsSync(path.join(ROOT, p))).toBe(false);
  });
});

describe('every AI route goes through the shared gate', () => {
  const GATE = /\b(?:requireAi|getAiClient|isAiEnabled|describeAi)\b/;
  it.each([
    'server.js',
    'server/assistantAdvisorRoutes.js',
    'server/assistant/advisorService.js',
    'server/agents/assistantAgent.js',
  ])('%s references the server/ai index API', (file) => {
    const abs = path.join(ROOT, file);
    expect(GATE.test(read(abs)), file).toBe(true);
    expect(resolvedImports(abs).some((i) => AI_INDEX.test(i.target)), file).toBe(true);
  });

  it('server.js guards each AI POST route with requireAi before the handler', () => {
    const src = read(rootServer);
    for (const route of ['/api/assistant', '/api/assistant/actions/:token']) {
      const m = src.match(new RegExp(`app\\.post\\('${escapeRe(route)}'[^\\n]*`));
      expect(m, route).not.toBeNull();
      expect(m[0], route).toMatch(/requireAi\(/);
    }
  });

  it('the advice route file uses requireAi or getAiClient', () => {
    for (const file of ['server/assistantAdvisorRoutes.js']) {
      expect(read(path.join(ROOT, file)), file).toMatch(/requireAi\(|getAiClient\(/);
    }
  });

});

describe('cloud AI: every consumer is accounted for', () => {
  // Files outside server/ai/ that resolve a model client. A new one fails here until it is added
  // with the cloud test that covers it (and passes a scope on every model call).
  const CONSUMERS = {
    'server.js': ['server/__tests__/cloudAssistant.test.js'],
    'server/agents/assistantAgent.js': ['server/__tests__/cloudAssistant.test.js'],
    'server/assistant/advisorService.js': ['server/__tests__/cloudAdvice.test.js'],
    'server/assistantAdvisorRoutes.js': ['server/__tests__/cloudAdvice.test.js'],
    'server/studio/describeRoute.js': ['server/__tests__/studio/routesDescribe.test.js'],
  };
  const RESOLVES_CLIENT = /\b(?:getAiClient|requireAi)\s*\(/;
  const consumers = backendFiles.filter((f) => !insideAi(rel(f)) && RESOLVES_CLIENT.test(read(f))).map(rel).sort();

  it('the set of files that resolve a model client equals the allowlist', () => {
    expect(consumers).toEqual(Object.keys(CONSUMERS).sort());
  });

  it('each consumer is covered by cloud tests that exist and configure a cloud provider', () => {
    for (const [file, tests] of Object.entries(CONSUMERS)) {
      expect(tests.length, file).toBeGreaterThan(0);
      for (const t of tests) {
        const abs = path.join(ROOT, t);
        expect(fs.existsSync(abs), `${file} -> ${t}`).toBe(true);
        expect(read(abs), t).toMatch(/configureCloud\(/);
      }
    }
  });

  it('every model call outside server/ai/ passes an object literal with a real scope', () => {
    let calls = 0;
    const offenders = [];
    for (const abs of [...backendFiles, ...scriptFiles]) {
      if (insideAi(rel(abs))) continue;
      const scan = scanModelCalls(read(abs));
      calls += scan.calls;
      for (const problem of scan.problems) offenders.push(`${rel(abs)}: ${problem}`);
    }
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });

  it('the scope check sits before the queue and the transport in createAiClient events()', () => {
    const src = read(path.join(ROOT, 'server/ai/registry.js'));
    const events = src.slice(src.indexOf('async function* events('));
    const enforce = events.indexOf('enforceCloudScope(');
    expect(enforce).toBeGreaterThan(-1);
    expect(enforce).toBeLessThan(events.indexOf('getQueue().acquire'));
    expect(enforce).toBeLessThan(events.indexOf('transport({'));
  });

  it.skipIf(PUBLIC_BUILD)('the cloud transport uses the guarded https agent (the transport is pro, which is not in a public build)', () => {
    const client = read(path.join(ROOT, 'pro/server/ai/llmClient.js'));
    expect(client).toMatch(/from '(?:\.\.\/)+server\/ai\/cloudGuard\.js'/);
    expect(client).toMatch(/agent:\s*cloudHttpsAgent\(\)/);
    expect(client).toMatch(/redirect:\s*'error'/);
    const guard = read(path.join(ROOT, 'server/ai/cloudGuard.js'));
    expect(guard).toMatch(/lookup:\s*guardedLookup/);
  });

  it('the cloud base URL is only ever accepted through validateCloudBaseUrl', () => {
    const settings = read(path.join(ROOT, 'server/ai/settings.js'));
    const sanitize = settings.slice(settings.indexOf('const sanitizeCloud'), settings.indexOf('export function sanitizeAiSettings'));
    expect(sanitize).toMatch(/validateCloudBaseUrl\(/);
    expect(sanitize).not.toMatch(/validateEndpointUrl\(/);
    const routes = read(path.join(ROOT, 'server/aiSettingsRoutes.js'));
    expect(routes.slice(routes.indexOf("app.put('/api/settings/ai/cloud'"))).toMatch(/validateCloudBaseUrl\(/);
  });

  it('cloud is gated on consent in the registry', () => {
    const src = read(path.join(ROOT, 'server/ai/registry.js'));
    const gate = src.slice(src.indexOf('async function cloudConfig('), src.indexOf('const NO_CATEGORIES'));
    for (const needle of ["isEnabled('cloudAi')", 'getCloudConsent()', 'isConsentCurrent(', 'validateCloudBaseUrl(', 'getSecret(CLOUD_KEY_NAME)']) {
      expect(gate, needle).toContain(needle);
    }
  });
});
