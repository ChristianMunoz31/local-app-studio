// Sandbox AI isolation: a sandbox must never reach the real Ollama on 127.0.0.1:11434 unless the
// owner passes --real-ai. The pure builders are unit-tested; the integration tests start the real
// server.js as a child on a temp data dir with the env the sandbox would give it, and assert on the
// env, the child's own reported Ollama host and the fake's request log. (The network guard only
// covers this process, and 11434 may be occupied by a real Ollama, so nothing here binds it.)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeOllama, FAKE_MODEL_NAME, TOOL_DONE_REPLY } from '../../scripts/lib/fakeOllamaServer.js';
import {
  REAL_OLLAMA_PORT,
  SandboxSafetyError,
  assertAiEnvSafe,
  buildAiEnv,
  buildChildEnv,
  freePort,
  resolveAiMode,
  savedOllamaHost,
} from '../../scripts/lib/sandboxSafety.js';
import { aiBanner, parseArgs } from '../../scripts/sandbox.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hostOf = (env) => new URL(env.OLLAMA_HOST);

describe('resolveAiMode', () => {
  it('defaults to the fake and maps the flags', () => {
    expect(resolveAiMode({})).toBe('fake');
    expect(resolveAiMode()).toBe('fake');
    expect(resolveAiMode({ realAi: true })).toBe('real');
    expect(resolveAiMode({ noAi: true })).toBe('none');
  });

  it('rejects contradictory flags', () => {
    expect(() => resolveAiMode({ realAi: true, noAi: true })).toThrow(SandboxSafetyError);
  });
});

describe('sandbox flags and the AI line', () => {
  it('parses --plain-ai next to the existing flags and defaults it off', () => {
    expect(parseArgs([]).plainAi).toBe(false);
    expect(parseArgs(['--plain-ai'])).toMatchObject({ plainAi: true, realAi: false, noAi: false });
    expect(parseArgs(['--no-ai'])).toMatchObject({ plainAi: false, noAi: true });
    expect(parseArgs(['--real-ai'])).toMatchObject({ plainAi: false, realAi: true });
  });

  it('refuses --plain-ai together with --real-ai or --no-ai', () => {
    expect(() => parseArgs(['--plain-ai', '--real-ai'])).toThrow(SandboxSafetyError);
    expect(() => parseArgs(['--no-ai', '--plain-ai'])).toThrow(/--plain-ai/);
  });

  it('says which fake mode runs, and keeps the real and none lines', () => {
    expect(aiBanner('fake', 'http://127.0.0.1:47123')).toMatch(/canned designs chosen by the words in the prompt/);
    expect(aiBanner('fake', 'http://127.0.0.1:47123', true)).toMatch(/--plain-ai: every chat gets one fixed line/);
    expect(aiBanner('real', 'http://127.0.0.1:11434')).toMatch(/REAL Ollama/);
    expect(aiBanner('none', 'http://127.0.0.1:47124')).toMatch(/--no-ai/);
  });
});

describe('buildAiEnv and assertAiEnvSafe', () => {
  it('never targets port 11434 without --real-ai', () => {
    const fake = buildAiEnv({ mode: 'fake', fakeUrl: 'http://127.0.0.1:47123' });
    const none = buildAiEnv({ mode: 'none', deadPort: 47124 });
    for (const env of [fake, none]) {
      expect(hostOf(env).port).not.toBe(String(REAL_OLLAMA_PORT));
      expect(env.OLLAMA_HOST).not.toMatch(/11434/);
    }
    expect(() => assertAiEnvSafe('fake', fake)).not.toThrow();
    expect(() => assertAiEnvSafe('none', none)).not.toThrow();
  });

  it('only real mode targets 127.0.0.1:11434', () => {
    const real = buildAiEnv({ mode: 'real' });
    expect(real.OLLAMA_HOST).toBe('http://127.0.0.1:11434');
    expect(() => assertAiEnvSafe('real', real)).not.toThrow();
  });

  it('asserts before spawn: every spelling of the real Ollama is refused outside real mode', () => {
    const bad = [
      undefined,
      '',
      'http://127.0.0.1:11434',
      'http://localhost:11434',
      'http://localhost:11434/',
      'http://[::1]:11434',
      'http://user:pw@127.0.0.1:47000',
      '127.0.0.1:11434',
      'localhost',
      'http://127.0.0.1',
      'http://192.168.1.4:47000',
      'https://127.0.0.1:47000',
      'http://127.0.0.1:80',
    ];
    for (const value of bad) {
      for (const mode of ['fake', 'none']) {
        expect(() => assertAiEnvSafe(mode, { OLLAMA_HOST: value }), `${mode} ${value}`).toThrow(SandboxSafetyError);
      }
    }
    expect(() => assertAiEnvSafe('fake', {})).toThrow(SandboxSafetyError);
    expect(() => assertAiEnvSafe('bogus', { OLLAMA_HOST: 'http://127.0.0.1:47000' })).toThrow(SandboxSafetyError);
  });

  it('real mode must really point at 11434', () => {
    expect(() => assertAiEnvSafe('real', { OLLAMA_HOST: 'http://127.0.0.1:47000' })).toThrow(SandboxSafetyError);
  });

  it('refuses incomplete inputs', () => {
    expect(() => buildAiEnv({ mode: 'fake' })).toThrow(SandboxSafetyError);
    expect(() => buildAiEnv({ mode: 'none' })).toThrow(SandboxSafetyError);
    expect(() => buildAiEnv({ mode: 'other' })).toThrow(SandboxSafetyError);
  });

  it('does not inherit the developer OLLAMA_HOST into the child env', () => {
    const env = buildChildEnv({ source: { PATH: '/bin', OLLAMA_HOST: 'http://127.0.0.1:11434' }, platform: 'linux', extra: buildAiEnv({ mode: 'fake', fakeUrl: 'http://127.0.0.1:47123' }) });
    expect(env.OLLAMA_HOST).toBe('http://127.0.0.1:47123');
  });
});

describe('savedOllamaHost', () => {
  it('is null for a missing file or an unreadable one', () => {
    expect(savedOllamaHost(path.join(os.tmpdir(), 'local-app-studio-no-such-file.db'))).toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-savedhost-'));
    try {
      const file = path.join(dir, 'app.db');
      fs.writeFileSync(file, 'not a database');
      expect(savedOllamaHost(file)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sandbox server with the AI env (child process)', () => {
  let dir;
  let fake;
  let child;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-sandboxai-'));
  });
  afterEach(async () => {
    child?.kill();
    await new Promise((resolve) => (child && child.exitCode === null ? child.once('exit', resolve) : resolve()));
    child = null;
    await fake?.close();
    fake = null;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  async function startServer(mode, aiEnv) {
    const env = buildChildEnv({
      homeDir: path.join(dir, 'home'),
      extra: {
        ...aiEnv,
        APP_NO_DOTENV: '1',
        APP_DATA_DIR: dir,
        APP_HOST: '127.0.0.1',
        APP_PORT: String(await freePort()),
        APP_SCHEDULER: '0',
        APP_NETWORK_OPTIN: '',
      },
    });
    assertAiEnvSafe(mode, env);
    child = spawn(process.execPath, [path.join(REPO_ROOT, 'server.js')], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.resume();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 20_000);
      child.once('exit', (code) => reject(new Error(`server exited (${code})`)));
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.startsWith('Data: ')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return { env, base: `http://127.0.0.1:${env.APP_PORT}` };
  }

  it('fake mode: setup reports Ollama running with the fake model and the child uses the fake host', async () => {
    fake = await startFakeOllama();
    const { env, base } = await startServer('fake', buildAiEnv({ mode: 'fake', fakeUrl: fake.url }));
    expect(env.OLLAMA_HOST).toBe(fake.url);

    const setup = (await (await fetch(`${base}/api/settings/ai/setup`)).json()).data;
    expect(setup.ollama).toBe('running');
    expect(setup.host).toBe(fake.url);
    expect(setup.host).not.toMatch(/11434/);
    expect(setup.models.map((m) => m.name)).toContain(FAKE_MODEL_NAME);
    expect(setup.ready).toBe(true);
    expect(setup.canPull).toBe(true);

    const status = (await (await fetch(`${base}/api/settings/ai`)).json()).data;
    expect(status.ollama.host).toBe(fake.url);
    expect(status.ollama.hostSource).toBe('env');
    expect(fake.requests.map((r) => r.path)).toEqual(expect.arrayContaining(['/api/version', '/api/tags']));
  });

  it('fake mode: Assistant calls the read tool list_features and a model pull stays on the fake', async () => {
    fake = await startFakeOllama();
    const { base } = await startServer('fake', buildAiEnv({ mode: 'fake', fakeUrl: fake.url }));
    await fetch(`${base}/api/settings/ai/setup`);
    // Assistant tools are free, and with config/store.json as shipped licensing is off, so no trial is needed.
    const assistant = await fetch(`${base}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Which features do I have?' }),
    });
    const text = await assistant.text();
    expect(text).toContain('list_features');
    expect(text).toContain(TOOL_DONE_REPLY);
    const chat = fake.requests.filter((r) => r.path === '/api/chat');
    expect(chat.length).toBeGreaterThan(0);
    expect(chat[0].body.model).toBe(FAKE_MODEL_NAME);

    const pull = await fetch(`${base}/api/settings/ai/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3.2:1b' }),
    });
    expect(await pull.text()).toContain('event: done');
    expect(fake.requests.some((r) => r.path === '/api/pull' && r.body?.model === 'llama3.2:1b')).toBe(true);
  });

  it('none mode: the child points at a dead port, reports Ollama not running and the fake sees nothing', async () => {
    fake = await startFakeOllama();
    const deadPort = await freePort();
    const aiEnv = buildAiEnv({ mode: 'none', deadPort });
    const { base } = await startServer('none', aiEnv);
    const setup = (await (await fetch(`${base}/api/settings/ai/setup`)).json()).data;
    expect(setup.host).toBe(`http://127.0.0.1:${deadPort}`);
    expect(setup.host).not.toMatch(/11434/);
    expect(setup.ollama).not.toBe('running');
    expect(setup.canPull).toBe(false);
    expect(fake.requests).toEqual([]);
  });
});
